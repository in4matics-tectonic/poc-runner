// The chat pane of the PoC. One server, several "apps" the showcase can switch between:
//   - chatgpt / gemini / claude: the customer's own AI. Claude does the talking and can use exactly the tools
//     the KBC MCP server exposes (share / read / revoke a life moment), nothing else.
//   - kate: Kate, the assistant in KBC Mobile. She talks to the backend directly as KBC, asks "Klopt dit?"
//     by herself once a moment reaches phase "vragen", and presents the plan after confirmation.
//
// The browser logs in as a customer (tom / lien / sarah); the backend token stays here, in an in-memory session.
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

const APPS = ['chatgpt', 'gemini', 'claude', 'kate'];
const MOMENT = { GEZINSUITBREIDING: 'gezinsuitbreiding', HUIS_KOPEN: 'een huis kopen', ZAAK_STARTEN: 'een zaak starten' };
const today = () => new Date().toISOString().slice(0, 10);

const EIGEN_AI =
  () => `Je bent de persoonlijke AI-assistent van de gebruiker (niet van KBC). Je helpt met alledaagse vragen en plannen.
De gebruiker heeft Kate Studio gekoppeld: via de tools kan je, enkel met uitdrukkelijk akkoord, een levensmoment
(gezinsuitbreiding, huis kopen, zaak starten) en de fase ervan met KBC delen, lezen wat KBC voorbereidt, of het intrekken.
- Stel het delen voor wanneer het relevant is, maar vraag altijd eerst akkoord en zeg precies wat gedeeld wordt (enkel moment en fase).
- Deel nooit het gesprek, gezondheidsdetails of andere persoonlijke inhoud.
- Vraag bevestiging voor je een moment intrekt.
- Antwoord in de taal van de gebruiker, kort en warm. Je mag markdown gebruiken (vet, lijstjes, tabellen) waar dat helpt.
Vandaag is het ${today()}.`;

const KATE = (
  user,
) => `Je bent Kate, de digitale assistent in de KBC Mobile-app. Je spreekt met ${user.sub[0].toUpperCase() + user.sub.slice(1)} (klant ${user.klantId}).
Toon: jij-vorm, warm en rustig, als een goede buur die meedenkt. Geen bankjargon. Nederlands (Vlaams). Kort: 1 tot 4 zinnen. Markdown mag spaarzaam (vet, een kort lijstje), geen koppen.
Je kan met de tools het overzicht van de klant bekijken (producten, levenslandschap, levensmomenten), rekeningen en recente verrichtingen tonen,
een levensmoment bevestigen ("Ja, klopt") of intrekken ("Niet voor ons").
Regels:
- Noem nooit signalen, documenten of gezondheidsdetails. Zeg hooguit "op basis van wat je met ons deelde".
- Feliciteer pas nadat de klant een moment bevestigd heeft. Bevestig of trek enkel in als de klant dat in dit gesprek uitdrukkelijk vraagt.
- Duw nooit meer dan één voorstel tegelijk naar voren. Stel geen producten voor die de klant al heeft.
- Acties met uitvoering STP regel je "met één tik"; in deze demo zet je ze klaar en bevestigt de klant ze in de app. INFO = uitleg of simulatie. ADVISEUR = je plant een gesprek met een adviseur.
- Vraagt iemand naar iets wat je niet kan: stel voor om KBC Live te bellen.
Vandaag is het ${today()}.`;

/** sessionId → { token, user, convos: { [app]: { messages, events } }, told: Set } — lost on restart */
const sessions = new Map();
const convo = (s, app) => (s.convos[app] ??= { messages: [], events: [] });

const httpError = (status, message) => Object.assign(new Error(message), { status });

async function login(username, password) {
  const res = await fetch(`${KBC_API_URL}/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw httpError(res.status, body.error ?? 'login_failed');
  if (body.user?.role !== 'klant') throw httpError(403, 'not_klant');
  return body;
}

/** Backend call as the logged-in customer */
async function kbc(session, method, path, body) {
  const res = await fetch(`${KBC_API_URL}/v1/klanten/${session.user.klantId}${path}`, {
    method,
    headers: { authorization: `Bearer ${session.token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw httpError(res.status, data.error ?? 'kbc_error');
  return data;
}

// --- Tools ----------------------------------------------------------------------------------------

async function mcpTools(session) {
  const client = new Client({ name: 'kbc-momentum-poc-chat', version: '0.2.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(MCP_URL), {
      requestInit: { headers: { authorization: `Bearer ${session.token}` } },
    }),
  );
  const { tools } = await client.listTools();
  return {
    tools: tools.map((t) => ({ name: t.name, description: t.description ?? t.title ?? '', input_schema: t.inputSchema })),
    async run(name, input) {
      const r = await client.callTool({ name, arguments: input });
      const text = (r.content ?? [])
        .filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join('\n');
      return { text: text || '(geen inhoud)', isError: Boolean(r.isError) };
    },
    close: () => client.close().catch(() => {}),
  };
}

const momentInput = {
  type: 'object',
  properties: { moment: { type: 'string', enum: Object.keys(MOMENT) } },
  required: ['moment'],
  additionalProperties: false,
};

function kateTools(session) {
  const impl = {
    overzicht: async () => ({ klant: await kbc(session, 'GET', ''), momenten: await kbc(session, 'GET', '/momenten') }),
    rekeningen: async () => ({
      rekeningen: await kbc(session, 'GET', '/rekeningen'),
      recente_verrichtingen: await kbc(session, 'GET', '/transacties?limit=8'),
    }),
    bevestig_moment: async ({ moment }) => {
      await kbc(session, 'POST', `/momenten/${moment}/bevestig`);
      return kbc(session, 'GET', `/momenten/${moment}`);
    },
    niet_voor_ons: async ({ moment }) => {
      await kbc(session, 'DELETE', `/momenten/${moment}`);
      return { ok: true, uitleg: 'Alle signalen voor dit moment zijn gewist.' };
    },
  };
  return {
    tools: [
      {
        name: 'overzicht',
        description:
          'Profiel van de klant: naam, producten, levenslandschap en de levensmomenten met score, fase en (na bevestiging) de voorgestelde acties.',
        input_schema: { type: 'object', properties: {}, additionalProperties: false },
      },
      {
        name: 'rekeningen',
        description: 'Rekeningen met saldo en de recentste verrichtingen.',
        input_schema: { type: 'object', properties: {}, additionalProperties: false },
      },
      {
        name: 'bevestig_moment',
        description:
          'De klant bevestigt uitdrukkelijk dat het levensmoment klopt ("Ja, klopt"). Ontgrendelt het voorstel met acties.',
        input_schema: momentInput,
      },
      {
        name: 'niet_voor_ons',
        description:
          'De klant zegt dat het moment niet klopt ("Niet voor ons"). Wist alle signalen van dat moment. Vraag eerst bevestiging.',
        input_schema: momentInput,
      },
    ],
    async run(name, input) {
      if (!impl[name]) return { text: 'Onbekende tool.', isError: true };
      if (input.moment !== undefined && !MOMENT[input.moment]) return { text: 'Onbekend moment.', isError: true };
      try {
        return { text: JSON.stringify(await impl[name](input)), isError: false };
      } catch (e) {
        if (e.status === 401) throw e;
        return { text: `KBC gaf een fout (${e.message}).`, isError: true };
      }
    },
    close: () => {},
  };
}

// --- Claude ---------------------------------------------------------------------------------------

function claude(params, options) {
  return anthropic.beta.messages.create(
    {
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: EFFORT },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      ...params,
    },
    options,
  );
}

const textOf = (response) =>
  response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();

/** Drops the last (unfinished) turn so the history stays valid for the next one */
function rollback(c) {
  const lastUser = c.messages.findLastIndex((m) => m.role === 'user' && typeof m.content === 'string');
  if (lastUser >= 0) c.messages.splice(lastUser);
}

/** One user turn: Claude + tools until done. Returns the events for the UI (also kept in the history). */
async function chatTurn(session, app, text) {
  const c = convo(session, app);
  const kit = app === 'kate' ? kateTools(session) : await mcpTools(session);
  const system = app === 'kate' ? KATE(session.user) : EIGEN_AI();
  const events = [{ type: 'user', text }];
  c.messages.push({ role: 'user', content: text });
  try {
    for (let i = 0; i < 8; i++) {
      const response = await claude({ system, tools: kit.tools, messages: c.messages });
      if (response.stop_reason === 'refusal') {
        rollback(c);
        events.push({ type: 'text', text: 'Daar kan ik je niet mee helpen.' });
        c.events.push(...events);
        return events;
      }
      c.messages.push({ role: 'assistant', content: response.content });
      for (const b of response.content) if (b.type === 'text' && b.text.trim()) events.push({ type: 'text', text: b.text });

      if (response.stop_reason === 'pause_turn') continue;
      const calls = response.content.filter((b) => b.type === 'tool_use');
      if (response.stop_reason !== 'tool_use' || calls.length === 0) break;

      const results = await Promise.all(
        calls.map(async (call) => {
          let r;
          try {
            r = await kit.run(call.name, call.input);
          } catch (e) {
            if (e.status === 401) throw e;
            console.error('[chat] tool failed', call.name, e instanceof Error ? e.message : e);
            r = { text: 'De KBC-koppeling is niet bereikbaar.', isError: true };
          }
          events.push({ type: 'tool', name: call.name, input: call.input, result: r.text, isError: r.isError });
          return { type: 'tool_result', tool_use_id: call.id, content: r.text, is_error: r.isError };
        }),
      );
      c.messages.push({ role: 'user', content: results });
    }
    c.events.push(...events);
    return events;
  } finally {
    await kit.close();
  }
}

/** A message Kate starts herself; kept in the history so later turns know what she said */
function kateSays(session, event, userTurn = '(De klant opent de app. Kate meldt zich uit zichzelf.)') {
  const c = convo(session, 'kate');
  c.messages.push({ role: 'user', content: userTurn });
  c.messages.push({ role: 'assistant', content: event.text });
  c.events.push(event);
  return event;
}

/** One short Kate message from a prompt, with a fixed fallback if the LLM is slow or unavailable */
async function kateWrites(session, instruction, input, fallback) {
  if (!anthropic) return fallback;
  try {
    const response = await claude(
      {
        system: KATE(session.user),
        max_tokens: 2000,
        messages: [{ role: 'user', content: `${instruction}\n\nGegevens (JSON):\n${JSON.stringify(input)}` }],
      },
      { timeout: 12_000, maxRetries: 0 },
    );
    return (response.stop_reason !== 'refusal' && textOf(response)) || fallback;
  } catch (e) {
    console.error('[kate] llm failed', e instanceof Error ? e.message : e);
    return fallback;
  }
}

const vraagFallback = (m) =>
  m.moment === 'GEZINSUITBREIDING'
    ? 'Jullie landschap krijgt misschien binnenkort een extra bewoner. Klopt dat? Dan zet ik alles klaar wat een nieuw gezinslid nodig heeft, en jullie beslissen wat we regelen.'
    : `Het lijkt erop dat ${MOMENT[m.moment]} voor jullie op de planning staat. Klopt dat? Dan zet ik klaar wat je nodig hebt.`;

async function kateAsks(session, m) {
  const klant = await kbc(session, 'GET', '');
  const text = await kateWrites(
    session,
    'Fase "vragen": schrijf 1 warme, korte vraag (max. 2 zinnen) of dit levensmoment klopt. Feliciteer nog niet. Noem nooit signalen of documenten. Enkel de vraag, zonder aanhef met naam.',
    { klant: { naam: klant.naam, producten: klant.producten }, moment: m.moment, score: m.score },
    vraagFallback(m),
  );
  return kateSays(session, { type: 'kate-vraag', moment: m.moment, text, buttons: ['Ja, klopt', 'Niet voor ons', 'Later'] });
}

async function kateProposes(session, m, userTurn) {
  const klant = await kbc(session, 'GET', '');
  const text = await kateWrites(
    session,
    'Fase "voorstel": feliciteer kort (1 zin) en leid het plan in (1 à 2 zinnen). Begin met de actie die het meest dringend is. Noem de Kate Coin-beloning en de voorwaarde als die er is. Som de acties NIET op, die toont de app als kaartjes.',
    { klant: { naam: klant.naam, producten: klant.producten }, moment: m.moment, acties: m.acties },
    'Proficiat! Ik heb alles klaargezet wat jullie nodig hebben. Begin met het belangrijkste; de rest kan later.',
  );
  return kateSays(session, { type: 'kate-plan', moment: m.moment, text, acties: m.acties ?? [] }, userTurn);
}

/** Called by the Kate UI every few seconds: speaks up when a moment reaches "vragen" or "voorstel" */
async function kateNudge(session) {
  const { momenten } = await kbc(session, 'GET', '/momenten');
  const now = new Set(momenten.map((m) => `${m.moment}:${m.fase}`));
  // After a demo reset the moment drops back; forget what we said so the demo can be replayed
  for (const key of session.told) if (!now.has(key)) session.told.delete(key);
  const events = [];
  for (const m of momenten) {
    const key = `${m.moment}:${m.fase}`;
    if (session.told.has(key)) continue;
    if (m.fase === 'vragen' && !m.bevestigd) {
      session.told.add(key);
      events.push(await kateAsks(session, m));
    } else if (m.fase === 'voorstel') {
      session.told.add(key);
      events.push(await kateProposes(session, m));
    }
  }
  return events;
}

/** The buttons under Kate's question: deterministic, no LLM deciding anything */
async function kateAnswer(session, moment, answer) {
  if (!MOMENT[moment]) throw httpError(400, 'bad_moment');
  const c = convo(session, 'kate');
  const events = [{ type: 'user', text: answer }];
  c.events.push(events[0]);
  if (answer === 'Ja, klopt') {
    await kbc(session, 'POST', `/momenten/${moment}/bevestig`);
    const m = await kbc(session, 'GET', `/momenten/${moment}`);
    session.told.add(`${moment}:${m.fase}`);
    if (m.fase === 'voorstel') events.push(await kateProposes(session, m, answer));
    // Confirmed before the score is high enough for a plan: the nudge brings the plan once it's there
    else events.push(kateSays(session, { type: 'text', text: 'Fijn dat je het bevestigt! Ik zet alles klaar en laat het je weten zodra het voorstel er is.' }, answer));
  } else if (answer === 'Niet voor ons') {
    await kbc(session, 'DELETE', `/momenten/${moment}`);
    events.push(
      kateSays(
        session,
        {
          type: 'text',
          text: 'Begrepen, ik heb het gewist. Je hoort er niets meer over. Laat gerust iets weten als er iets verandert.',
        },
        answer,
      ),
    );
  } else {
    events.push(
      kateSays(
        session,
        { type: 'text', text: 'Geen probleem, ik vraag het later nog eens. Je vindt het ook terug in je landschap.' },
        answer,
      ),
    );
  }
  return events;
}

// --- HTTP -----------------------------------------------------------------------------------------

const index = await readFile(new URL('./public/index.html', import.meta.url));
// Markdown rendering in the browser: marked + DOMPurify, served from our own node_modules
const vendor = {
  '/vendor/marked.js': await readFile(new URL('./node_modules/marked/lib/marked.umd.js', import.meta.url)),
  '/vendor/purify.js': await readFile(new URL('./node_modules/dompurify/dist/purify.min.js', import.meta.url)),
};

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 32_000) throw httpError(413, 'too_large');
  }
  try {
    return JSON.parse(raw || '{}');
  } catch {
    throw httpError(400, 'bad_json');
  }
}

const appOf = (v) => (APPS.includes(v) ? v : 'claude');

http
  .createServer(async (req, res) => {
    const sid = req.headers['x-session'] ?? '';
    const session = sessions.get(sid);
    try {
      const url = new URL(req.url ?? '/', 'http://x');
      const route = `${req.method} ${url.pathname}`;
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(index);
      }
      if (req.method === 'GET' && vendor[url.pathname]) {
        res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=86400' });
        return res.end(vendor[url.pathname]);
      }
      if (route === 'GET /health') return send(res, 200, { ok: true });
      if (route === 'GET /api/status') return send(res, 200, { llm: Boolean(anthropic), model: MODEL });
      if (route === 'POST /api/login') {
        const { username, password } = await readJson(req);
        const body = await login(String(username ?? ''), String(password ?? ''));
        const id = randomUUID();
        sessions.set(id, { token: body.token, user: body.user, convos: {}, told: new Set() });
        return send(res, 200, { session: id, user: body.user });
      }
      // Showcase "Reset": forget every conversation (logins stay), so the demo starts over
      if (route === 'POST /admin/reset') {
        for (const s of sessions.values()) {
          s.convos = {};
          s.told.clear();
        }
        return send(res, 200, { ok: true, sessions: sessions.size });
      }
      if (route === 'POST /api/logout') {
        sessions.delete(sid);
        return send(res, 200, { ok: true });
      }

      if (!url.pathname.startsWith('/api/')) return send(res, 404, { error: 'not_found' });
      if (!session) return send(res, 401, { error: 'unauthorized' });

      try {
        if (route === 'GET /api/history')
          return send(res, 200, { events: convo(session, appOf(url.searchParams.get('app'))).events });
        if (route === 'POST /api/reset') {
          const { app } = await readJson(req);
          session.convos[appOf(app)] = { messages: [], events: [] };
          if (app === 'kate') session.told.clear();
          return send(res, 200, { ok: true });
        }
        if (route === 'POST /api/kate/nudge') return send(res, 200, { events: await kateNudge(session) });
        if (route === 'POST /api/kate/answer') {
          const { moment, answer } = await readJson(req);
          if (!['Ja, klopt', 'Niet voor ons', 'Later'].includes(answer)) return send(res, 400, { error: 'bad_answer' });
          return send(res, 200, { events: await kateAnswer(session, moment, answer) });
        }
        if (route === 'POST /api/chat') {
          if (!anthropic) return send(res, 503, { error: 'no_llm' });
          const { text, app } = await readJson(req);
          if (typeof text !== 'string' || !text.trim() || text.length > 4000) return send(res, 400, { error: 'bad_text' });
          const c = convo(session, appOf(app));
          try {
            return send(res, 200, { events: await chatTurn(session, appOf(app), text.trim()) });
          } catch (e) {
            rollback(c);
            if (e instanceof Anthropic.APIError) {
              console.error('[chat] claude error', e.status, e.message);
              return send(res, 502, { error: 'llm_error' });
            }
            throw e;
          }
        }
      } catch (e) {
        // The backend token expired (1h) or the backend restarted: make the UI log in again
        if (e?.status === 401 || /\b401\b|unauthorized/i.test(String(e?.message))) {
          sessions.delete(sid);
          return send(res, 401, { error: 'unauthorized' });
        }
        throw e;
      }
      send(res, 404, { error: 'not_found' });
    } catch (e) {
      const status = e?.status ?? 500;
      if (status >= 500) console.error('[chat]', e);
      send(res, status, { error: status >= 500 ? 'internal_error' : e.message });
    }
  })
  .listen(PORT, '0.0.0.0', () => console.log(`[chat] http://0.0.0.0:${PORT} model=${MODEL} llm=${Boolean(anthropic)}`));
