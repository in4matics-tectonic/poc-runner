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
  /** Who the app should show now: Tom & Lien, then Jonas from his network beat on. */
  appWant: 'tom',
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
  { from: 12, label: 'Tom & Lien · signals', layout: ['duo', 'backoffice'],
    consent: { who: 'Tom & Lien', yes: ['Their account transactions', 'How they use KBC Mobile', 'What their own AI shares'], no: 'Health data: never counted' },
    say: "Tom and Lien haven't told anyone yet. But from the sources they allowed, their bank sees a purchase at a baby store, a childcare registration, a question to their own AI. Medical signals never count." },
  { from: 24, label: 'Tom & Lien · the agent decides', layout: ['duo', 'backoffice'],
    consent: { who: 'Tom & Lien', yes: ['Their account transactions', 'How they use KBC Mobile', 'What their own AI shares'], no: 'Health data: never counted' },
    say: "KBC's agent now decides who should approach them. Retail, standard products, very digital: Kate handles this herself. No adviser needed." },
  { from: 30, label: 'Tom & Lien · Kate asks', layout: ['duo', 'app'],
    say: 'Kate asks first. Only after a yes does anything happen.' },
  { from: 37, label: 'Tom & Lien · Kate arranges', layout: ['duo', 'app'],
    say: "Four things are already in order. Kate arranges the rest with one tap: the mortgage cover, the hospital insurance, the child benefit. And she doesn't push a new car: she checks whether the pram fits in the i4." },
  { from: 52, label: "Tom & Lien · the agent's offer", layout: ['duo', 'app'],
    consent: { who: 'Tom & Lien', yes: ['Moment confirmed by Tom', 'Offer only after their yes'] },
    say: 'Then the agent goes one step further on its own: a savings plan for the little one, straight into the app. Tom says yes. No person touched it.' },
  { from: 65, label: 'Jonas · own AI', layout: ['chat', 'chat'],
    consent: { who: 'Jonas', yes: ['His own AI shares the moment, after his yes'], no: 'The conversation itself: never shared' },
    say: 'Jonas runs Stroomvaart: electric inland shipping on the Scheldt. He asks his own AI how to finance a second ship, and explicitly lets it share only the moment with KBC. Never the conversation.' },
  { from: 78, label: 'Jonas · the agent calls an adviser', layout: ['backoffice', 'backoffice'],
    say: "For Jonas the agent decides differently. A business customer, a big investment: he'll engage more with a person. So it hands this to an adviser, with a task and suggestions." },
  { from: 88, label: 'Jonas · the network', layout: ['backoffice', 'backoffice'],
    consent: { who: 'Jonas', yes: ['Billit, Encon and Kube share data with KBC: Jonas switched them on', 'Other partners: KBC only knows they exist'] },
    say: "The adviser opens Stroomvaart's network: ten ecosystems, his KBC loans, the partners he shares data with. The engine shows why it suggests CO2 insight: Encon, Kube and Sweco all point there. And it sees more: Billit and Kube both work for Jonas, but not with each other. One click proposes both." },
  // The app comes on screen as the proposals go out: Jonas's world flies in next to the graph
  { from: 121, label: 'Jonas · the network', layout: () => (S.users.app === 'jonas' ? ['duo', 'backoffice'] : ['backoffice', 'backoffice']), say: null },
  { from: 125, label: 'Jonas · his answer', layout: () => (S.users.app === 'jonas' ? ['duo', 'app'] : ['backoffice', 'backoffice']),
    consent: { who: 'Jonas', yes: ['Billit and Kube exchange data only after his yes', 'He can switch it off any time'] },
    say: 'Seconds later both proposals are in his app. Jonas says yes to the CO2 insight, and yes to letting Billit and Kube share data with each other. Nothing flows without his yes.' },
  { from: 133, label: 'Jonas · partners connected', layout: ['backoffice', 'backoffice'],
    consent: { who: 'Jonas', yes: ['Billit and Kube exchange data only after his yes', 'He can switch it off any time'] },
    say: 'And in his network the line turns solid: two partners now work together, for one customer.' },
  { from: 138, label: 'Closing · network', layout: ['backoffice', 'backoffice'],
    say: 'One agent, for millions of customers: automatic where it can, a person where it matters.' },
  { from: 143, label: 'Closing', slide: 'close', layout: ['backoffice', 'backoffice'],
    say: 'Customers go from intent to action without searching. KBC shows up at the right moment, through the right channel. Partners get customers who gave consent, and work together for them. And trust is built in: no language model decides, health data never counts, and the customer always has the last word. KBC Momentum: your bank helps, before you know you need help.' },
  { from: 166, label: 'Questions', slide: 'end', layout: ['backoffice', 'backoffice'], say: '' },
];

const clockNext = () => api('adviseur', 'POST', '/demo/volgende');
const momentOf = async (klant, moment) => (await api('adviseur', 'GET', `/klanten/${klant}/momenten`)).momenten.find((m) => m.moment === moment);
const PAIR = 'koppeling:billit~kube';

/** What happens when: [second, action]. Actions run in the background; a slow one never holds up the clock. */
const CUES = [
  // Tom & Lien: four demo weeks bring the moment to "vragen" (71%); the agent decides "automatisch"
  [13, clockNext], [16, clockNext], [19, clockNext], [22, clockNext],
  [32, () => send('app', { kateStudio: 'moment', answer: 'confirm' })],
  [35, async () => {
    // The app couldn't press "Bevestigen" itself: the same call, as Tom
    if (!(await momentOf(TOM, 'GEZINSUITBREIDING'))?.bevestigd) await api('tom', 'POST', `/klanten/${TOM}/momenten/GEZINSUITBREIDING/bevestig`);
  }],
  [36, clockNext],
  [38, () => send('app', { kateStudio: 'checklist', open: true })],
  [39, clockNext],
  [40, () => send('app', { kateStudio: 'checklist', run: 'all' })],
  [42, clockNext], // week 20: Tom & Lien 91% and confirmed = voorstel, so the agent sends its offer; Jonas 85%
  [52, () => send('app', { kateStudio: 'checklist', open: false })], // the agent's offer pops up
  [57, () => send('app', { kateStudio: 'kans', answer: 'interesse' })],
  [60, () => answerOpenKansen('tom', TOM)],
  [62, () => send('backoffice', { kateStudio: 'page', page: 'klanten', klantId: JONAS })],

  // Jonas: his own AI shares the moment (85% -> 93%); the agent calls in an adviser
  [66, () => {
    if (S.llm === false || S.chatApp !== 'chatgpt' || S.users.chat !== 'jonas') return shareDirect();
    send('chat', { kateStudio: 'ask', text: 'I want to have a second electric push boat built for Stroomvaart. How do I best finance it? Share "business expansion" (planning) with KBC.' });
  }],
  [76, async () => { if (!(await sharedByJonas())) await shareDirect(); }],

  // The graph, full screen: the CO2 suggestion and its reasons, then the partner pair; both go to Jonas's app
  [88, async () => {
    send('backoffice', { kateStudio: 'graaf', vol: true });
    S.co2 = await topSuggestion();
  }],
  [92, () => S.co2 && send('backoffice', { kateStudio: 'knoop', id: S.co2 })],
  [95, () => { S.appWant = 'jonas'; send('app', { kateStudio: 'login', user: 'jonas' }); }], // off screen: ready when his beat comes
  [99, () => S.co2 && send('backoffice', { kateStudio: 'kans', link: S.co2 })],
  [100, () => send('backoffice', { kateStudio: 'kansTyp', tekst: 'Shippers increasingly ask for CO2 figures. Your electric fleet turns that into an edge right away.' })],
  [105, () => send('backoffice', { kateStudio: 'kansVerstuur' })],
  [107, () => send('backoffice', { kateStudio: 'kansSluit' })],
  [108, () => send('backoffice', { kateStudio: 'knoop', id: 'partner:billit' })],
  [113, () => send('backoffice', { kateStudio: 'kans', link: PAIR })],
  [114, () => send('backoffice', { kateStudio: 'kansTyp', tekst: 'Let Billit turn your shore-power invoices into CO2 figures in Kube: no more copying numbers.' })],
  [119, () => send('backoffice', { kateStudio: 'kansVerstuur' })],
  [121, () => send('backoffice', { kateStudio: 'kansSluit' })],
  [127, () => send('app', { kateStudio: 'kans', answer: 'interesse' })],
  [131, () => send('app', { kateStudio: 'kans', answer: 'interesse' })],
  [134, () => answerOpenKansen('jonas', JONAS)],

  // Closing: every customer in one network, then the slides
  [138, () => {
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

/** The customer says yes in the app; whatever the app couldn't answer itself, the same call as the customer */
async function answerOpenKansen(user, klant) {
  const kansen = await api(user, 'GET', `/klanten/${klant}/kansen`);
  for (const k of kansen.filter((x) => x.status === 'nieuw' || x.status === 'gezien')) {
    await api(user, 'PUT', `/klanten/${klant}/kansen/${k.id}`, { status: 'interesse' });
  }
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
      <div><img src="/img/tom-lien.jpg" alt=""><b>Tom &amp; Lien</b><span>just bought their house, and are expecting a baby</span></div>
      <div><img src="/img/jonas.jpg" alt=""><b>Jonas</b><span>runs Stroomvaart, and wants a second electric push boat</span></div>
    </div>
    <p class="ps-sub">What if your bank noticed first, asked first, and then arranged everything for you?</p>`,
  close: () => `
    <p class="ps-kicker">One agent, millions of customers</p>
    <p class="ps-sub">Automatic where it can. A person where it matters.</p>
    <div class="ps-cols">
      <div><b>Customer</b><span>From intent to action, without searching</span></div>
      <div><b>KBC</b><span>At the right moment, with the right product</span></div>
      <div><b>Partner</b><span>Customers who gave consent, and partners that work together for them</span></div>
    </div>
    <p class="ps-trust">No language model decides: scores, phases and channels come from transparent rules · Health data never counts · Consent per source and per partner pair · The customer decides</p>
    <h1 class="ps-tag">Your bank helps, before you know<br>you <em>need help</em>.</h1>`,
  end: () => `
    <p class="ps-kicker">KBC Momentum · In4matics</p>
    <h1>Questions?</h1>`,
};

const overlay = document.createElement('div');
overlay.className = 'pitch-ui';
overlay.innerHTML = `
  <section class="p-slide" id="pSlide" hidden></section>
  <aside class="p-consent" id="pConsent" hidden></aside>
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

const escP = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
function renderConsent() {
  const el = $p('pConsent');
  const c = S.playing && !S.beat?.slide ? S.beat?.consent : null;
  el.hidden = !c;
  if (!c) return;
  const photo = c.who === 'Jonas' ? '/img/jonas.jpg' : '/img/tom-lien.jpg';
  const html = `<div class="pc-who"><img src="${photo}" alt=""><span>${escP(c.who)}</span></div><p class="pc-head">🛡 Shared with consent</p><ul>${c.yes.map((y) => `<li><b>✓</b>${escP(y)}</li>`).join('')}${c.no ? `<li class="no"><b>✕</b>${escP(c.no)}</li>` : ''}</ul>`;
  if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; }
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
  renderConsent();
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
  S.appWant = 'tom';
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
  if (p === 'app') return S.appWant === 'jonas' ? u === 'jonas' : u === 'tom' || u === 'lien';
  return u === WANT[p];
}
const loginFor = (p) => (p === 'app' ? { kateStudio: 'login', user: S.appWant } : LOGIN[p]);
// A login can fail (rate limit, a restart): keep asking until each pane shows the right user, also mid-run
setInterval(() => { for (const p of PARTS) if (S.users[p] !== undefined && !ready(p)) send(p, loginFor(p)); }, 4000);
addEventListener('message', (e) => {
  const part = PARTS.find((p) => panels[p].querySelector('iframe').contentWindow === e.source);
  if (!part || e.origin !== originOf(part) || typeof e.data?.kateStudio !== 'string') return;
  const m = e.data;
  if (m.kateStudio === 'ready') {
    S.users[part] = m.user ?? null;
    if (part === 'chat') S.chatApp = m.app;
    if (part === 'app') panels.app.querySelector('.who').innerHTML = `customer · <code>${m.user ?? '…'}</code>`;
    // Before the pitch starts every pane gets its demo user; the chat is Jonas's own AI
    if (!ready(part)) send(part, loginFor(part));
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
