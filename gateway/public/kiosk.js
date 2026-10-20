// Kiosk mode (/kiosk): an attract loop for the stand. It shows only the customer's app, live, and plays one life
// moment from first signal to proposal and back, with short taglines next to it. Everything is a plain backend call
// (demo clock, share, "Ja, klopt", revoke): no chat pane, no LLM, nothing that costs money. The app can't be touched,
// so nobody opens Kate's chat in it either.
// /kiosk?drive=0 only watches: it never moves the demo clock, for when someone else is giving the demo.

(() => {
const CONFIG = window.POC ?? {};
const PORTS = Object.assign({ app: 7001 }, CONFIG.ports);
const host = location.hostname || 'localhost';
const appUrl = CONFIG.domain ? `${location.protocol}//app.${CONFIG.domain}` : `${location.protocol === 'https:' ? 'https' : 'http'}://${host}:${PORTS.app}`;

const KLANT = 'K-2024-0417';
const MOMENT = 'GEZINSUITBREIDING';
const LAST_WEEK = 20;
const POLL_MS = 1500;
const DRIVE = new URLSearchParams(location.search).get('drive') !== '0';
const FASES = ['stil', 'info', 'vragen', 'voorstel'];
const PHONE = { w: 410, h: 864 };

const $ = (id) => document.getElementById(id);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** Waits, but the clock stands still while the screen is hidden */
async function hold(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end || document.hidden) await wait(document.hidden ? 1000 : Math.min(250, end - Date.now()));
}

// ---------- backend (same-origin /v1 through the gateway, as the demo users) ----------
const DEMO_PASSWORD = 'in4matics-must-win';
const TOKEN_KEY = 'poc.tokens';
const tokens = () => { try { return JSON.parse(sessionStorage.getItem(TOKEN_KEY) || '{}'); } catch { return {}; } };
const logins = {};
function token(user, fresh) {
  const t = tokens()[user];
  if (!fresh && t && t.exp > Date.now()) return Promise.resolve(t.token);
  logins[user] ??= login(user).finally(() => delete logins[user]);
  return logins[user];
}
async function login(user) {
  const res = await fetch('/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: user, password: DEMO_PASSWORD }),
    signal: AbortSignal.timeout(8000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error || `login ${res.status}`), { status: res.status });
  try { sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ ...tokens(), [user]: { token: body.token, exp: Date.now() + (body.expiresIn - 60) * 1000 } })); } catch {}
  return body.token;
}
async function api(user, method, path, body, retry = true) {
  const res = await fetch(`/v1${path}`, {
    method,
    headers: { authorization: `Bearer ${await token(user, !retry)}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  });
  if (res.status === 401 && retry) return api(user, method, path, body, false);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(data?.error || `${path}: ${res.status}`), { status: res.status });
  return data;
}

// ---------- state: what the customer sees (privacy-filtered), never the adviser's detail ----------
const S = { online: false, week: 0, m: null };
const faseOf = () => (S.m ? S.m.fase : null);
const faseAt = (f) => S.m && FASES.indexOf(S.m.fase) >= FASES.indexOf(f);

async function poll() {
  try {
    const k = await api('tom', 'GET', `/klanten/${KLANT}/momenten`);
    S.online = true;
    S.week = k.week;
    S.m = k.momenten.find((x) => x.moment === MOMENT) ?? null;
  } catch {
    S.online = false;
  }
  render();
}

/** Moves the demo clock one demo week at a time until `stop` holds, so every step shows in the app */
async function playUntil(stop, stepMs) {
  for (let n = 0; n < 10 && !stop() && S.week < LAST_WEEK; n++) {
    await api('adviseur', 'POST', '/demo/volgende');
    await poll();
    if (!stop()) await hold(stepMs);
  }
}

// ---------- the loop ----------
// Taglines only: what it does for the customer, not how the platform works.
const BEATS = [
  {
    kicker: 'Next Best Moment',
    title: 'Het leven <em>verandert</em>.',
    sub: 'Een kindje op komst, een eerste huis, een eigen zaak. Grote momenten beginnen met kleine signalen.',
    ms: 8000,
    run: async (loop) => {
      await api('adviseur', 'POST', '/demo/reset');
      // A fresh app now and then, so a long day at the stand doesn't wear it down
      if (loop > 0 && loop % 15 === 0) loadApp();
      await poll();
    },
    when: () => !S.m,
  },
  {
    kicker: 'Jouw AI, jouw regels',
    title: 'Je eigen AI mag <em>meepraten</em>.',
    sub: 'Vertel je assistent wat er speelt. Jij kiest wat je bank te weten komt: het moment, nooit het gesprek.',
    ms: 7000,
    run: () => api('tom', 'POST', `/klanten/${KLANT}/momenten/delen`, { moment: MOMENT, fase: 'plannend' }),
  },
  {
    kicker: 'Kate merkt het op',
    title: 'Je bank ziet het <em>moment</em>.',
    sub: 'Uit signalen waarvoor jij toestemming gaf. Wat gevoelig is, blijft privé.',
    ms: 4000,
    run: () => playUntil(() => faseAt('vragen'), 3200),
    when: () => S.m && !faseAt('vragen'),
  },
  {
    kicker: 'Eerst vragen',
    title: 'Maar eerst vraagt ze: <em>klopt dit?</em>',
    sub: 'Geen aannames, geen verkooppraatje. Zonder jouw ja gebeurt er niets.',
    ms: 8000,
    when: () => faseOf() === 'vragen' && !S.m.bevestigd,
  },
  {
    kicker: 'Jij beslist',
    title: 'Jij zegt <em>ja</em>.',
    sub: 'Pas dan denkt Kate met je mee.',
    ms: 5000,
    run: () => api('tom', 'POST', `/klanten/${KLANT}/momenten/${MOMENT}/bevestig`),
    when: () => faseOf() === 'vragen' && S.m.bevestigd,
  },
  {
    kicker: 'Op het juiste moment',
    title: 'Klaar voor de <em>volgende stap</em>.',
    sub: 'Eén voorstel tegelijk, wanneer het past. Op jouw tempo.',
    ms: 11000,
    run: async () => {
      await playUntil(() => faseOf() === 'voorstel', 2600);
      await hold(1000);
    },
    when: () => faseOf() === 'voorstel',
  },
  {
    kicker: 'Het laatste woord',
    title: 'Toch niet? <em>Eén tik.</em>',
    sub: 'En alles is weg. Ook bij de bank.',
    ms: 7000,
    run: async () => {
      await api('tom', 'DELETE', `/klanten/${KLANT}/momenten/${MOMENT}`);
      await poll();
    },
  },
  {
    kicker: 'KBC Momentum',
    title: 'Van Next Best Offer naar <em>Next Best Moment</em>.',
    sub: 'De bank die het moment ziet, en eerst vraagt. Kom dichterbij: we tonen het je live.',
    ms: 9000,
    outro: true,
  },
];

$('beats').innerHTML = BEATS.map(() => '<li></li>').join('');
let shown = -1;
function showBeat(i) {
  if (i === shown) return;
  shown = i;
  const b = BEATS[i];
  const copy = $('copy');
  copy.classList.add('out');
  setTimeout(() => {
    $('kicker').textContent = b.kicker;
    $('title').innerHTML = b.title;
    $('sub').textContent = b.sub;
    copy.classList.remove('out');
  }, shown === 0 && !$('title').innerHTML ? 0 : 450);
  document.body.classList.toggle('outro', Boolean(b.outro));
  [...$('beats').children].forEach((li, n) => { li.className = n === i ? 'on' : n < i ? 'past' : ''; });
}

async function drive() {
  for (let loop = 0; ; loop++) {
    for (let i = 0; i < BEATS.length; i++) {
      const b = BEATS[i];
      const t0 = Date.now();
      showBeat(i);
      try {
        await b.run?.(loop);
      } catch (e) {
        // Backend down or busy: the taglines keep running, the next loop starts with a reset
        console.warn('[kiosk]', e.message);
      }
      await hold(Math.max(0, b.ms - (Date.now() - t0)));
    }
  }
}

/** Watch mode: the tagline follows whatever the demo is doing */
function follow() {
  const i = BEATS.findIndex((b) => b.when?.());
  if (i >= 0) showBeat(i);
  else if (shown < 0) showBeat(0);
}

// ---------- render ----------
let shownScore = 0;
let anim = 0;
function render() {
  if (!DRIVE) follow();
  const score = Math.round((S.m?.score ?? 0) * 100);
  const fase = faseOf();
  document.body.dataset.fase = fase ?? 'geen';
  $('arc').style.strokeDasharray = `${score} 100`;
  if (score !== shownScore && !anim) {
    const from = shownScore;
    const t0 = performance.now();
    const tick = (now) => {
      const f = Math.min(1, (now - t0) / 900);
      $('score').textContent = `${Math.round(from + (score - from) * (1 - (1 - f) ** 3))}%`;
      if (f < 1) anim = requestAnimationFrame(tick);
      else { anim = 0; shownScore = score; }
    };
    anim = requestAnimationFrame(tick);
  }
  for (const li of $('fases').children) {
    li.classList.toggle('on', li.dataset.f === fase);
    li.classList.toggle('past', Boolean(fase) && FASES.indexOf(li.dataset.f) < FASES.indexOf(fase));
  }
  // One chip per signal, labels blurred: the customer's reasons stay theirs, the sensitive ones are only a lock
  const open = S.m?.waarom?.length ?? 0;
  const priv = S.m?.andereSignalen ?? 0;
  const chips = $('chips');
  const want = [...Array(open).fill('o'), ...Array(priv).fill('p')];
  const have = [...chips.children].map((c) => c.dataset.k);
  if (want.join() !== have.join()) {
    chips.innerHTML = '';
    want.forEach((k, n) => {
      const c = document.createElement('span');
      c.className = `chip ${k === 'p' ? 'priv' : ''} ${n >= have.length ? 'new' : ''}`;
      c.dataset.k = k;
      c.innerHTML = k === 'p' ? '<i>🔒</i><s>privé</s>' : `<i>✦</i><s>${'█'.repeat(5 + ((n * 7) % 6))} ${'█'.repeat(3 + ((n * 5) % 5))}</s>`;
      c.style.animationDelay = `${Math.max(0, n - have.length) * 140}ms`;
      chips.append(c);
    });
  }
}

// ---------- the app, live and untouchable ----------
const iframe = document.querySelector('#phone iframe');
const appOrigin = (() => { try { return new URL(appUrl).origin; } catch { return ''; } })();
let appUser;
function loadApp() {
  appUser = undefined;
  iframe.src = `${appUrl}/?t=${Date.now()}`;
}
// The app's showcase bridge: it says who is logged in, and logs in as the demo customer when asked
addEventListener('message', (e) => {
  if (e.source !== iframe.contentWindow || e.origin !== appOrigin || e.data?.kateStudio !== 'ready') return;
  appUser = e.data.user ?? null;
  if (!appUser) iframe.contentWindow.postMessage({ kateStudio: 'login' }, appOrigin);
});
setInterval(() => { if (appUser === undefined) iframe.contentWindow?.postMessage({ kateStudio: 'hello' }, appOrigin); }, 2000);

function fit() {
  const box = document.querySelector('.device');
  const s = Math.min((box.clientWidth - 16) / PHONE.w, (box.clientHeight - 56) / PHONE.h, 1.15);
  document.documentElement.style.setProperty('--phone-scale', String(Math.max(0.3, s)));
}
new ResizeObserver(fit).observe(document.querySelector('.device'));

// ---------- kiosk niceties ----------
let idle = 0;
addEventListener('mousemove', () => {
  document.body.classList.remove('nocursor');
  clearTimeout(idle);
  idle = setTimeout(() => document.body.classList.add('nocursor'), 2500);
});
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') location.href = '/';
  if (e.key === 'f') document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.().catch(() => {});
});

loadApp();
fit();
poll();
setInterval(() => { if (!document.hidden) poll(); }, POLL_MS);
if (DRIVE) drive();
else showBeat(0);
})();
