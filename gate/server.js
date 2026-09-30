// Shared-password gate for the public deployment. Caddy asks /verify before every request
// (forward_auth); a valid signed cookie on the base domain unlocks the showcase and all its subdomains.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import http from 'node:http';

const PORT = Number(process.env.PORT ?? 3000);
const DOMAIN = process.env.POC_DOMAIN ?? '';
const PASSWORD = process.env.SITE_PASSWORD ?? '';
const SECRET = process.env.GATE_SECRET ?? '';
const MAX_AGE = 30 * 24 * 3600; // seconds
const COOKIE = 'poc_gate';

if (!DOMAIN || !PASSWORD || SECRET.length < 32) {
  console.error('[gate] POC_DOMAIN, SITE_PASSWORD and GATE_SECRET (≥32 chars) are required');
  process.exit(1);
}

const sign = (exp) => createHmac('sha256', SECRET).update(`poc:${exp}`).digest('base64url');
const digest = (s) => createHash('sha256').update(s).digest();

function validCookie(header = '') {
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=(\\d+)\\.([\\w-]+)`).exec(header);
  if (!m || Number(m[1]) < Date.now() / 1000) return false;
  const a = Buffer.from(m[2]);
  const b = Buffer.from(sign(m[1]));
  return a.length === b.length && timingSafeEqual(a, b);
}

// Only send people back to our own hosts after login (no open redirect)
function safeNext(next) {
  try {
    const u = new URL(next);
    if (u.protocol === 'https:' && (u.hostname === DOMAIN || u.hostname.endsWith(`.${DOMAIN}`))) return u.href;
  } catch {}
  return `https://${DOMAIN}/`;
}

// 10 attempts per minute per IP
const attempts = new Map();
function limited(ip) {
  const now = Date.now();
  const list = (attempts.get(ip) ?? []).filter((t) => now - t < 60_000);
  list.push(now);
  attempts.set(ip, list);
  return list.length > 10;
}

const esc = (s) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const page = (next, error = '') => `<!doctype html>
<html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kate Studio PoC</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0a1426; color: #e8eef8;
    font: 15px/1.5 Inter, ui-sans-serif, system-ui, sans-serif; padding: 16px; box-sizing: border-box; }
  form { width: 100%; max-width: 340px; background: #13233f; border: 1px solid #22385c; border-radius: 14px; padding: 28px; }
  h1 { font-size: 18px; margin: 0 0 4px; } p { color: #8ea2c2; margin: 0 0 18px; font-size: 14px; }
  input { width: 100%; box-sizing: border-box; padding: 10px 12px; border-radius: 10px; border: 1px solid #22385c;
    background: #0f1d36; color: inherit; font: inherit; }
  button { width: 100%; margin-top: 12px; padding: 10px; border: 0; border-radius: 10px; background: #00aeef;
    color: #04121f; font: inherit; font-weight: 600; cursor: pointer; }
  .err { color: #ff6b6b; font-size: 13px; margin-top: 10px; min-height: 1em; }
</style></head>
<body><form method="post" action="https://${DOMAIN}/__login">
  <h1>Kate Studio PoC</h1><p>Voer het wachtwoord in om de demo te bekijken.</p>
  <input type="hidden" name="next" value="${esc(next)}">
  <input type="password" name="password" placeholder="Wachtwoord" autofocus required autocomplete="current-password">
  <button>Doorgaan</button><div class="err">${esc(error)}</div>
</form></body></html>`;

function html(res, status, body) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');

    if (url.pathname === '/verify') {
      if (validCookie(req.headers.cookie)) return res.writeHead(200).end();
      const original = `https://${req.headers['x-forwarded-host'] ?? DOMAIN}${req.headers['x-forwarded-uri'] ?? '/'}`;
      // Page loads go to the login form; background requests just get a 401
      if ((req.headers['x-forwarded-method'] ?? 'GET') === 'GET' && !/json/.test(req.headers.accept ?? '')) {
        res.writeHead(302, { location: `https://${DOMAIN}/__login?next=${encodeURIComponent(original)}` });
        return res.end();
      }
      return res.writeHead(401, { 'content-type': 'application/json' }).end('{"error":"unauthorized"}');
    }

    if (url.pathname === '/__login' && req.method === 'GET') return html(res, 200, page(safeNext(url.searchParams.get('next') ?? '')));

    if (url.pathname === '/__login' && req.method === 'POST') {
      let raw = '';
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 4096) return res.writeHead(413).end();
      }
      const form = new URLSearchParams(raw);
      const next = safeNext(form.get('next') ?? '');
      const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress).split(',')[0].trim();
      if (limited(ip)) return html(res, 429, page(next, 'Te veel pogingen. Wacht een minuut.'));
      if (!timingSafeEqual(digest(form.get('password') ?? ''), digest(PASSWORD))) {
        return html(res, 401, page(next, 'Verkeerd wachtwoord.'));
      }
      const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
      res.writeHead(303, {
        location: next,
        'set-cookie': `${COOKIE}=${exp}.${sign(exp)}; Domain=${DOMAIN}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Lax`,
      });
      return res.end();
    }

    res.writeHead(404).end();
  })
  .listen(PORT, '0.0.0.0', () => console.log(`[gate] :${PORT} for ${DOMAIN}`));
