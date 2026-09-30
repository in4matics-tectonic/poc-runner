// KBC Momentum PoC showcase: the three parts side by side, focus one, zoom back out.
// The iframes are never moved in the DOM (that would reload them); only the grid placement changes,
// so every part keeps its state (login, scroll, chat) while you switch.

const CONFIG = window.POC ?? {};
const PORTS = Object.assign({ app: 7001, backoffice: 7002, chat: 7003, backend: 7004 }, CONFIG.ports);
const SUBDOMAIN = { app: 'app', backoffice: 'backoffice', chat: 'chat', backend: 'api' };
const host = location.hostname || 'localhost';
// Deployed: https://app.<domain>, …  Local: http://localhost:7001, …
const url = (svc) =>
  CONFIG.domain
    ? `${location.protocol}//${SUBDOMAIN[svc]}.${CONFIG.domain}`
    : `${location.protocol === 'https:' ? 'https' : 'http'}://${host}:${PORTS[svc]}`;

const PARTS = ['app', 'backoffice', 'chat'];
const NAMES = { app: 'de app', backoffice: 'de backoffice', chat: 'de chat' };
// The chat pane switches between the customer's own AI (via MCP) and Kate in KBC Mobile
const CHAT_APPS = {
  chatgpt: { title: 'Eigen AI', phone: false },
  gemini: { title: 'Eigen AI', phone: false },
  claude: { title: 'Eigen AI', phone: false },
  kate: { title: 'Kate · KBC Mobile', phone: true },
};
let chatApp = 'chatgpt';
try { if (CHAT_APPS[localStorage.getItem('poc.chatApp')]) chatApp = localStorage.getItem('poc.chatApp'); } catch {}
const MODES = ['overview', ...PARTS];
// Width each part is designed for; smaller slots scale the page down instead of reflowing it
const DESIGN_WIDTH = { backoffice: 1280, chat: 720 };
const PHONE = { w: 410, h: 864 };

const panels = Object.fromEntries(PARTS.map((id) => [id, document.querySelector(`.panel[data-id="${id}"]`)]));

// ---------- iframes ----------
const pageUrl = (id) => (id === 'chat' ? `${url('chat')}/?app=${chatApp}` : url(id));

function load(id, bust = false) {
  const p = panels[id];
  p.classList.add('loading');
  p.querySelector('iframe').src = pageUrl(id) + (bust ? `${id === 'chat' ? '&' : '/?'}t=${Date.now()}` : '');
  p.querySelector('[data-act="open"]').href = pageUrl(id);
}

for (const id of PARTS) {
  const p = panels[id];
  const loader = document.createElement('div');
  loader.className = 'loader';
  loader.innerHTML = '<span class="spin"></span><span class="lt"></span>';
  loader.querySelector('.lt').textContent = `${NAMES[id][0].toUpperCase()}${NAMES[id].slice(1)} laden…`;
  p.querySelector('.pb').append(loader);
  p.querySelector('iframe').addEventListener('load', () => p.classList.remove('loading'));
  if (id !== 'chat') load(id); // the chat is loaded by setChatApp below
  p.querySelector('[data-act="reload"]').onclick = () => reload(id);
  p.querySelector('[data-act="focus"]').onclick = () => go(id);
  p.querySelector('.catcher').onclick = () => go(id);
}
document.getElementById('docsLink').href = `${url('backend')}/docs`;

function reload(id) {
  load(id, true);
}

function setChatApp(app) {
  chatApp = app;
  try { localStorage.setItem('poc.chatApp', app); } catch {}
  const p = panels.chat;
  p.querySelector('#chatTitle').textContent = CHAT_APPS[app].title;
  for (const b of p.querySelectorAll('.apps button')) b.setAttribute('aria-pressed', String(b.dataset.app === app));
  // Kate lives in the phone; the own-AI apps are desktop pages
  const frame = p.querySelector('.pb > div');
  frame.className = CHAT_APPS[app].phone ? 'phone' : 'screen';
  frame.removeAttribute('style');
  load('chat');
  fit('chat');
}
for (const b of panels.chat.querySelectorAll('.apps button')) b.onclick = () => b.dataset.app !== chatApp && setChatApp(b.dataset.app);
setChatApp(chatApp);

// ---------- fit each page into its slot ----------
function fit(id) {
  const body = panels[id].querySelector('.pb');
  const w = body.clientWidth;
  const h = body.clientHeight;
  if (!w || !h) return;
  const phone = body.querySelector('.phone');
  if (phone) {
    const s = Math.min((w - 24) / PHONE.w, (h - 24) / PHONE.h, 1);
    const el = phone;
    el.style.transform = `translate(${(w - PHONE.w * s) / 2}px, ${(h - PHONE.h * s) / 2}px) scale(${s})`;
    return;
  }
  const s = Math.min(1, w / DESIGN_WIDTH[id]);
  const el = body.querySelector('.screen');
  el.style.width = `${w / s}px`;
  el.style.height = `${h / s}px`;
  el.style.transform = `scale(${s})`;
}
const ro = new ResizeObserver((entries) => {
  for (const e of entries) fit(e.target.closest('.panel').dataset.id);
});
for (const id of PARTS) ro.observe(panels[id].querySelector('.pb'));

// ---------- modes ----------
function apply(mode) {
  document.body.dataset.mode = mode;
  for (const a of document.querySelectorAll('.modes a')) {
    if (a.dataset.mode === mode) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  const rail = PARTS.filter((id) => id !== mode);
  for (const id of PARTS) {
    const p = panels[id];
    const isMain = id === mode;
    const inRail = mode !== 'overview' && !isMain;
    p.classList.toggle('is-main', isMain);
    p.classList.toggle('in-rail', inRail);
    p.style.gridArea = mode === 'overview' ? id : isMain ? 'main' : `r${rail.indexOf(id) + 1}`;
    // Thumbnails are for looking, not typing: keep them out of the tab order
    p.querySelector('iframe').tabIndex = inRail ? -1 : 0;
  }
  document.title = mode === 'overview' ? 'KBC Momentum PoC' : `${panels[mode].querySelector('h2').textContent} · KBC Momentum PoC`;
  PARTS.forEach(fit);
}

function go(mode) {
  if (!MODES.includes(mode)) mode = 'overview';
  if (location.hash !== `#${mode}`) history.pushState(null, '', `#${mode}`);
  show(mode);
}

function show(mode) {
  if (document.body.dataset.mode === mode && document.body.dataset.ready) return;
  const first = !document.body.dataset.ready;
  document.body.dataset.ready = '1';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!document.startViewTransition || reduce || first) return apply(mode);
  // Switching quickly skips the running transition; that's fine, the layout still applies
  const t = document.startViewTransition(() => apply(mode));
  t.ready.catch(() => {});
  t.finished.catch(() => {});
}

const fromHash = () => (MODES.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'overview');
addEventListener('popstate', () => show(fromHash()));
addEventListener('hashchange', () => show(fromHash()));
document.querySelector('.modes').addEventListener('click', (e) => {
  const a = e.target.closest('a[data-mode]');
  if (!a) return;
  e.preventDefault();
  go(a.dataset.mode);
});
for (const n of document.querySelectorAll('.arch [data-go]')) n.addEventListener('click', () => go(n.dataset.go));

addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest?.('input, textarea, [contenteditable]')) return;
  const i = ['0', '1', '2', '3'].indexOf(e.key);
  if (i >= 0) go(MODES[i]);
  else if (e.key === 'Escape') go('overview');
  else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    const cur = MODES.indexOf(document.body.dataset.mode);
    go(MODES[(cur + (e.key === 'ArrowRight' ? 1 : MODES.length - 1)) % MODES.length]);
  }
});

show(fromHash());

// ---------- service status ----------
// Probed through the gateway (same origin), so we see real status codes
const SERVICES = ['app', 'backoffice', 'chat', 'mcp', 'backend'];
const lastState = {};
async function check(svc) {
  let state = 'down';
  try {
    const res = await fetch(`/status/${svc}`, { cache: 'no-store', signal: AbortSignal.timeout(3000) });
    if (res.ok) state = 'up';
  } catch {}
  for (const el of document.querySelectorAll(`[data-svc="${svc}"]`)) {
    el.dataset.state = state;
    el.title = `${svc}: ${state === 'up' ? 'draait' : 'niet bereikbaar'}`;
  }
  // A part that came up after the page loaded showed an error page: load it for real now
  if (PARTS.includes(svc)) {
    panels[svc].querySelector('.lt').textContent =
      state === 'up' ? `${NAMES[svc][0].toUpperCase()}${NAMES[svc].slice(1)} laden…` : `Wachten tot ${NAMES[svc]} opstart…`;
    if (state === 'down') panels[svc].classList.add('loading');
  }
  if (lastState[svc] === 'down' && state === 'up' && PARTS.includes(svc)) reload(svc);
  lastState[svc] = state;
}
const poll = () => SERVICES.forEach(check);
poll();
setInterval(poll, 4000);
