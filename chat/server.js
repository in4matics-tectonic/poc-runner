// The customer's own AI assistant for the PoC. Claude chats with the customer and can use exactly the
// tools the KBC MCP server exposes (share / read / revoke a life moment), nothing else.
//
// Flow: the browser logs in as a customer (tom / lien / sarah) → we keep the backend token server-side
// in an in-memory session → every chat turn connects to the MCP server over HTTP with that token as Bearer.
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import Anthropic from '@anthropic-ai/sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const PORT = Number(process.env.PORT ?? 3000);
const KBC_API_URL = process.env.KBC_API_URL ?? 'http://127.0.0.1:3000';
const MCP_URL = process.env.MCP_URL ?? 'http://127.0.0.1:3001/mcp';
const MODEL = process.env.CHAT_MODEL || 'claude-opus-5-5';
const EFFORT = process.env.CHAT_EFFORT || 'low';
const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

const SYSTEM = `Je bent de persoonlijke AI-assistent van de gebruiker (niet van KBC). Je helpt met alledaagse vragen en plannen.
De gebruiker heeft KBC Momentum gekoppeld: via de tools kan je, enkel met uitdrukkelijk akkoord, een levensmoment
(gezinsuitbreiding, huis kopen, zaak starten) en de fase ervan met KBC delen, lezen wat KBC voorbereidt, of het intrekken.
- Stel het delen voor wanneer het relevant is, maar vraag altijd eerst akkoord en zeg precies wat gedeeld wordt (enkel moment en fase).
- Deel nooit het gesprek, gezondheidsdetails of andere persoonlijke inhoud.
- Vraag bevestiging voor je een moment intrekt.
- Antwoord in de taal van de gebruiker, kort en warm. Gebruik geen markdown-koppen.
Vandaag is het ${new Date().toISOString().slice(0, 10)}.`;

/** sessionId → { token, user, messages } — lost on restart, like the backend's own state */
const sessions = new Map();

async function login(username, password) {
  const res = await fetch(`${KBC_API_URL}/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error ?? 'login_failed'), { status: res.status });
  if (body.user?.role !== 'klant') throw Object.assign(new Error('not_klant'), { status: 403 });
  return body;
}

async function connectMcp(token) {
  const client = new Client({ name: 'kbc-momentum-poc-chat', version: '0.1.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(MCP_URL), { requestInit: { headers: { authorization: `Bearer ${token}` } } }),
  );
  const { tools } = await client.listTools();
  return {
    client,
    tools: tools.map((t) => ({ name: t.name, description: t.description ?? t.title ?? '', input_schema: t.inputSchema })),
  };
}

const toolText = (result) =>
  (result.content ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n') || '(geen inhoud)';

/** Drops the last (unfinished) turn so the history stays valid for the next one */
function rollback(session) {
  const lastUser = session.messages.findLastIndex((m) => m.role === 'user' && typeof m.content === 'string');
  if (lastUser >= 0) session.messages.splice(lastUser);
}

/** One user turn: runs Claude + MCP tools until Claude is done. Returns what the UI should render. */
async function chatTurn(session, text) {
  const { client, tools } = await connectMcp(session.token);
  const events = [];
  session.messages.push({ role: 'user', content: text });
  try {
    for (let i = 0; i < 8; i++) {
      const response = await anthropic.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        system: SYSTEM,
        tools,
        messages: session.messages,
        output_config: { effort: EFFORT },
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      });
      if (response.stop_reason === 'refusal') {
        rollback(session);
        events.push({ type: 'text', text: 'Daar kan ik je niet mee helpen.' });
        return events;
      }
      session.messages.push({ role: 'assistant', content: response.content });
      for (const b of response.content) if (b.type === 'text' && b.text.trim()) events.push({ type: 'text', text: b.text });

      if (response.stop_reason === 'pause_turn') continue;
      const calls = response.content.filter((b) => b.type === 'tool_use');
      if (response.stop_reason !== 'tool_use' || calls.length === 0) return events;

      const results = await Promise.all(
        calls.map(async (call) => {
          let content;
          let isError = false;
          try {
            const r = await client.callTool({ name: call.name, arguments: call.input });
            content = toolText(r);
            isError = Boolean(r.isError);
          } catch (e) {
            content = 'De KBC-koppeling is niet bereikbaar.';
            isError = true;
            console.error('[chat] tool failed', call.name, e instanceof Error ? e.message : e);
          }
          events.push({ type: 'tool', name: call.name, input: call.input, result: content, isError });
          return { type: 'tool_result', tool_use_id: call.id, content, is_error: isError };
        }),
      );
      session.messages.push({ role: 'user', content: results });
    }
    events.push({ type: 'text', text: '(gestopt na te veel stappen)' });
    return events;
  } finally {
    await client.close().catch(() => {});
  }
}

// --- HTTP ---------------------------------------------------------------------------------------

const index = await readFile(new URL('./public/index.html', import.meta.url));

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 32_000) throw Object.assign(new Error('too_large'), { status: 413 });
  }
  try {
    return JSON.parse(raw || '{}');
  } catch {
    throw Object.assign(new Error('bad_json'), { status: 400 });
  }
}

const getSession = (req) => sessions.get(req.headers['x-session'] ?? '');

http
  .createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://x');
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(index);
      }
      if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true });
      if (req.method === 'GET' && url.pathname === '/api/status') {
        return send(res, 200, { llm: Boolean(anthropic), model: MODEL });
      }
      if (req.method === 'POST' && url.pathname === '/api/login') {
        const { username, password } = await readJson(req);
        const body = await login(String(username ?? ''), String(password ?? ''));
        const id = randomUUID();
        sessions.set(id, { token: body.token, user: body.user, messages: [] });
        return send(res, 200, { session: id, user: body.user });
      }
      if (req.method === 'POST' && url.pathname === '/api/logout') {
        sessions.delete(req.headers['x-session'] ?? '');
        return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/api/reset') {
        const s = getSession(req);
        if (s) s.messages = [];
        return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/api/chat') {
        const s = getSession(req);
        if (!s) return send(res, 401, { error: 'unauthorized' });
        if (!anthropic) return send(res, 503, { error: 'no_llm' });
        const { text } = await readJson(req);
        if (typeof text !== 'string' || !text.trim() || text.length > 4000) return send(res, 400, { error: 'bad_text' });
        try {
          return send(res, 200, { events: await chatTurn(s, text.trim()) });
        } catch (e) {
          rollback(s);
          if (e instanceof Anthropic.APIError) {
            console.error('[chat] claude error', e.status, e.message);
            return send(res, 502, { error: 'llm_error' });
          }
          if (/401|unauthorized/i.test(String(e?.message))) {
            sessions.delete(req.headers['x-session']);
            return send(res, 401, { error: 'unauthorized' });
          }
          throw e;
        }
      }
      send(res, 404, { error: 'not_found' });
    } catch (e) {
      const status = e?.status ?? 500;
      if (status >= 500) console.error('[chat]', e);
      send(res, status, { error: status >= 500 ? 'internal_error' : e.message });
    }
  })
  .listen(PORT, '0.0.0.0', () => console.log(`[chat] http://0.0.0.0:${PORT} model=${MODEL} llm=${Boolean(anthropic)}`));
