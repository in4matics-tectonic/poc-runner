// Guided tour of the PoC, aligned with the finals pitch: Tom & Lien, whom KBC's agent hands to Kate fully
// automatically, and Jonas, for whom the agent calls in an adviser who connects his partners in the network graph.
// Every step does something real: it moves the demo clock, lets Jonas's own AI share through MCP, presses buttons
// in the app and the back office, ...
// Meanwhile the dock shows what the backend holds right now and every call as a packet on the architecture map,
// and each pane flashes when the change reaches it. The panes are cross-origin iframes: the tour never reads
// them, it talks to them through a small postMessage bridge (log in, switch page, type a message, press a button)
// and they tell it what happened. Uses app.js: go, setChatApp, chatApp, panels, fit, url, api, resetDemo.

(() => {
const TOM = { klant: 'K-2024-0417', moment: 'GEZINSUITBREIDING', name: 'Tom & Lien', user: 'tom', label: 'Family growth' };
const JONAS = { klant: 'K-2022-0311', moment: 'ZAAK_UITBREIDEN', name: 'Jonas · Stroomvaart', user: 'jonas', label: 'Business expansion' };
const CO2 = 'product:business-co2-insights-and-sector-comparison';
const PAIR = 'koppeling:billit~kube';
/** The customer the tour follows right now (the live panel shows their moment). */
let F = TOM;
const POLL_MS = 1500;

const $t = (sel, root = document) => root.querySelector(sel);
const escT = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const pct = (x) => `${Math.round((x ?? 0) * 100)}%`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await wait(150);
  }
  return false;
}

// ---------- state ----------
const S = {
  open: false,
  i: 0,
  week: 0,
  weken: [7, 10, 12, 14, 16, 18, 20],
  m: null, // the moment as the adviser sees it (full signal detail)
  k: null, // the same moment as the customer sees it (privacy-filtered)
  online: false,
  llm: null,
  users: { app: undefined, backoffice: undefined, chat: undefined }, // undefined = no answer from the bridge yet
  chatBusy: false,
  kate: { vraag: false, plan: false },
  seen: { gedeeld: 0, ingetrokken: 0, via: 'mcp' }, // audit ts (ms) of the last share / revoke, and how
  direct: 0, // when the tour itself made a call as the customer (no LLM)
  agent: null, // the agent's decision for the followed moment
  kansen: [], // offers sent to the followed customer
  appUser: 'tom', // who the app should show: Tom & Lien first, Jonas in his last steps
  stepAt: 0,
  running: null,
  err: null,
  wantLogin: false,
  highlight: null,
};
const FASES = ['stil', 'info', 'vragen', 'voorstel'];
const BRON = { EIGEN_AI: 'Eigen AI', DOCCLE: 'Doccle', GEOFENCE: 'Geofence', APP: 'App', REKENING: 'Rekening' };

// ---------- the story ----------
const faseOf = () => S.m?.fase ?? 'stil';
const faseAt = (f) => FASES.indexOf(faseOf()) >= FASES.indexOf(f);
const sharedNow = () => S.seen.gedeeld >= S.stepAt;
const revokedNow = () => S.seen.ingetrokken >= S.stepAt;

/** Moves the demo clock one week at a time until `stop` holds, so every signal lands visibly */
async function playUntil(stop) {
  for (let n = 0; n < 12 && !stop(); n++) {
    if (S.week >= S.weken.at(-1)) break;
    await api('adviseur', 'POST', '/demo/volgende');
    await refresh();
    if (!stop()) await wait(1700);
  }
}

/** The no-LLM fallback: the same call the MCP tool makes, straight to the backend as the customer */
function direct(method, path, body) {
  S.direct = Date.now();
  return api(F.user, method, path, body);
}

/** Switches the chat pane; it reloads, so wait for its bridge to say hello again before talking to it */
function useChat(app) {
  if (chatApp === app) return;
  S.users.chat = undefined;
  S.chatApp = null;
  setChatApp(app);
}

async function askAi(text) {
  if (chatApp === 'kate') useChat('chatgpt');
  if (!(await until(() => S.users.chat && S.chatApp && S.chatApp !== 'kate', 10000))) throw new Error('De chat is niet aangemeld.');
  send('chat', { kateStudio: 'ask', text });
  await until(() => S.chatBusy, 4000);
  await until(() => !S.chatBusy, 90000);
}

const kansVan = (link) => S.kansen.find((k) => k.link.id === link);
const agentLine = () => (S.agent ? `app <b>${pct(S.agent.engagement.app)}</b> · adviser <b>${pct(S.agent.engagement.adviseur)}</b>` : '');
async function playTo(week) {
  for (let n = 0; n < 10 && S.week < week; n++) {
    await api('adviseur', 'POST', '/demo/volgende');
    await refresh();
    if (S.week < week) await wait(1700);
  }
}
/** Sends a possible link (or partner pair) to Jonas's app through the back office's own dialog, typed visibly. */
async function sendFromGraph(link, note) {
  send('backoffice', { kateStudio: 'kans', link });
  await wait(900);
  send('backoffice', { kateStudio: 'kansTyp', tekst: note });
  await wait(note.length * 25 + 900);
  send('backoffice', { kateStudio: 'kansVerstuur' });
  await until(() => kansVan(link), 8000);
  await wait(1500);
  send('backoffice', { kateStudio: 'kansSluit' });
}
/** The customer says yes in the app; whatever the app didn't answer, the same call as the customer. */
async function sayYes(times = 1) {
  for (let i = 0; i < times; i++) {
    send('app', { kateStudio: 'kans', answer: 'interesse' });
    await wait(2600);
  }
  await refresh();
  for (const k of S.kansen.filter((x) => x.status === 'nieuw' || x.status === 'gezien')) {
    await api(F.user, 'PUT', `/klanten/${F.klant}/kansen/${k.id}`, { status: 'interesse' });
  }
}

const STEPS = [
  {
    title: 'Welcome to KBC Momentum',
    mode: 'overview',
    focus: TOM,
    spot: ['app', 'backoffice', 'chat'],
    body: () => `
      <p>Three screens, one backend: the <b>KBC Mobile app</b>, the adviser's <b>back office</b>, and the <b>chat</b>, a customer's own AI.
      This tour follows the finals pitch: two customers, and one AI agent that picks the channel.</p>
      <p>Everything is real: real API calls, real scores, and every screen picks up the change by itself.</p>
      <ul class="check">
        ${check(S.online, 'Backend reachable', S.online ? `demo week ${S.week}` : '')}
        ${check(S.users.app, 'App', S.users.app ? `as <code>${escT(S.users.app)}</code>` : 'waiting…')}
        ${check(S.users.backoffice, 'Back office', S.users.backoffice ? `as <code>${escT(S.users.backoffice)}</code>` : 'waiting…')}
        ${check(S.users.chat === 'jonas', 'Own AI', S.users.chat ? `as <code>${escT(S.users.chat)}</code>` : 'waiting…')}
      </ul>`,
    actions: () => [
      {
        label: 'Set up the demo',
        busy: 'Resetting and logging in…',
        run: async () => {
          S.wantLogin = true;
          S.appUser = 'tom';
          for (const p of PARTS) S.users[p] = undefined;
          send('backoffice', { kateStudio: 'graaf', vol: false });
          await resetDemo();
          useChat('chatgpt');
          await refresh();
          await until(() => S.users.app && S.users.backoffice && S.users.chat === 'jonas', 20000);
        },
      },
    ],
    done: () => S.online && S.users.app && S.users.backoffice && S.users.chat === 'jonas' && S.week === 0,
  },
  {
    title: 'Tom & Lien: signals, with consent',
    mode: 'backoffice',
    focus: TOM,
    bo: { page: 'klanten', klantId: TOM.klant },
    spot: ['backoffice'],
    highlight: 'score',
    body: () => `
      <p>Tom and Lien haven't told anyone yet. But from the sources <b>they allowed</b> (their account, their use of KBC Mobile,
      their own AI) their bank sees a baby store, a childcare registration, a question to their own AI.</p>
      <p>Health data never counts. The backend computes the score and phase, deterministically.
      ${S.week ? `Now: week <b>${S.week}</b>, score <b>${pct(S.m?.score)}</b>, phase <b>${faseOf()}</b>.` : ''}</p>`,
    notes: () => ({ backoffice: `Week ${S.week} · ${pct(S.m?.score)}` }),
    actions: () => [{ label: '▶ Play until Kate may ask', busy: 'The demo clock runs…', hidden: faseAt('vragen'), run: () => playUntil(() => faseAt('vragen')) }],
    done: () => faseAt('vragen'),
  },
  {
    title: 'The agent decides: fully automatic',
    mode: 'backoffice',
    focus: TOM,
    bo: { page: 'klanten', klantId: TOM.klant },
    spot: ['backoffice'],
    highlight: 'score',
    body: () => `
      <p>Now KBC's <b>agent</b> decides who approaches them: Kate in the app, or an adviser. It weighs the expected engagement per
      channel from facts KBC already has, and shows its reasons in the <b>KBC Agent</b> card.</p>
      <p>${S.agent ? `Its call: <b>${S.agent.kanaal === 'automatisch' ? 'automatic, Kate in the app' : 'an adviser'}</b> (${agentLine()}).` : 'Waiting for the agent…'}
      Retail, standard products, very digital: no adviser needed. No language model decides this.</p>`,
    notes: () => ({ backoffice: S.agent ? `Agent: ${S.agent.kanaal}` : '' }),
    done: () => S.agent?.kanaal === 'automatisch',
  },
  {
    title: 'Kate asks first',
    mode: 'app',
    focus: TOM,
    spot: ['app'],
    body: () =>
      S.m?.bevestigd
        ? '<p>Confirmed. The app, the back office and the agent all saw it within a second.</p>'
        : '<p>Kate asks in the app: "Ik vermoed een gezinsuitbreiding. Klopt dat?" Nothing happens without a yes.</p>',
    actions: () => [
      {
        label: 'Answer "Bevestigen"',
        hidden: S.m?.bevestigd,
        busy: 'Tom confirms…',
        run: async () => {
          send('app', { kateStudio: 'moment', answer: 'confirm' });
          if (!(await until(() => S.m?.bevestigd, 5000))) await direct('POST', `/klanten/${F.klant}/momenten/${F.moment}/bevestig`);
        },
      },
    ],
    done: () => Boolean(S.m?.bevestigd),
  },
  {
    title: 'Kate arranges it with one tap',
    mode: 'app',
    focus: TOM,
    spot: ['app'],
    body: () => `
      <p>Four things are already in order. Kate arranges the rest with one tap: the mortgage cover, the hospital insurance, the
      child benefit. And she doesn't push a new car: she checks whether the pram fits in the i4.</p>`,
    actions: () => [
      { label: 'Let Kate arrange everything', busy: 'Kate arranges…', run: async () => { send('app', { kateStudio: 'checklist', run: 'all' }); await wait(9000); } },
    ],
    done: () => true,
  },
  {
    title: "The agent's own offer",
    mode: 'app',
    focus: TOM,
    spot: ['app'],
    body: () => {
      const offer = S.kansen.find((k) => k.afzender === 'kate');
      return offer
        ? `<p>The agent went one step further on its own: <b>${escT(offer.link.naam)}</b>, straight into the app as a popup.
           ${offer.status === 'interesse' ? 'Tom said yes. No person touched it.' : 'Say yes in the popup.'}</p>`
        : '<p>Once the moment is confirmed and above 90% (phase <b>voorstel</b>), the agent sends an offer by itself. Play the clock on.</p>';
    },
    actions: () => [
      { label: '▶ Play to week 20', busy: 'The demo clock runs…', hidden: S.week >= 20, run: async () => { send('app', { kateStudio: 'checklist', open: false }); await playTo(20); } },
      { label: 'Say "Ja, graag!"', hidden: S.week < 20 || S.kansen.some((k) => k.afzender === 'kate' && k.status === 'interesse'), busy: 'Tom says yes…', run: () => sayYes(1) },
    ],
    done: () => S.kansen.some((k) => k.afzender === 'kate' && k.status === 'interesse'),
  },
  {
    title: 'Jonas: his own AI shares the moment',
    mode: 'chat',
    focus: JONAS,
    chat: 'chatgpt',
    spot: ['chat'],
    highlight: 'map',
    body: () =>
      sharedNow()
        ? `<p>Shared. ${S.seen.via === 'mcp' ? "Jonas's AI called <code>share_life_moment</code> through the <b>MCP server</b>" : 'Without an LLM, the tour made the same call as the MCP tool'}.
           Only the moment and a phase, never the conversation. Score now <b>${pct(S.m?.score)}</b>.</p>`
        : `<p>Jonas runs Stroomvaart: electric inland shipping on the Scheldt. He asks his own AI (not KBC's) how to finance a
           second ship, and explicitly lets it share the moment with KBC.</p>`,
    actions: () => [
      { label: '▶ Play to week 20', busy: 'The demo clock runs…', hidden: S.week >= 20, run: () => playTo(20) },
      {
        label: 'Let Jonas ask',
        hidden: sharedNow() || S.llm === false || S.week < 20,
        busy: S.chatBusy ? 'The AI uses the MCP tools…' : 'Jonas types…',
        run: () => askAi('I want to have a second electric push boat built for Stroomvaart. How do I best finance it? Share "business expansion" (planning) with KBC.'),
      },
      {
        label: 'Share without LLM',
        hidden: sharedNow() || S.llm !== false || S.week < 20,
        run: () => direct('POST', `/klanten/${F.klant}/momenten/delen`, { moment: F.moment, fase: 'plannend' }),
      },
    ],
    done: sharedNow,
  },
  {
    title: 'The agent calls in an adviser',
    mode: 'backoffice',
    focus: JONAS,
    bo: { page: 'klanten', klantId: JONAS.klant },
    spot: ['backoffice'],
    highlight: 'score',
    body: () => `
      <p>For Jonas the agent decides differently: a business customer, a big investment. He'll engage more with a person.
      ${S.agent ? `Its call: <b>${S.agent.kanaal === 'adviseur' ? 'adviser in the loop' : 'automatic'}</b> (${agentLine()}).` : ''}</p>
      <p>The adviser gets a task in the <b>KBC Agent</b> card, with the agent's suggestions: CO2 insight, and Billit + Kube.</p>`,
    done: () => S.agent?.kanaal === 'adviseur',
  },
  {
    title: 'The network: why CO2 insight',
    mode: 'backoffice',
    focus: JONAS,
    bo: { page: 'klanten', klantId: JONAS.klant },
    spot: ['backoffice'],
    body: () => `
      <p>The adviser opens Stroomvaart's network: ten ecosystems, his KBC loans, the partners he lets share data. The engine
      suggests new links and shows why: Encon, Kube and Sweco all point to <b>CO2 insight</b>.</p>
      ${kansVan(CO2) ? '<p><b>Sent</b> to Jonas\'s app, with a personal note.</p>' : ''}`,
    actions: () => [
      { label: 'Open the graph', kind: 'ghost', run: async () => { send('backoffice', { kateStudio: 'graaf', vol: true }); await wait(1500); send('backoffice', { kateStudio: 'knoop', id: CO2 }); } },
      { label: 'Send it to Jonas', hidden: Boolean(kansVan(CO2)), busy: 'The adviser writes a note…', run: () => sendFromGraph(CO2, 'Shippers increasingly ask for CO2 figures. Your electric fleet turns that into an edge right away.') },
    ],
    done: () => Boolean(kansVan(CO2)),
  },
  {
    title: 'Partners working together, for one customer',
    mode: 'backoffice',
    focus: JONAS,
    bo: { page: 'klanten', klantId: JONAS.klant },
    spot: ['backoffice'],
    body: () => `
      <p>Billit and Kube both work for Jonas, but not with each other. The violet line proposes they do: his shore-power
      invoices in Billit become CO2 figures in Kube.</p>
      <p>Data only flows between them after <b>Jonas's yes</b>, and he can switch it off any time.</p>`,
    actions: () => [
      { label: 'Select Billit', kind: 'ghost', run: async () => { send('backoffice', { kateStudio: 'graaf', vol: true }); await wait(1200); send('backoffice', { kateStudio: 'knoop', id: 'partner:billit' }); } },
      { label: 'Propose Billit + Kube', hidden: Boolean(kansVan(PAIR)), busy: 'The adviser writes a note…', run: () => sendFromGraph(PAIR, 'Let Billit turn your shore-power invoices into CO2 figures in Kube: no more copying numbers.') },
    ],
    done: () => Boolean(kansVan(PAIR)),
  },
  {
    title: 'Jonas says yes',
    mode: 'app',
    focus: JONAS,
    spot: ['app'],
    body: () => `
      <p>Both proposals pop up in Jonas's app. ${S.users.app === 'jonas' ? '' : 'First the app switches to Jonas.'}</p>
      <p>${S.kansen.filter((k) => k.status === 'interesse').length} of ${S.kansen.length} answered with a yes.</p>`,
    actions: () => [
      { label: "Open Jonas's app", kind: 'ghost', hidden: S.users.app === 'jonas', busy: 'Logging in as Jonas…', run: async () => { S.appUser = 'jonas'; send('app', { kateStudio: 'login', user: 'jonas' }); await until(() => S.users.app === 'jonas', 12000); } },
      { label: 'Say yes to both', hidden: S.kansen.length > 0 && S.kansen.every((k) => k.status === 'interesse'), busy: 'Jonas says yes…', run: () => sayYes(2) },
    ],
    done: () => S.kansen.length > 0 && S.kansen.every((k) => k.status === 'interesse'),
  },
  {
    title: 'The line turns solid',
    mode: 'backoffice',
    focus: JONAS,
    bo: { page: 'klanten', klantId: JONAS.klant },
    spot: ['backoffice'],
    body: () => '<p>In KBC\'s network the violet line between Billit and Kube is now solid: two partners work together, for one customer.</p>',
    actions: () => [{ label: 'Show it in the graph', kind: 'ghost', run: async () => { send('backoffice', { kateStudio: 'graaf', vol: true }); await wait(1200); send('backoffice', { kateStudio: 'knoop', id: 'partner:billit' }); } }],
    done: () => true,
  },
  {
    title: 'That is KBC Momentum',
    mode: 'overview',
    focus: JONAS,
    spot: [],
    body: () => `
      <ul class="recap">
        <li><b>From Next Best Offer to Next Best Moment.</b> The bank sees the moment, but asks first.</li>
        <li><b>One agent, millions of customers.</b> Automatic where it can, a person where it matters.</li>
        <li><b>A network, not a list.</b> Partners work together for a customer, with that customer's consent.</li>
        <li><b>Trust by design.</b> No language model decides, health data never counts, everything is logged.</li>
      </ul>`,
    actions: () => [
      { label: '↺ Again', run: async () => { goStep(0); await STEPS[0].actions()[0].run(); } },
      { label: 'Close', kind: 'ghost', run: () => closeTour() },
    ],
    done: () => true,
  },
];
const step3Done = () => faseAt('vragen');
const lastShared = () => [...(S.m?.signalenDetail ?? [])].reverse().find((s) => s.bron === 'EIGEN_AI');
const check = (ok, label, detail) => `<li class="${ok ? 'ok' : ''}"><span>${ok ? '✓' : '•'}</span>${label}${detail ? ` <em>${detail}</em>` : ''}</li>`;

// ---------- dock ----------
const dock = document.createElement('aside');
dock.className = 'tour';
dock.id = 'tour';
dock.setAttribute('aria-label', 'Guided tour');
dock.hidden = true;
dock.innerHTML = `
  <div class="t-card">
    <div class="t-head">
      <span class="t-step" id="tStep"></span>
      <div class="t-dots" id="tDots"></div>
      <button class="t-x" id="tClose" title="Close the tour" aria-label="Close the tour">✕</button>
    </div>
    <h3 id="tTitle"></h3>
    <div class="t-body" id="tBody"></div>
    <div class="t-actions" id="tActions"></div>
    <p class="t-hint" id="tHint"></p>
    <div class="t-nav">
      <button class="t-prev" id="tPrev">← Back</button>
      <button class="t-next" id="tNext">Next →</button>
    </div>
  </div>
  <div class="t-live">
    <section class="t-sec" data-sec="map">
      <h4><span class="live-dot"></span>Who talks to whom <em>live</em></h4>
      <svg class="t-map" viewBox="0 0 380 200" role="img" aria-label="Live verkeer tussen de onderdelen">
        <defs><marker id="tah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--wire)"/></marker></defs>
        <path class="w" data-w="app"  d="M118 23 C 190 23, 205 62, 248 66"/>
        <path class="w" data-w="bo"   d="M118 63 C 170 63, 200 76, 248 76"/>
        <path class="w" data-w="kate" d="M118 103 C 190 103, 205 90, 248 88"/>
        <path class="w" data-w="ai"   d="M118 143 H 146"/>
        <path class="w" data-w="mcp"  d="M202 143 C 232 143, 232 104, 248 100"/>
        <path class="w" data-w="src"  d="M311 152 V 120"/>
        <g class="n" data-n="app"><rect x="6" y="8" width="112" height="30" rx="8"/><text x="62" y="27">KBC Mobile</text></g>
        <g class="n" data-n="bo"><rect x="6" y="48" width="112" height="30" rx="8"/><text x="62" y="67">Back office</text></g>
        <g class="n" data-n="kate"><rect x="6" y="88" width="112" height="30" rx="8"/><text x="62" y="107">Kate</text></g>
        <g class="n" data-n="ai"><rect x="6" y="128" width="112" height="30" rx="8"/><text x="62" y="147">Own AI</text></g>
        <g class="n infra" data-n="mcp"><rect x="146" y="128" width="56" height="30" rx="8"/><text x="174" y="147">MCP</text></g>
        <g class="n core" data-n="api"><rect x="248" y="50" width="126" height="70" rx="10"/><text x="311" y="80">Backend API</text><text class="sub" x="311" y="97">score · agent · audit</text></g>
        <g class="n src" data-n="src"><rect x="248" y="152" width="126" height="42" rx="8"/><text x="311" y="170">Sources</text><text class="sub" x="311" y="185">with consent only</text></g>
        <g id="tPackets"></g>
      </svg>
    </section>
    <section class="t-sec" data-sec="score">
      <h4><span class="live-dot"></span><span id="tFocus"></span> <em id="tWeek"></em></h4>
      <div class="gauge"><div class="fill" id="tFill"></div><i style="left:40%"></i><i style="left:70%"></i><i style="left:90%"></i><b id="tScore">0%</b></div>
      <ol class="fases" id="tFases">${FASES.map((f) => `<li data-f="${f}">${f}</li>`).join('')}</ol>
      <p class="conf" id="tConf"></p>
      <p class="conf" id="tAgent"></p>
    </section>
    <section class="t-sec" data-sec="split">
      <h4>Adviser sees <span class="vs">vs</span> customer sees <button class="t-json" id="tJson">{ } JSON</button></h4>
      <div class="split">
        <ul id="tAdv"></ul>
        <ul id="tKlant"></ul>
      </div>
    </section>
    <section class="t-sec" data-sec="feed">
      <h4><span class="live-dot"></span>Events</h4>
      <ol class="feed" id="tFeed"><li class="empty">Nothing yet.</li></ol>
    </section>
  </div>`;
document.body.append(dock);

const modal = document.createElement('div');
modal.className = 't-modal';
modal.hidden = true;
modal.innerHTML = `<div class="t-mbox" role="dialog" aria-label="Ruwe antwoorden van de backend">
  <header><b id="tMHead"></b><button id="tMClose" aria-label="Close">✕</button></header>
  <div class="cols"><div><h5>as <code>adviseur</code></h5><pre id="tMAdv"></pre></div><div><h5 id="tMWho"></h5><pre id="tMKlant"></pre></div></div></div>`;
document.body.append(modal);
function showJson() {
  $t('#tMHead').textContent = `GET /v1/klanten/${F.klant}/momenten`;
  $t('#tMWho').innerHTML = `as <code>${F.user}</code> (customer)`;
  $t('#tMAdv').textContent = JSON.stringify(S.m, null, 2) ?? 'null';
  $t('#tMKlant').textContent = JSON.stringify(S.k, null, 2) ?? 'null';
  modal.hidden = false;
}
addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) { modal.hidden = true; e.stopPropagation(); } }, true);
modal.addEventListener('click', (e) => { if (e.target === modal || e.target.id === 'tMClose') modal.hidden = true; });
$t('#tJson').onclick = showJson;

// Notes pinned on the panels ("look here")
for (const id of PARTS) {
  const n = document.createElement('div');
  n.className = 'tour-note';
  panels[id].append(n);
  const chip = document.createElement('span');
  chip.className = 'sync-chip';
  panels[id].querySelector('.ph h2').after(chip);
}

$t('#tDots').innerHTML = STEPS.map((s, i) => `<button data-i="${i}" title="${escT(s.title)}"></button>`).join('');
$t('#tDots').onclick = (e) => e.target.dataset.i && goStep(Number(e.target.dataset.i));
$t('#tClose').onclick = () => closeTour();
$t('#tPrev').onclick = () => goStep(S.i - 1);
$t('#tNext').onclick = () => (S.i < STEPS.length - 1 ? goStep(S.i + 1) : closeTour());

// Rendered on every change; only touches the DOM where the output differs
const put = (el, html) => { if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; } };
function render() {
  if (!S.open) return;
  const st = STEPS[S.i];
  $t('#tStep').textContent = `Step ${S.i + 1} / ${STEPS.length}`;
  $t('#tTitle').textContent = st.title;
  put($t('#tBody'), st.body());
  const done = st.done?.() ?? true;
  [...$t('#tDots').children].forEach((d, i) => { d.classList.toggle('on', i === S.i); d.classList.toggle('past', i < S.i); });

  const acts = (st.actions?.() ?? []).filter((a) => !a.hidden);
  put($t('#tActions'), acts.map((a, n) => `<button class="${a.kind === 'ghost' ? 'ghost' : 'primary'}" data-a="${n}" ${S.running || a.disabled ? 'disabled' : ''} title="${escT(a.title ?? '')}">${escT(a.label)}</button>`).join(''));
  $t('#tActions').onclick = (e) => { const b = e.target.closest('button[data-a]'); if (b) runAction(acts[Number(b.dataset.a)]); };
  const hint = S.err ? `<span class="err">${escT(S.err)}</span>` : S.running ? `<span class="spin"></span>${escT(S.running)}` : st.hint?.() ?? '';
  put($t('#tHint'), hint);

  $t('#tPrev').disabled = S.i === 0;
  const next = $t('#tNext');
  next.textContent = S.i === STEPS.length - 1 ? 'Close' : 'Next →';
  next.classList.toggle('ready', done && !S.running);

  // Notes and spotlight on the panels
  const notes = st.notes?.() ?? {};
  for (const id of PARTS) {
    const p = panels[id];
    p.classList.toggle('tour-spot', st.spot.includes(id));
    p.classList.toggle('tour-dim', st.spot.length > 0 && !st.spot.includes(id));
    const n = p.querySelector('.tour-note');
    n.textContent = notes[id] ?? '';
    n.hidden = !notes[id];
  }
  for (const sec of dock.querySelectorAll('.t-sec')) sec.classList.toggle('hl', sec.dataset.sec === st.highlight);
  renderLive();
}

async function runAction(a) {
  if (!a || S.running) return;
  S.running = a.busy || 'Working…';
  S.err = null;
  render();
  try {
    await a.run();
  } catch (e) {
    console.error('[tour]', e);
    S.err = e.status === 429 ? 'Too many logins in a row: wait a minute and try again.' : `Failed: ${e.message}`;
  } finally {
    S.running = null;
    await refresh().catch(() => {});
    render();
  }
}

function goStep(i) {
  S.i = Math.max(0, Math.min(STEPS.length - 1, i));
  S.stepAt = Date.now();
  S.err = null;
  const st = STEPS[S.i];
  if (st.focus && st.focus !== F) { F = st.focus; S.m = null; S.k = null; S.agent = null; S.kansen = []; lastSig = null; }
  go(st.mode);
  if (st.chat) useChat(st.chat);
  if (st.bo) send('backoffice', { kateStudio: 'page', ...st.bo });
  if (st.highlight) dock.querySelector(`[data-sec="${st.highlight}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  try { sessionStorage.setItem('poc.tour', String(S.i)); } catch {}
  render();
}

let timer = 0;
function openTour(i = 0) {
  S.open = true;
  document.body.dataset.tour = '';
  dock.hidden = false;
  try { localStorage.setItem('poc.tourSeen', '1'); } catch {}
  document.getElementById('tourStart').classList.remove('nudge');
  document.getElementById('tourStart').innerHTML = '<span aria-hidden="true">■</span> Stop tour';
  for (const p of PARTS) send(p, { kateStudio: 'hello' });
  refresh().catch(() => {});
  clearInterval(timer);
  timer = setInterval(() => refresh().catch(() => {}), POLL_MS);
  goStep(i);
  PARTS.forEach(fit);
}
function closeTour() {
  S.open = false;
  S.wantLogin = false;
  clearInterval(timer);
  delete document.body.dataset.tour;
  dock.hidden = true;
  modal.hidden = true;
  try { sessionStorage.removeItem('poc.tour'); } catch {}
  for (const id of PARTS) {
    panels[id].classList.remove('tour-spot', 'tour-dim');
    panels[id].querySelector('.tour-note').hidden = true;
  }
  document.getElementById('tourStart').innerHTML = '<span aria-hidden="true">▶</span> Tour';
  go('overview');
  PARTS.forEach(fit);
}
document.getElementById('tourStart').onclick = () => (S.open ? closeTour() : openTour());
try { if (!localStorage.getItem('poc.tourSeen')) document.getElementById('tourStart').classList.add('nudge'); } catch {}

// ---------- live data ----------
let lastSig = null;
let auditSeen = null; // key of the newest audit entry we already handled
let refreshing = null;
function refresh() {
  refreshing ??= doRefresh().finally(() => { refreshing = null; });
  return refreshing;
}
async function doRefresh() {
  try {
    const [a, audit, beslissingen, kansen] = await Promise.all([
      api('adviseur', 'GET', `/klanten/${F.klant}/momenten`),
      api('adviseur', 'GET', '/audit'),
      api('adviseur', 'GET', `/klanten/${F.klant}/agent`),
      api('adviseur', 'GET', `/klanten/${F.klant}/kansen`),
    ]);
    S.agent = beslissingen.find((b) => b.moment === F.moment) ?? null;
    S.kansen = kansen;
    S.online = true;
    const prev = { week: S.week, m: S.m };
    S.week = a.week;
    S.m = a.momenten.find((x) => x.moment === F.moment) ?? null;
    const sharedBefore = S.seen.gedeeld;
    handleAudit(audit);
    const sig = JSON.stringify([S.week, S.m?.score, S.m?.fase, S.m?.bevestigd, S.m?.signalen, S.m?.acties?.length]);
    if (sig !== lastSig) {
      // Only ask for the customer's view when something changed: keeps the poll light
      const k = await api(F.user, 'GET', `/klanten/${F.klant}/momenten`);
      S.k = k.momenten.find((x) => x.moment === F.moment) ?? null;
      if (lastSig !== null) diffState(prev, S.seen.gedeeld !== sharedBefore);
      lastSig = sig;
    }
  } catch (e) {
    S.online = false;
    if (e.status === 429) S.err = 'Too many logins in a row: wait a minute.';
  }
  render();
}

function diffState(prev, justShared) {
  const was = prev.m;
  const now = S.m;
  const changes = [];
  if (prev.week !== S.week) {
    feed(S.week < prev.week ? '↺' : '🕒', S.week < prev.week ? `Demo clock back to week ${S.week}` : `Demo clock → week ${S.week}`, 'adviseur');
    pulse(['bo'], 'write');
  }
  const before = new Set(was?.signalen ?? []);
  for (const s of now?.signalenDetail ?? []) {
    if (before.has(s.id)) continue;
    if (s.bron === 'EIGEN_AI' && justShared) continue; // the share itself is already in the feed
    if (s.bron !== 'EIGEN_AI') pulse(['src'], 'write');
    feed('📥', `Signal from <b>${BRON[s.bron] ?? s.bron}</b> (with consent): ${escT(s.label)}${s.gevoelig ? ' <span class="lock">🔒 sensitive, not for the customer</span>' : ''}`, s.bron.toLowerCase());
  }
  const gone = (was?.signalen ?? []).filter((id) => !(now?.signalen ?? []).includes(id)).length;
  if (gone) feed('🗑', `${gone} signals deleted`, 'backend');
  if ((was?.score ?? 0) !== (now?.score ?? 0)) changes.push(pct(now?.score));
  if (was?.fase !== now?.fase) {
    feed(
      now ? '⬆' : '∅',
      !was ? `${escT(F.name)}: moment appears, phase <b>${now.fase}</b>` : !now ? 'Moment gone: no signals left' : `Phase <b>${was.fase}</b> → <b>${now.fase}</b>`,
      'backend',
      true,
    );
    changes.push(now?.fase ?? 'no moment');
  }
  if (!was?.bevestigd && now?.bevestigd) changes.push('confirmed');
  if (!changes.length && !gone && prev.week === S.week) return;
  // The app, the backoffice and Kate poll the backend: show the change arriving at each of them.
  // The customer's own AI doesn't poll (it only calls KBC when asked), so it gets nothing.
  setTimeout(() => {
    const label = changes.join(' · ') || `week ${S.week}`;
    const live = [['app', 'app'], ['bo', 'backoffice'], ...(chatApp === 'kate' ? [['kate', 'chat']] : [])];
    for (const [node, part] of live) {
      if (!S.users[part]) continue;
      pulse([node], 'sync', true);
      flash(part, label);
    }
  }, 350);
}

const PATH_OF = { adviseur: ['bo'], tom: ['app'], lien: ['app'], jonas: ['app'], ingest: ['src'], 'kate-agent': [] };
const CUSTOMERS = ['tom', 'lien', 'jonas'];
const NAME = { tom: 'Tom', lien: 'Lien', jonas: 'Jonas' };
/** "product:save-for-someone-else" → "save for someone else"; a partner pair → "Billit + Kube" */
const linkName = (id = '') => (id.startsWith('koppeling:') ? id.slice(10).split('~').map((x) => x[0].toUpperCase() + x.slice(1)).join(' + ') : id.replace(/^\w+:/, '').replace(/-/g, ' '));
const lastRead = {};
function handleAudit(list) {
  const key = (e) => `${e.ts}|${e.actor}|${e.actie}|${e.detail ?? ''}`;
  if (!list.length) { auditSeen = ''; return; }
  if (auditSeen === null) { auditSeen = key(list[0]); return; } // first poll: only new events from here on
  const fresh = [];
  for (const e of list) { if (key(e) === auditSeen) break; fresh.push(e); }
  auditSeen = key(list[0]);
  for (const e of fresh.reverse()) onAudit(e);
}

function onAudit(e) {
  const ts = Date.parse(e.ts);
  // The tour's own no-LLM calls go straight to the API as the customer: don't draw them as coming from the app
  const byTour = CUSTOMERS.includes(e.actor) && Math.abs(ts - S.direct) < 5000;
  // The chat pane's customer talks through their own AI (MCP), or through Kate
  const fromChat = e.actor === S.users.chat && e.actie === 'moment_gedeeld';
  const viaChat = fromChat ? (chatApp === 'kate' ? ['kate'] : ['ai', 'mcp']) : null;
  const path = byTour ? [] : viaChat ?? PATH_OF[e.actor] ?? ['bo'];
  const who = byTour ? 'The tour (no LLM)' : fromChat ? `${NAME[e.actor] ?? e.actor}'s own AI via MCP` : NAME[e.actor] ?? e.actor;
  const moment = (e.detail ?? '').split('/');
  switch (e.actie) {
    case 'moment_gedeeld': {
      S.seen.gedeeld = ts;
      S.seen.via = fromChat && !byTour ? 'mcp' : 'direct';
      const what = `<b>${escT(moment[0]?.toLowerCase())}</b> (${escT(moment[1])})`;
      if (fromChat && !byTour) { pulse(['ai', 'mcp'], 'write'); feed('🔗', `<b>${escT(who)}</b> shared ${what}, only the moment, never the conversation`, e.actor, true); }
      else { pulse(path, 'write'); feed('🔗', `<b>${escT(who)}</b> shared ${what}: the same call as the MCP tool`, e.actor, true); }
      break;
    }
    case 'moment_bevestigd':
      pulse(path, 'write');
      feed('✓', `<b>${escT(who)}</b> confirmed: "Ja, klopt"`, e.actor, true);
      break;
    case 'moment_ingetrokken':
      S.seen.ingetrokken = ts;
      S.seen.via = e.actor === S.users.chat && chatApp !== 'kate' ? 'mcp' : 'direct';
      pulse(path, 'write');
      feed('✋', `<b>${escT(who)}</b> revoked the moment: every signal deleted`, e.actor, true);
      break;
    case 'demo_reset':
      pulse(['bo'], 'write');
      feed('↺', 'Demo reset: clock, signals and audit back to the start', 'adviseur');
      break;
    case 'login':
      // No feed line: the showcase and the tour log in too, which says nothing about the demo
      pulse(path, 'read');
      break;
    case 'update_toestemming':
      pulse(path, 'write');
      feed('🛡', `<b>${escT(who)}</b> changed their consent`, e.actor, true);
      break;
    case 'signaal_ontvangen':
    case 'signaal_geweigerd':
      pulse(['src'], 'write');
      if (e.actie === 'signaal_geweigerd') feed('⛔', `Signal from ${escT(e.detail)} refused: no consent`, 'backend', true);
      break;
    case 'agent_beslissing': {
      const [m, kanaal] = moment;
      feed('🤖', `<b>KBC agent</b>: ${escT((m ?? '').toLowerCase().replace('_', ' '))} → ${kanaal === 'automatisch' ? '<b>automatic</b>, Kate in the app' : '<b>an adviser</b> in the loop'}`, 'agent', true);
      break;
    }
    case 'kans_verstuurd':
      pulse(path, 'write');
      feed(e.actor === 'kate-agent' ? '🎁' : '📨', e.actor === 'kate-agent'
        ? `<b>Kate</b> sent an offer on her own: ${escT(linkName(e.detail))}`
        : `<b>The adviser</b> sent ${e.detail?.startsWith('koppeling:') ? 'a partner pair' : 'an offer'}: ${escT(linkName(e.detail))}`, e.actor, true);
      break;
    case 'kans_interesse':
      pulse(path, 'write');
      feed('💚', `<b>${escT(who)}</b> said yes to ${escT(linkName(e.detail))}${e.detail?.startsWith('koppeling:') ? ': the partners now work together' : ''}`, e.actor, true);
      break;
    case 'kans_afgewezen':
      feed('✋', `<b>${escT(who)}</b> said no to ${escT(linkName(e.detail))}`, e.actor);
      break;
    default: {
      // Reads of personal data: a faint pulse, not a feed line (the backoffice reads every 1.5 s)
      const k = path.join();
      if (Date.now() - (lastRead[k] ?? 0) > 900) { lastRead[k] = Date.now(); pulse(path, 'read'); }
    }
  }
}

// ---------- the map: packets along the wires ----------
const svgNS = 'http://www.w3.org/2000/svg';
const packets = $t('#tPackets');
const NODE_OF = { app: 'app', bo: 'bo', kate: 'kate', ai: 'ai', mcp: 'mcp', src: 'src' };
/** A packet from a client (through MCP when chained) to the API, or back with `reverse` (the change reaching a part) */
function pulse(chain, kind = 'write', reverse = false) {
  if (!S.open) return;
  const wires = chain.map((w) => dock.querySelector(`.w[data-w="${w}"]`)).filter(Boolean);
  const glow = (n) => { const g = dock.querySelector(`.n[data-n="${n}"]`); if (!g) return; g.classList.remove('hit'); void g.getBBox(); g.classList.add('hit'); setTimeout(() => g.classList.remove('hit'), 600); };
  if (!wires.length) return glow('api');
  if (reverse) wires.reverse();
  const dot = document.createElementNS(svgNS, 'circle');
  dot.setAttribute('r', kind === 'read' ? 2.5 : 4.5);
  dot.setAttribute('class', `pk ${kind}`);
  packets.append(dot);
  if (!reverse) glow(NODE_OF[chain[0]]);
  const dur = kind === 'read' ? 520 : 750;
  let wi = 0;
  let t0 = performance.now();
  const step = (now) => {
    const w = wires[wi];
    const len = w.getTotalLength();
    const f = Math.min(1, (now - t0) / dur);
    const p = w.getPointAtLength((reverse ? 1 - f : f) * len);
    dot.setAttribute('cx', p.x);
    dot.setAttribute('cy', p.y);
    if (f < 1) return requestAnimationFrame(step);
    if (++wi < wires.length) { t0 = now; return requestAnimationFrame(step); }
    dot.remove();
    if (reverse) glow(NODE_OF[chain[0]]);
    else glow('api');
  };
  requestAnimationFrame(step);
}

function flash(id, label) {
  const p = panels[id];
  p.classList.remove('synced');
  void p.offsetWidth;
  p.classList.add('synced');
  const chip = p.querySelector('.sync-chip');
  chip.textContent = `⟳ ${label}`;
  chip.classList.remove('show');
  void chip.offsetWidth;
  chip.classList.add('show');
}

// ---------- feed + live panels ----------
function feed(icon, html, who, strong = false) {
  if (!S.open) return;
  const list = $t('#tFeed');
  list.querySelector('.empty')?.remove();
  const li = document.createElement('li');
  li.className = strong ? 'strong' : '';
  li.dataset.who = who;
  const time = new Date().toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  li.innerHTML = `<span class="ic">${icon}</span><span class="tx">${html}</span><time>${time}</time>`;
  list.prepend(li);
  while (list.children.length > 30) list.lastElementChild.remove();
}

let shownScore = 0;
let scoreAnim = 0;
function renderLive() {
  const score = Math.round((S.m?.score ?? 0) * 100);
  $t('#tWeek').textContent = S.online ? `week ${S.week}` : 'offline';
  $t('#tFocus').textContent = `${F.label} · ${F.name}`;
  put($t('#tAgent'), S.agent ? `🤖 Agent: <b>${S.agent.kanaal === 'automatisch' ? 'automatic, Kate in the app' : 'adviser in the loop'}</b> · app ${pct(S.agent.engagement.app)} · adviser ${pct(S.agent.engagement.adviseur)}` : '🤖 Agent: nothing to decide yet');
  const fill = $t('#tFill');
  fill.style.width = `${score}%`;
  fill.dataset.f = faseOf();
  if (score !== shownScore && !scoreAnim) {
    const from = shownScore;
    const t0 = performance.now();
    const tick = (now) => {
      const f = Math.min(1, (now - t0) / 700);
      $t('#tScore').textContent = `${Math.round(from + (score - from) * (1 - (1 - f) ** 3))}%`;
      if (f < 1) scoreAnim = requestAnimationFrame(tick);
      else { scoreAnim = 0; shownScore = score; if (Math.round((S.m?.score ?? 0) * 100) !== score) renderLive(); }
    };
    scoreAnim = requestAnimationFrame(tick);
  }
  for (const li of $t('#tFases').children) {
    li.classList.toggle('on', li.dataset.f === faseOf() && Boolean(S.m));
    li.classList.toggle('past', Boolean(S.m) && FASES.indexOf(li.dataset.f) < FASES.indexOf(faseOf()));
  }
  put($t('#tConf'), S.m ? `${S.m.bevestigd ? '<b class="yes">✓ confirmed by the customer</b>' : 'not confirmed by the customer yet'} · ${S.m.signalen.length} signals, all with consent` : 'No signals: there is no moment.');

  const adv = (S.m?.signalenDetail ?? []).map((s) => `<li class="${s.gevoelig ? 'gev' : ''}"><span class="bron" data-b="${s.bron}">${BRON[s.bron] ?? s.bron}</span>${escT(s.label)}${s.gevoelig ? ' <em>🔒 adviser only</em>' : ''}<small>w${s.week} · +${s.gewicht}</small></li>`);
  put($t('#tAdv'), `<li class="hd">Back office <code>adviseur</code></li>${adv.join('') || '<li class="none">No signals</li>'}`);
  const k = S.k;
  const kl = k
    ? [
        ...k.waarom.map((w) => `<li>${escT(w)}</li>`),
        k.andereSignalen ? `<li class="hidden-n">+ ${k.andereSignalen} other signals you consented to</li>` : '',
        `<li class="acts ${k.acties.length ? 'yes' : ''}">${k.acties.length ? `🎁 ${k.acties.length} actions (phase voorstel)` : 'Actions: hidden until voorstel'}</li>`,
      ]
    : ['<li class="none">Geen moment</li>'];
  put($t('#tKlant'), `<li class="hd">App <code>${F.user}</code></li>${kl.join('')}`);
}

// ---------- bridge to the panes ----------
const originOf = (p) => { try { return new URL(url(p)).origin; } catch { return ''; } };
function send(part, msg) {
  const w = panels[part]?.querySelector('iframe')?.contentWindow;
  if (w) w.postMessage(msg, originOf(part));
}
addEventListener('message', (e) => {
  const part = PARTS.find((p) => panels[p].querySelector('iframe').contentWindow === e.source);
  if (!part || e.origin !== originOf(part) || typeof e.data?.kateStudio !== 'string') return;
  const m = e.data;
  if (m.kateStudio === 'ready') {
    S.users[part] = m.user ?? null;
    if (part === 'chat') S.chatApp = m.app;
    // Each pane as its demo user: the app as Tom (Jonas in his last steps), the chat as Jonas's own AI
    const want = part === 'app' ? S.appUser : part === 'chat' ? 'jonas' : null;
    const ok = part === 'app' ? (S.appUser === 'tom' ? m.user === 'tom' || m.user === 'lien' : m.user === want) : want ? m.user === want : Boolean(m.user);
    if (S.wantLogin && !ok) send(part, { kateStudio: 'login', ...(want ? { user: want } : {}) });
    if (part === 'backoffice' && m.user && S.open && STEPS[S.i].bo) send('backoffice', { kateStudio: 'page', ...STEPS[S.i].bo });
  } else if (m.kateStudio === 'busy') {
    S.chatBusy = m.busy;
  } else if (m.kateStudio === 'llm') {
    S.llm = m.llm;
  } else if (m.kateStudio === 'error') {
    console.warn(`[tour] ${part}:`, m.error);
  } else if (m.kateStudio === 'event' && part === 'chat') {
    const ev = m.event ?? {};
    if (ev.type === 'kate-vraag' && !S.kate.vraag) { S.kate.vraag = true; feed('💬', '<b>Kate</b> vraagt uit zichzelf: "Klopt dit?"', 'kate', true); flash('chat', 'Kate vraagt'); }
    if (ev.type === 'kate-plan' && !S.kate.plan) { S.kate.plan = true; feed('🎁', '<b>Kate</b> stelt het plan voor', 'kate', true); flash('chat', 'Kate stelt voor'); }
    if (ev.type === 'tool' && !ev.isError && ev.name === 'get_moment_plan') { pulse(['ai', 'mcp'], 'read'); feed('🔗', `<b>${escT(NAME[S.users.chat] ?? 'The')}'s own AI</b> read the plan through MCP`, S.users.chat ?? 'ai'); }
  }
  render();
});
// Kate's question can be gone after a reset: forget it when the moment drops back
setInterval(() => { if (!S.m) S.kate = { vraag: false, plan: false }; else if (!faseAt('vragen')) S.kate.vraag = false; }, 2000);

// Resume after a reload of the showcase
try { const i = sessionStorage.getItem('poc.tour'); if (i !== null) openTour(Number(i)); } catch {}
})();
