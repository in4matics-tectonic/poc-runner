// Guided tour of the PoC. It walks through one life moment from first signal to proposal (and back), and every
// step does something real: it moves the demo clock, lets Lien's own AI share through MCP, answers Kate, ...
// Meanwhile the dock shows what the backend holds right now and every call as a packet on the architecture map,
// and each pane flashes when the change reaches it. The panes are cross-origin iframes: the tour never reads
// them, it talks to them through a small postMessage bridge (log in, switch page, type a message, press a button)
// and they tell it what happened. Uses app.js: go, setChatApp, chatApp, panels, fit, url, api, resetDemo.

(() => {
const KLANT = 'K-2024-0417';
const MOMENT_ID = 'GEZINSUITBREIDING';
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
  direct: 0, // when the tour itself made a call as the customer (no LLM): the audit shows it as tom
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
  return api('tom', method, path, body);
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

const STEPS = [
  {
    title: 'Welkom bij Kate Studio',
    mode: 'overview',
    spot: ['app', 'backoffice', 'chat'],
    body: () => `
      <p>Drie schermen, één backend. Links de <b>KBC Mobile-app</b> van Tom, in het midden de <b>backoffice</b> van de adviseur,
      rechts de <b>chat</b>: Lien's eigen AI (ChatGPT, Gemini, Claude) en Kate, de assistent van KBC.</p>
      <p>Ze praten nooit met elkaar, enkel met de backend. Alles in deze tour is echt: echte API-calls, echte scores, en elk scherm
      pikt de wijziging zelf op.</p>
      <ul class="check">
        ${check(S.online, 'Backend bereikbaar', S.online ? `demoweek ${S.week}` : '')}
        ${['app', 'backoffice', 'chat'].map((p) => check(S.users[p], `${NAMES[p][0].toUpperCase()}${NAMES[p].slice(1)}`, S.users[p] ? `aangemeld als <code>${escT(S.users[p])}</code>` : S.users[p] === null ? 'niet aangemeld' : 'wacht op het scherm…')).join('')}
      </ul>`,
    actions: () => [
      {
        label: 'Zet de demo klaar',
        busy: 'Alles terugzetten en aanmelden…',
        run: async () => {
          S.kate = { vraag: false, plan: false };
          S.wantLogin = true;
          for (const p of PARTS) S.users[p] = undefined;
          await resetDemo();
          useChat('chatgpt');
          await refresh();
          await until(() => PARTS.every((p) => S.users[p]), 15000);
        },
      },
    ],
    done: () => S.online && PARTS.every((p) => S.users[p]) && S.week === 0 && !S.m,
  },
  {
    title: 'Het begint bij Lien, in haar eigen AI',
    mode: 'overview',
    chat: 'chatgpt',
    spot: ['chat'],
    highlight: 'map',
    body: () =>
      sharedNow()
        ? `<p>Gedeeld. ${S.seen.via === 'mcp' ? "Lien's AI riep <code>share_life_moment</code> aan via de <b>MCP-server</b>" : 'Zonder LLM deed de tour dezelfde call als de MCP-tool'}; de backend maakte er één signaal van:
           <b>${escT(lastShared()?.label ?? 'moment gedeeld')}</b>.</p>
           <p>Score nu <b>${pct(S.m?.score)}</b>, fase <b>${faseOf()}</b>. Onder 40% doet niemand iets, niet de app, niet de adviseur, niet Kate.</p>`
        : `<p>Lien vertelt haar eigen AI dat ze een tweede kindje plannen. Die AI is <b>niet van KBC</b>: via de MCP-server van Kate Studio kan hij
           precies drie dingen: een moment delen, het plan lezen of het intrekken.</p>
           <p>Hij deelt enkel het <i>moment en de fase</i>, nooit het gesprek zelf. Let op de kaart rechts: chat → MCP → backend.</p>`,
    notes: () => ({ chat: !sharedNow() ? 'Lien typt hier' : S.seen.via === 'mcp' ? '✓ share_life_moment via MCP' : '✓ Gedeeld (zonder LLM)' }),
    actions: () => [
      {
        label: 'Laat Lien het vragen',
        busy: S.chatBusy ? 'Claude denkt na en gebruikt de MCP-tools…' : 'Lien typt…',
        hidden: sharedNow() || S.llm === false,
        run: () => askAi('We plannen een tweede kindje, hopelijk volgend voorjaar. Je mag met KBC delen dat we dat aan het plannen zijn.'),
      },
      {
        label: 'Zeg "ja, deel het"',
        kind: 'ghost',
        hidden: sharedNow() || S.llm === false,
        busy: 'Claude deelt via MCP…',
        run: () => askAi('Ja, deel het maar.'),
      },
      {
        label: 'Deel zonder LLM',
        title: 'Dezelfde API-call die de MCP-tool share_life_moment doet, rechtstreeks als klant',
        hidden: sharedNow() || S.llm !== false,
        run: () => direct('POST', `/klanten/${KLANT}/momenten/delen`, { moment: MOMENT_ID, fase: 'plannend' }),
      },
    ],
    hint: () => (sharedNow() ? '' : S.llm === false ? 'Er is geen ANTHROPIC_API_KEY voor de chat: de knop doet dezelfde call als de MCP-tool.' : 'Of typ zelf iets in de chat. Vraagt de AI eerst om akkoord? Klik op "ja, deel het".'),
    done: sharedNow,
  },
  {
    title: 'De tijd loopt: signalen komen binnen',
    mode: 'backoffice',
    bo: { page: 'klanten', klantId: KLANT },
    spot: ['backoffice'],
    highlight: 'score',
    body: () => `
      <p>De adviseur speelt de tijdlijn af. Elke week komen er signalen binnen uit bronnen waarvoor Tom en Lien toestemming gaven:
      Doccle, een geofence, rekeningverrichtingen.</p>
      <p>De <b>backend</b> berekent score en fase, deterministisch. Geen LLM beslist hier iets.
      ${S.week ? `Nu: week <b>${S.week}</b>, score <b>${pct(S.m?.score)}</b>, fase <b>${faseOf()}</b>.` : ''}</p>`,
    notes: () => ({ backoffice: `Demoweek ${S.week} · ${pct(S.m?.score)}` }),
    actions: () => [
      { label: '▶ Speel af tot fase "vragen"', busy: 'De demo-klok loopt…', hidden: step3Done(), run: () => playUntil(step3Done) },
      { label: 'Eén week verder', kind: 'ghost', hidden: step3Done(), run: () => api('adviseur', 'POST', '/demo/volgende') },
    ],
    done: () => step3Done(),
  },
  {
    title: 'Twee blikken op dezelfde data',
    mode: 'overview',
    spot: ['backoffice', 'app'],
    highlight: 'split',
    body: () => {
      const n = S.m?.signalenDetail?.length ?? 0;
      const g = S.k?.andereSignalen ?? 0;
      return `
      <p>Zelfde klant, zelfde seconde, twee antwoorden van de backend. De adviseur ziet <b>${n} signalen</b>, waarvan <b>${g} gevoelig</b> 🔒.
      Tom en Lien zien enkel de niet-gevoelige redenen, plus <i>"${g} andere signalen waarvoor je toestemming gaf"</i>.</p>
      <p>Het filter zit in de backend, niet in de app. Doccle wordt enkel op metadata geclassificeerd: de inhoud van een document gaat nergens heen.</p>`;
    },
    notes: () => ({
      backoffice: `Adviseur: ${S.m?.signalenDetail?.length ?? 0} signalen`,
      app: `Tom: ${S.k?.waarom?.length ?? 0} redenen + ${S.k?.andereSignalen ?? 0} verborgen`,
    }),
    actions: () => [{ label: '{ } Toon de ruwe JSON', kind: 'ghost', run: showJson }],
    done: () => true,
  },
  {
    title: 'Kate vraagt het zelf',
    mode: 'overview',
    chat: 'kate',
    spot: ['chat', 'app'],
    body: () =>
      S.m?.bevestigd
        ? `<p>Bevestigd. ${faseOf() === 'voorstel' ? 'De score zat al boven 90%: het voorstel staat meteen klaar.' : `De score zit op <b>${pct(S.m?.score)}</b>: nog geen voorstel, want daarvoor moet het ook boven 90%.`}
           Tom's app zag de bevestiging binnen de seconde, ook al gebeurde ze in Kate.</p>`
        : `<p>De score zit boven 70%: fase <b>vragen</b>. Kate merkt dat zelf op en vraagt of het klopt. Ze feliciteert nog niet en noemt geen signalen.</p>
           <p>Kate schrijft enkel de zin; wanneer ze iets vraagt, bepaalt de backend. Pas na <i>"Ja, klopt"</i> gaat er iets verder.</p>`,
    notes: () => ({ chat: S.m?.bevestigd ? '✓ Ja, klopt' : S.kate.vraag ? 'Kate vraagt: klopt dit?' : 'Kate meldt zich zo…' }),
    actions: () => [
      {
        label: 'Antwoord "Ja, klopt"',
        hidden: S.m?.bevestigd,
        disabled: !S.kate.vraag,
        busy: 'Lien bevestigt…',
        run: async () => {
          send('chat', { kateStudio: 'answer', answer: 'Ja, klopt' });
          await until(() => S.m?.bevestigd, 15000);
        },
      },
    ],
    hint: () => (S.m?.bevestigd ? '' : S.kate.vraag ? 'Of klik zelf op "Ja, klopt" in de chat of in de app.' : 'Wachten tot Kate zich meldt…'),
    done: () => Boolean(S.m?.bevestigd),
  },
  {
    title: 'Van moment naar voorstel',
    mode: 'overview',
    chat: 'kate',
    spot: ['app', 'chat'],
    highlight: 'score',
    body: () =>
      faseOf() === 'voorstel'
        ? `<p><b>Voorstel.</b> Score ${pct(S.m?.score)} én bevestigd: de backend geeft nu <b>${S.k?.acties?.length ?? 0} acties</b> vrij aan de klant.
           Producten die ze al hebben vallen weg. Kate stelt het plan voor met één actie vooraan; de app toont dezelfde acties.</p>`
        : `<p>Bevestigd, maar de score zit nog op ${pct(S.m?.score)}. Pas bij <b>90% én bevestiging</b> springt het moment naar <b>voorstel</b>.
           Tot dan krijgt de klant geen enkele actie te zien. Speel de tijdlijn verder.</p>`,
    notes: () => ({
      app: faseOf() === 'voorstel' ? `${S.k?.acties?.length ?? 0} acties ontgrendeld` : 'Nog geen acties',
      chat: S.kate.plan ? 'Kate stelt het plan voor' : '',
    }),
    actions: () => [{ label: '▶ Speel af tot voorstel', busy: 'De demo-klok loopt…', hidden: faseOf() === 'voorstel', run: () => playUntil(() => faseOf() === 'voorstel') }],
    done: () => faseOf() === 'voorstel',
  },
  {
    title: 'Alles is gelogd',
    mode: 'backoffice',
    bo: { page: 'audit' },
    spot: ['backoffice'],
    highlight: 'feed',
    body: () => `
      <p>Elke raadpleging van persoonsgegevens en elke wijziging komt in de <b>auditlog</b> van de backend: wie, wat, wanneer.
      De adviseur ziet ze hier; de klant kan elk moment intrekken.</p>
      <p>Rechts zie je dezelfde stroom live. Elke puls op de kaart is een echte call: de weg die hij nam, en wie hem deed.</p>`,
    done: () => true,
  },
  {
    title: 'De klant heeft het laatste woord',
    mode: 'overview',
    chat: 'chatgpt',
    spot: ['app', 'backoffice', 'chat'],
    highlight: 'score',
    body: () =>
      revokedNow() || (S.stepAt && !S.m)
        ? `<p><b>Weg.</b> De backend wiste alle signalen van dit moment, ook de gevoelige. Geen score, geen fase, geen acties, ook niet voor de adviseur.
           Kijk: elk scherm volgde vanzelf.</p>`
        : `<p>Lien bedenkt zich en vraagt haar eigen AI om het moment in te trekken. Via MCP <code>revoke_moment</code> wist de backend
           <b>alle signalen</b> van dit moment. Hou alle drie de schermen in het oog.</p>`,
    notes: () =>
      revokedNow()
        ? { app: 'Moment verdwenen', backoffice: 'Signalen gewist', chat: S.seen.via === 'mcp' ? '✓ revoke_moment via MCP' : '✓ Ingetrokken (zonder LLM)' }
        : { chat: 'Lien typt hier' },
    actions: () => [
      {
        label: 'Laat Lien het intrekken',
        hidden: revokedNow() || S.llm === false,
        busy: S.chatBusy ? 'Claude trekt in via MCP…' : 'Lien typt…',
        run: () => askAi('Trek het moment gezinsuitbreiding in bij KBC. Ik bevestig dat uitdrukkelijk.'),
      },
      { label: 'Zeg "ja, trek in"', kind: 'ghost', hidden: revokedNow() || S.llm === false, run: () => askAi('Ja, trek het maar in.') },
      {
        label: 'Trek in zonder LLM',
        title: 'Dezelfde API-call die de MCP-tool revoke_moment doet, rechtstreeks als klant',
        hidden: revokedNow() || S.llm !== false,
        run: () => direct('DELETE', `/klanten/${KLANT}/momenten/${MOMENT_ID}`),
      },
    ],
    done: () => revokedNow(),
  },
  {
    title: 'Dat is Kate Studio',
    mode: 'overview',
    spot: [],
    body: () => `
      <ul class="recap">
        <li><b>Van Next Best Offer naar Next Best Moment.</b> De bank ziet het moment, maar vraagt eerst.</li>
        <li><b>Eén bron van waarheid.</b> Score en fase komen uit de backend; LLM's schrijven enkel de zinnen.</li>
        <li><b>Privacy by design.</b> Gevoelige signalen nooit naar de klant, acties pas na bevestiging, alles gelogd.</li>
        <li><b>Open.</b> De eigen AI van de klant praat mee via MCP: delen, lezen, intrekken. Nooit betalen.</li>
      </ul>`,
    actions: () => [
      { label: '↺ Opnieuw', run: async () => { goStep(0); await STEPS[0].actions()[0].run(); } },
      { label: 'Sluiten', kind: 'ghost', run: () => closeTour() },
    ],
    done: () => true,
  },
];
// Stop once Kate may ask and there's a sensitive signal for the next step (usually week 10, below 90%)
const step3Done = () => faseAt('vragen') && Boolean(S.m?.signalenDetail?.some((s) => s.gevoelig));
const lastShared = () => [...(S.m?.signalenDetail ?? [])].reverse().find((s) => s.bron === 'EIGEN_AI');
const check = (ok, label, detail) => `<li class="${ok ? 'ok' : ''}"><span>${ok ? '✓' : '•'}</span>${label}${detail ? ` <em>${detail}</em>` : ''}</li>`;

// ---------- dock ----------
const dock = document.createElement('aside');
dock.className = 'tour';
dock.id = 'tour';
dock.setAttribute('aria-label', 'Rondleiding');
dock.hidden = true;
dock.innerHTML = `
  <div class="t-card">
    <div class="t-head">
      <span class="t-step" id="tStep"></span>
      <div class="t-dots" id="tDots"></div>
      <button class="t-x" id="tClose" title="Tour sluiten" aria-label="Tour sluiten">✕</button>
    </div>
    <h3 id="tTitle"></h3>
    <div class="t-body" id="tBody"></div>
    <div class="t-actions" id="tActions"></div>
    <p class="t-hint" id="tHint"></p>
    <div class="t-nav">
      <button class="t-prev" id="tPrev">← Vorige</button>
      <button class="t-next" id="tNext">Volgende →</button>
    </div>
  </div>
  <div class="t-live">
    <section class="t-sec" data-sec="map">
      <h4><span class="live-dot"></span>Wie praat met wie <em>live</em></h4>
      <svg class="t-map" viewBox="0 0 380 200" role="img" aria-label="Live verkeer tussen de onderdelen">
        <defs><marker id="tah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--wire)"/></marker></defs>
        <path class="w" data-w="app"  d="M118 23 C 190 23, 205 62, 248 66"/>
        <path class="w" data-w="bo"   d="M118 63 C 170 63, 200 76, 248 76"/>
        <path class="w" data-w="kate" d="M118 103 C 190 103, 205 90, 248 88"/>
        <path class="w" data-w="ai"   d="M118 143 H 146"/>
        <path class="w" data-w="mcp"  d="M202 143 C 232 143, 232 104, 248 100"/>
        <path class="w" data-w="src"  d="M311 152 V 120"/>
        <g class="n" data-n="app"><rect x="6" y="8" width="112" height="30" rx="8"/><text x="62" y="27">App · Tom</text></g>
        <g class="n" data-n="bo"><rect x="6" y="48" width="112" height="30" rx="8"/><text x="62" y="67">Backoffice</text></g>
        <g class="n" data-n="kate"><rect x="6" y="88" width="112" height="30" rx="8"/><text x="62" y="107">Kate</text></g>
        <g class="n" data-n="ai"><rect x="6" y="128" width="112" height="30" rx="8"/><text x="62" y="147">Eigen AI · Lien</text></g>
        <g class="n infra" data-n="mcp"><rect x="146" y="128" width="56" height="30" rx="8"/><text x="174" y="147">MCP</text></g>
        <g class="n core" data-n="api"><rect x="248" y="50" width="126" height="70" rx="10"/><text x="311" y="80">Backend API</text><text class="sub" x="311" y="97">score · fase · audit</text></g>
        <g class="n src" data-n="src"><rect x="248" y="152" width="126" height="42" rx="8"/><text x="311" y="170">Bronnen</text><text class="sub" x="311" y="185">Doccle · geofence · rekening</text></g>
        <g id="tPackets"></g>
      </svg>
    </section>
    <section class="t-sec" data-sec="score">
      <h4><span class="live-dot"></span>Gezinsuitbreiding · Tom &amp; Lien <em id="tWeek"></em></h4>
      <div class="gauge"><div class="fill" id="tFill"></div><i style="left:40%"></i><i style="left:70%"></i><i style="left:90%"></i><b id="tScore">0%</b></div>
      <ol class="fases" id="tFases">${FASES.map((f) => `<li data-f="${f}">${f}</li>`).join('')}</ol>
      <p class="conf" id="tConf"></p>
    </section>
    <section class="t-sec" data-sec="split">
      <h4>Adviseur ziet <span class="vs">vs</span> klant ziet <button class="t-json" id="tJson">{ } JSON</button></h4>
      <div class="split">
        <ul id="tAdv"></ul>
        <ul id="tKlant"></ul>
      </div>
    </section>
    <section class="t-sec" data-sec="feed">
      <h4><span class="live-dot"></span>Gebeurtenissen</h4>
      <ol class="feed" id="tFeed"><li class="empty">Nog niets gebeurd.</li></ol>
    </section>
  </div>`;
document.body.append(dock);

const modal = document.createElement('div');
modal.className = 't-modal';
modal.hidden = true;
modal.innerHTML = `<div class="t-mbox" role="dialog" aria-label="Ruwe antwoorden van de backend">
  <header><b>GET /v1/klanten/${KLANT}/momenten</b><button id="tMClose" aria-label="Sluiten">✕</button></header>
  <div class="cols"><div><h5>als <code>adviseur</code></h5><pre id="tMAdv"></pre></div><div><h5>als <code>tom</code> (klant)</h5><pre id="tMKlant"></pre></div></div></div>`;
document.body.append(modal);
function showJson() {
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
  $t('#tStep').textContent = `Stap ${S.i + 1} / ${STEPS.length}`;
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
  next.textContent = S.i === STEPS.length - 1 ? 'Sluiten' : 'Volgende →';
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
  S.running = a.busy || 'Bezig…';
  S.err = null;
  render();
  try {
    await a.run();
  } catch (e) {
    console.error('[tour]', e);
    S.err = e.status === 429 ? 'Te veel aanmeldingen na elkaar: wacht een minuut en probeer opnieuw.' : `Mislukt: ${e.message}`;
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
    const [a, audit] = await Promise.all([api('adviseur', 'GET', `/klanten/${KLANT}/momenten`), api('adviseur', 'GET', '/audit')]);
    S.online = true;
    const prev = { week: S.week, m: S.m };
    S.week = a.week;
    S.m = a.momenten.find((x) => x.moment === MOMENT_ID) ?? null;
    const sharedBefore = S.seen.gedeeld;
    handleAudit(audit);
    const sig = JSON.stringify([S.week, S.m?.score, S.m?.fase, S.m?.bevestigd, S.m?.signalen, S.m?.acties?.length]);
    if (sig !== lastSig) {
      // Only ask for the customer's view when something changed: keeps the poll light
      const k = await api('tom', 'GET', `/klanten/${KLANT}/momenten`);
      S.k = k.momenten.find((x) => x.moment === MOMENT_ID) ?? null;
      if (lastSig !== null) diffState(prev, S.seen.gedeeld !== sharedBefore);
      lastSig = sig;
    }
  } catch (e) {
    S.online = false;
    if (e.status === 429) S.err = 'Te veel aanmeldingen na elkaar: wacht een minuut.';
  }
  render();
}

function diffState(prev, justShared) {
  const was = prev.m;
  const now = S.m;
  const changes = [];
  if (prev.week !== S.week) {
    feed(S.week < prev.week ? '↺' : '🕒', S.week < prev.week ? `Demo-klok terug naar week ${S.week}` : `Demo-klok → week ${S.week}`, 'adviseur');
    pulse(['bo'], 'write');
  }
  const before = new Set(was?.signalen ?? []);
  for (const s of now?.signalenDetail ?? []) {
    if (before.has(s.id)) continue;
    if (s.bron === 'EIGEN_AI' && justShared) continue; // the share itself is already in the feed
    if (s.bron !== 'EIGEN_AI') pulse(['src'], 'write');
    feed('📥', `Signaal van <b>${BRON[s.bron] ?? s.bron}</b>: ${escT(s.label)}${s.gevoelig ? ' <span class="lock">🔒 gevoelig, niet voor de klant</span>' : ''}`, s.bron.toLowerCase());
  }
  const gone = (was?.signalen ?? []).filter((id) => !(now?.signalen ?? []).includes(id)).length;
  if (gone) feed('🗑', `${gone} signalen gewist`, 'backend');
  if ((was?.score ?? 0) !== (now?.score ?? 0)) changes.push(pct(now?.score));
  if (was?.fase !== now?.fase) {
    feed(
      now ? '⬆' : '∅',
      !was ? `Moment verschijnt, fase <b>${now.fase}</b>` : !now ? 'Moment verdwenen: geen signalen meer' : `Fase <b>${was.fase}</b> → <b>${now.fase}</b>`,
      'backend',
      true,
    );
    changes.push(now?.fase ?? 'geen moment');
  }
  if (!was?.bevestigd && now?.bevestigd) changes.push('bevestigd');
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

const PATH_OF = { adviseur: ['bo'], tom: ['app'], ingest: ['src'] };
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
  // The tour's own no-LLM calls go straight to the API as tom: don't draw them as coming from the app
  const byTour = e.actor === 'tom' && Math.abs(ts - S.direct) < 5000;
  const viaChat = e.actor === 'lien' ? (chatApp === 'kate' ? ['kate'] : ['ai', 'mcp']) : null;
  const path = byTour ? [] : viaChat ?? PATH_OF[e.actor] ?? ['bo'];
  const who = byTour ? 'De tour (zonder LLM)' : e.actor === 'lien' ? (chatApp === 'kate' ? 'Lien via Kate' : "Lien's eigen AI via MCP") : e.actor;
  const moment = (e.detail ?? '').split('/');
  switch (e.actie) {
    case 'moment_gedeeld': {
      S.seen.gedeeld = ts;
      S.seen.via = e.actor === 'lien' ? 'mcp' : 'direct';
      const what = `<b>${escT(moment[0]?.toLowerCase())}</b> (${escT(moment[1])})`;
      if (e.actor === 'lien') { pulse(['ai', 'mcp'], 'write'); feed('🔗', `<b>Lien's eigen AI</b> deelde ${what} via MCP`, 'lien', true); }
      else { pulse(path, 'write'); feed('🔗', `<b>${escT(who)}</b> deelde ${what}: dezelfde call als de MCP-tool`, e.actor, true); }
      break;
    }
    case 'moment_bevestigd':
      pulse(path, 'write');
      feed('✓', `<b>${escT(who)}</b>: "Ja, klopt"`, e.actor, true);
      break;
    case 'moment_ingetrokken':
      S.seen.ingetrokken = ts;
      S.seen.via = e.actor === 'lien' && chatApp !== 'kate' ? 'mcp' : 'direct';
      pulse(path, 'write');
      feed('✋', `<b>${escT(who)}</b> trok het moment in: alle signalen gewist`, e.actor, true);
      break;
    case 'demo_reset':
      pulse(['bo'], 'write');
      feed('↺', 'Demo gereset: klok, signalen en audit terug naar het begin', 'adviseur');
      break;
    case 'login':
      // No feed line: the showcase and the tour log in too, which says nothing about the demo
      pulse(path, 'read');
      break;
    case 'update_toestemming':
      pulse(path, 'write');
      feed('🛡', `<b>${escT(e.actor)}</b> paste toestemming aan`, e.actor, true);
      break;
    case 'signaal_ontvangen':
    case 'signaal_geweigerd':
      pulse(['src'], 'write');
      if (e.actie === 'signaal_geweigerd') feed('⛔', `Signaal van ${escT(e.detail)} geweigerd: geen toestemming`, 'backend', true);
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
  put($t('#tConf'), S.m ? `${S.m.bevestigd ? '<b class="yes">✓ bevestigd door de klant</b>' : 'nog niet bevestigd door de klant'} · ${S.m.signalen.length} signalen` : 'Geen signalen: er is geen moment.');

  const adv = (S.m?.signalenDetail ?? []).map((s) => `<li class="${s.gevoelig ? 'gev' : ''}"><span class="bron" data-b="${s.bron}">${BRON[s.bron] ?? s.bron}</span>${escT(s.label)}${s.gevoelig ? ' <em>🔒 enkel adviseur</em>' : ''}<small>w${s.week} · +${s.gewicht}</small></li>`);
  put($t('#tAdv'), `<li class="hd">Backoffice <code>adviseur</code></li>${adv.join('') || '<li class="none">Geen signalen</li>'}`);
  const k = S.k;
  const kl = k
    ? [
        ...k.waarom.map((w) => `<li>${escT(w)}</li>`),
        k.andereSignalen ? `<li class="hidden-n">+ ${k.andereSignalen} andere signalen waarvoor je toestemming gaf</li>` : '',
        `<li class="acts ${k.acties.length ? 'yes' : ''}">${k.acties.length ? `🎁 ${k.acties.length} acties (fase voorstel)` : 'Acties: verborgen tot voorstel'}</li>`,
      ]
    : ['<li class="none">Geen moment</li>'];
  put($t('#tKlant'), `<li class="hd">App &amp; Kate <code>klant</code></li>${kl.join('')}`);
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
    if (!m.user && S.wantLogin) send(part, { kateStudio: 'login' });
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
    if (ev.type === 'tool' && !ev.isError && ev.name === 'get_moment_plan') { pulse(['ai', 'mcp'], 'read'); feed('🔗', "<b>Lien's eigen AI</b> las het plan via MCP", 'lien'); }
  }
  render();
});
// Kate's question can be gone after a reset: forget it when the moment drops back
setInterval(() => { if (!S.m) S.kate = { vraag: false, plan: false }; else if (!faseAt('vragen')) S.kate.vraag = false; }, 2000);

// Resume after a reload of the showcase
try { const i = sessionStorage.getItem('poc.tour'); if (i !== null) openTour(Number(i)); } catch {}
})();
