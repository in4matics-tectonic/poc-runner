// Pitch mode (/pitch): plays the 3-minute finals script by itself, on a fixed clock, and loops. The timeline below
// follows the pitch script (Claude Docs "KBC Momentum: finals pitch script") to the second, so the screen keeps pace
// with the speaker. Every step is real: the demo clock, Jonas's own AI sharing through MCP, the adviser's graph and
// the opportunity sent to the app. It drives the panes through the same postMessage bridge as the guided tour.
// Steps a pane can't do yet fall back to the same backend call, so the story always reaches the next beat.
// Keys: c captions · t timer · r restart · Esc back to the showcase. ?captions&timer turn them on from the URL.
// Uses app.js: PARTS, panels, url, api, resetDemo, setChatApp, chatApp, fit.

(() => {
if (location.pathname.replace(/\/$/, '') !== '/pitch') return;

const TOM = 'K-2024-0417';
const JONAS = 'K-2022-0311';
const LOOP_S = 180;
const params = new URLSearchParams(location.search);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const $p = (id) => document.getElementById(id);

const S = {
  gen: 0, // bumped on restart: older loops stop
  t0: 0,
  playing: false,
  beat: null,
  users: { app: undefined, backoffice: undefined, chat: undefined }, // undefined = no answer from the pane yet
  chatApp: null,
  llm: null,
  co2: null, // the possible link the adviser sends to Jonas
  captions: params.has('captions'),
  timer: params.has('timer'),
};

// ---------- layouts: which panes are on screen, side by side ----------
const LAYOUTS = {
  duo: { areas: '"app backoffice"', cols: 'minmax(360px, 30%) minmax(0, 1fr)', show: ['app', 'backoffice'] },
  chat: { areas: '"chat backoffice"', cols: 'minmax(0, 1fr) minmax(0, 1fr)', show: ['chat', 'backoffice'] },
  backoffice: { areas: '"backoffice"', cols: 'minmax(0, 1fr)', show: ['backoffice'] },
};
const stage = document.getElementById('stage');
// Always applies the latest wanted layout, so a late view-transition callback can't bring back an older one
let wanted = null;
function applyLayout() {
  if (!wanted) return;
  const { name, main } = wanted;
  const L = LAYOUTS[name];
  document.body.dataset.mode = 'pitch';
  Object.assign(stage.style, { gridTemplateAreas: L.areas, gridTemplateColumns: L.cols, gridTemplateRows: 'minmax(0, 1fr)' });
  for (const id of PARTS) {
    const p = panels[id];
    const on = L.show.includes(id);
    p.classList.toggle('p-off', !on);
    p.classList.remove('in-rail');
    p.classList.toggle('is-main', id === main);
    p.style.gridArea = on ? id : 'auto';
    p.querySelector('iframe').tabIndex = -1;
  }
  // Pane headers in English (the showcase's own are Dutch)
  panels.backoffice.querySelector('h2').textContent = 'Back office';
  panels.backoffice.querySelector('.who').innerHTML = 'adviser · <code>adviseur</code>';
  panels.chat.querySelector('h2').textContent = "Jonas's own AI";
  requestAnimationFrame(() => PARTS.forEach(fit));
}
function layout(name, main) {
  const key = `${name}:${main}`;
  if (stage.dataset.pitchLayout === key) return;
  stage.dataset.pitchLayout = key;
  wanted = { name, main };
  if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) return applyLayout();
  const t = document.startViewTransition(applyLayout);
  t.ready.catch(() => {});
  t.finished.catch(() => {});
  // A view transition waits for a painted frame; on a busy or covered screen the beat can't wait for that
  setTimeout(applyLayout, 700);
}

// ---------- the script ----------
// Captions are the speaker's lines, for rehearsing. Times in seconds from the start of the pitch.
const BEATS = [
  { from: 0, label: 'Hook', slide: 'hook', layout: ['duo', 'app'],
    say: 'A baby on the way. A second ship for your business. Today you handle the biggest moments in your life on your own. What if your bank noticed first, asked first, and then arranged everything for you?' },
  { from: 15, label: 'Tom & Lien · signals', layout: ['duo', 'backoffice'],
    say: "Tom and Lien haven't told anyone yet. But their bank sees a purchase at a baby store, a childcare registration, a question to their own AI. Medical signals deliberately never count." },
  { from: 30, label: 'Tom & Lien · Kate asks', layout: ['duo', 'app'],
    say: 'Kate asks first. Only after a yes does she make a proposal. The customer decides.' },
  { from: 42, label: 'Tom & Lien · Kate arranges', layout: ['duo', 'app'],
    say: "Four things are already in order. Kate handles the rest: the mortgage cover, the hospital insurance, and she prepares the child benefit claim with the government. And the car? Kate doesn't push a new one. She asks whether the pram fits in the boot of the i4." },
  { from: 65, label: 'Tom & Lien · arranged', layout: ['duo', 'app'],
    say: "All arranged. A smart contract puts a Kate Coin bonus on the little one's savings plan. From hunch to handled in one minute." },
  { from: 80, label: 'Jonas · own AI', layout: ['chat', 'chat'],
    say: 'Jonas runs Stroomvaart: electric inland shipping on the Scheldt. He asks his own AI how to finance a second ship. With his consent, that AI shares only the moment with KBC. Never the conversation.' },
  { from: 93, label: 'Jonas · the network', layout: ['backoffice', 'backoffice'],
    say: "On KBC's side, the adviser sees Stroomvaart's network: ten ecosystems, from his KBC loans to partners that share data, like Billit and Encon. The engine suggests new links, and shows why. Three partners point the same way: CO2 insight. Shippers ask for CO2 figures, and electric shipping is exactly his edge. One click, and the opportunity goes to Jonas." },
  // The app comes on screen as the opportunity goes out: its world flies in while the adviser's dialog says "sent"
  { from: 118, label: 'Jonas · the network', layout: () => (S.users.app === 'jonas' ? ['duo', 'backoffice'] : ['backoffice', 'backoffice']), say: null },
  { from: 123, label: 'Jonas · the opportunity', layout: () => (S.users.app === 'jonas' ? ['duo', 'app'] : ['backoffice', 'backoffice']),
    say: "Seconds later it's in his app, and Jonas decides for himself. Jonas grows, the partner gains a customer, KBC finances the second ship." },
  { from: 135, label: 'Closing · network', layout: ['backoffice', 'backoffice'],
    say: 'Two customers, one engine, for millions of customers.' },
  { from: 140, label: 'Closing', slide: 'close', layout: ['backoffice', 'backoffice'],
    say: 'Customers go from intent to action without searching. KBC shows up at the right moment, with the right product. Partners get customers who gave consent themselves. And trust is built in: score and phase come from a fixed rule, not a language model. Health data never counts. Every source asks for consent, and the customer always decides. KBC Momentum: your bank helps, before you know you need help.' },
  { from: 165, label: 'Questions', slide: 'end', layout: ['backoffice', 'backoffice'], say: '' },
];

const clockNext = () => api('adviseur', 'POST', '/demo/volgende');
const momentOf = async (klant, moment) => (await api('adviseur', 'GET', `/klanten/${klant}/momenten`)).momenten.find((m) => m.moment === moment);

/** What happens when: [second, action]. Actions run in the background; a slow one never holds up the clock. */
const CUES = [
  // Tom & Lien: four demo weeks bring the moment to "vragen" (71%) before Kate asks
  [16, clockNext], [19, clockNext], [22, clockNext], [25, clockNext],
  [33, () => send('app', { kateStudio: 'moment', answer: 'confirm' })],
  [37, async () => {
    // The app couldn't press "Bevestigen" itself: the same call, as Tom
    if (!(await momentOf(TOM, 'GEZINSUITBREIDING'))?.bevestigd) await api('tom', 'POST', `/klanten/${TOM}/momenten/GEZINSUITBREIDING/bevestig`);
  }],
  [40, clockNext],
  [43, () => send('app', { kateStudio: 'checklist', open: true })],
  [45, clockNext],
  [48, () => send('app', { kateStudio: 'checklist', run: 'all' })],
  [50, clockNext], // week 20: Tom & Lien 91% (voorstel), Jonas 85%
  [66, () => send('app', { kateStudio: 'checklist', open: false })],
  [77, () => send('backoffice', { kateStudio: 'page', page: 'klanten', klantId: JONAS })],

  // Jonas: his own AI shares the moment (85% -> 93%)
  [81, () => {
    if (S.llm === false || S.chatApp !== 'chatgpt' || S.users.chat !== 'jonas') return shareDirect();
    send('chat', { kateStudio: 'ask', text: 'I want to have a second electric push boat built for Stroomvaart. How do I best finance it? Share "business expansion" (planning) with KBC.' });
  }],
  [89, async () => { if (!(await sharedByJonas())) await shareDirect(); }],

  // The graph, full screen: pick the suggestion, show why, send it to Jonas's app
  [93, async () => {
    send('backoffice', { kateStudio: 'graaf', vol: true });
    S.co2 = await topSuggestion();
  }],
  [101, () => S.co2 && send('backoffice', { kateStudio: 'knoop', id: S.co2 })],
  // The app switches to Jonas while it's off screen, so it's ready when his beat comes
  [103, () => send('app', { kateStudio: 'login', user: 'jonas' })],
  [109, () => S.co2 && send('backoffice', { kateStudio: 'kans', link: S.co2 })],
  [111, () => send('backoffice', { kateStudio: 'kansTyp', tekst: 'Shippers increasingly ask for CO2 figures. Your electric fleet turns that into an edge right away.' })],
  [118, () => send('backoffice', { kateStudio: 'kansVerstuur' })],
  [123, () => send('backoffice', { kateStudio: 'kansSluit' })],
  [128, () => send('app', { kateStudio: 'kans', answer: 'interesse' })],
  [131, answerKansDirect],

  // Closing: every customer in one network, then the slides
  [135, () => {
    send('backoffice', { kateStudio: 'graaf', vol: false });
    send('backoffice', { kateStudio: 'page', page: 'netwerk' });
  }],
];

async function sharedByJonas() {
  const m = await momentOf(JONAS, 'ZAAK_UITBREIDEN');
  return Boolean(m?.signalenDetail?.some((s) => s.bron === 'EIGEN_AI'));
}
/** The call the MCP tool share_life_moment makes, straight to the backend as Jonas (no LLM) */
const shareDirect = () => api('jonas', 'POST', `/klanten/${JONAS}/momenten/delen`, { moment: 'ZAAK_UITBREIDEN', fase: 'plannend' });

/** The suggestion the script names (CO2 insight), or else the strongest possible link */
async function topSuggestion() {
  const eco = await api('adviseur', 'GET', `/klanten/${JONAS}/ecosystemen`);
  const mogelijk = eco.clusters.flatMap((c) => c.links).filter((l) => l.status === 'mogelijk').sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return (mogelijk.find((l) => /co2/i.test(l.ref)) ?? mogelijk[0])?.id ?? null;
}

/** Jonas answers "interesse" in his app; if the app can't, the same call as Jonas */
async function answerKansDirect() {
  const kansen = await api('jonas', 'GET', `/klanten/${JONAS}/kansen`);
  const kans = kansen.find((k) => k.link.id === S.co2 && (k.status === 'nieuw' || k.status === 'gezien'));
  if (kans) await api('jonas', 'PUT', `/klanten/${JONAS}/kansen/${kans.id}`, { status: 'interesse' });
}

// ---------- overlay: slides, captions, timer ----------
const SLIDES = {
  prep: () => `
    <p class="ps-kicker">KBC Momentum</p>
    <h1>Getting ready…</h1>
    <ul class="ps-checks">
      ${[['app', 'App'], ['backoffice', 'Back office'], ['chat', 'Own AI']].map(([p, n]) =>
        `<li class="${ready(p) ? 'ok' : ''}"><span>${ready(p) ? '✓' : '•'}</span>${n} <em>${ready(p) ? S.users[p] : 'waiting…'}</em></li>`).join('')}
    </ul>`,
  hook: () => `
    <p class="ps-kicker">KBC Momentum</p>
    <h1>A baby on the way.<br><em>A second ship.</em></h1>
    <div class="ps-duo">
      <div><b>Tom &amp; Lien</b><span>are expecting a baby</span></div>
      <div><b>Jonas</b><span>wants a second electric push boat</span></div>
    </div>
    <p class="ps-sub">What if your bank noticed first, asked first, and then arranged everything for you?</p>`,
  close: () => `
    <p class="ps-kicker">Two customers, one engine</p>
    <div class="ps-cols">
      <div><b>Customer</b><span>From intent to action, without searching</span></div>
      <div><b>KBC</b><span>At the right moment, with the right product</span></div>
      <div><b>Partner</b><span>Customers who gave consent themselves</span></div>
    </div>
    <p class="ps-trust">Score and phase from a fixed rule, not a language model · Health data never counts · Consent per source · The customer decides</p>
    <h1 class="ps-tag">Your bank helps, before you know<br>you <em>need help</em>.</h1>`,
  end: () => `
    <p class="ps-kicker">KBC Momentum · In4matics</p>
    <h1>Questions?</h1>`,
};

const overlay = document.createElement('div');
overlay.className = 'pitch-ui';
overlay.innerHTML = `
  <section class="p-slide" id="pSlide" hidden></section>
  <p class="p-cap" id="pCap" hidden></p>
  <p class="p-time" id="pTime" hidden></p>
  <p class="p-keys" id="pKeys">c captions · t timer · r restart · Esc exit</p>`;
document.body.append(overlay);

let slideShown = null;
function showSlide(name) {
  const el = $p('pSlide');
  if (!name) { el.classList.remove('on'); slideShown = null; setTimeout(() => { if (!slideShown) el.hidden = true; }, 500); return; }
  const html = SLIDES[name]();
  if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; }
  el.dataset.slide = name;
  el.hidden = false;
  slideShown = name;
  requestAnimationFrame(() => el.classList.add('on'));
}

function showBeat(b) {
  // say: null keeps the previous beat's caption (a layout change within the same spoken line)
  S.beat = b.say === null ? { ...b, say: S.beat?.say } : b;
  const [name, main] = typeof b.layout === 'function' ? b.layout() : b.layout;
  layout(name, main);
  showSlide(b.slide ?? null);
  renderUi();
}

const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
function renderUi() {
  const cap = $p('pCap');
  cap.hidden = !S.captions || !S.playing || !S.beat?.say;
  cap.textContent = S.beat?.say ?? '';
  const time = $p('pTime');
  time.hidden = !S.timer;
  time.textContent = S.playing ? `${mmss((performance.now() - S.t0) / 1000)} · ${S.beat?.label ?? ''}` : 'getting ready';
  if (slideShown === 'prep') showSlide('prep');
}
setInterval(renderUi, 250);

// ---------- the loop ----------
async function sleepUntil(s, gen) {
  for (;;) {
    const left = S.t0 + s * 1000 - performance.now();
    if (gen !== S.gen || left <= 0) return;
    await wait(Math.min(left, 200));
  }
}

async function prepare(gen) {
  S.playing = false;
  showSlide('prep');
  send('backoffice', { kateStudio: 'kansSluit' });
  send('backoffice', { kateStudio: 'graaf', vol: false });
  if (chatApp !== 'chatgpt') { S.users.chat = undefined; setChatApp('chatgpt'); }
  try {
    await resetDemo(); // backend (clock, signals, kansen), every chat, and a fresh load of each pane
  } catch (e) {
    console.warn('[pitch] reset', e);
  }
  for (const p of PARTS) S.users[p] = undefined;
  const end = Date.now() + 25000;
  while (gen === S.gen && Date.now() < end && !PARTS.every(ready)) {
    for (const p of PARTS) if (S.users[p] === undefined) send(p, { kateStudio: 'hello' });
    await wait(500);
  }
  send('backoffice', { kateStudio: 'page', page: 'klanten', klantId: TOM });
  await wait(1500);
}

async function play(gen) {
  S.t0 = performance.now();
  S.playing = true;
  S.co2 = null;
  const cues = [...BEATS.map((b) => [b.from, () => showBeat(b)]), ...CUES].sort((a, b) => a[0] - b[0]);
  for (const [t, fn] of cues) {
    await sleepUntil(t, gen);
    if (gen !== S.gen) return;
    Promise.resolve().then(fn).catch((e) => console.warn(`[pitch] cue ${t}s`, e));
  }
  await sleepUntil(LOOP_S, gen);
}

async function run() {
  const gen = ++S.gen;
  while (gen === S.gen) {
    await prepare(gen);
    if (gen !== S.gen) return;
    await play(gen);
  }
}

// ---------- bridge to the panes (same protocol as the guided tour) ----------
const originOf = (p) => { try { return new URL(url(p)).origin; } catch { return ''; } };
function send(part, msg) {
  const w = panels[part]?.querySelector('iframe')?.contentWindow;
  if (w) w.postMessage(msg, originOf(part));
}
// Who each pane should be before the pitch starts: the app shows Tom & Lien (as tom or lien), the chat is Jonas's own AI
const WANT = { app: 'tom', backoffice: 'adviseur', chat: 'jonas' };
const LOGIN = { app: { kateStudio: 'login', user: 'tom' }, backoffice: { kateStudio: 'login' }, chat: { kateStudio: 'login', user: 'jonas' } };
function ready(p) {
  const u = S.users[p];
  return p === 'app' ? u === 'tom' || u === 'lien' : u === WANT[p];
}
addEventListener('message', (e) => {
  const part = PARTS.find((p) => panels[p].querySelector('iframe').contentWindow === e.source);
  if (!part || e.origin !== originOf(part) || typeof e.data?.kateStudio !== 'string') return;
  const m = e.data;
  if (m.kateStudio === 'ready') {
    S.users[part] = m.user ?? null;
    if (part === 'chat') S.chatApp = m.app;
    if (part === 'app') panels.app.querySelector('.who').innerHTML = `customer · <code>${m.user ?? '…'}</code>`;
    // Before the pitch starts every pane gets its demo user; the chat is Jonas's own AI
    if (!S.playing && !ready(part)) send(part, LOGIN[part]);
  } else if (m.kateStudio === 'llm') {
    S.llm = m.llm;
  } else if (m.kateStudio === 'error') {
    console.warn(`[pitch] ${part}:`, m.error);
  }
});

// ---------- keys: our own, and none of the showcase's (they would change the layout) ----------
addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  e.stopImmediatePropagation();
  if (e.key === 'Escape') location.href = '/';
  else if (e.key === 'c') { S.captions = !S.captions; renderUi(); }
  else if (e.key === 't') { S.timer = !S.timer; renderUi(); }
  else if (e.key === 'r') run();
}, true);

document.body.dataset.pitch = '';
setTimeout(() => $p('pKeys').classList.add('gone'), 6000);
layout('duo', 'app');
run();
})();
