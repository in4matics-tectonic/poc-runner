'use strict';

// Records the short clips for the finals presentation, one app per clip, from the local PoC stack (poc-runner on
// ports 7001-7004). Every scene sets up the backend through the API first, then records one app at a calm pace.
// Usage: node record.js [scene ...]   (then node encode.js)
const fs = require('node:fs');
const path = require('node:path');
const L = require('./lib');

const API = process.env.API_URL || 'http://127.0.0.1:7004/v1';
const APP = process.env.APP_URL || 'http://localhost:7001';
const BACKOFFICE = process.env.BACKOFFICE_URL || 'http://localhost:7002';
const CHAT = process.env.CHAT_URL || 'http://localhost:7003';
const PASSWORD = 'in4matics-must-win';
const TOM = 'K-2024-0417';
const JONAS = 'K-2022-0311';
const OUT = path.join(L.WORK, 'raw');

const PHONE = { viewport: { width: 400, height: 820 }, scale: 3, mobile: true, cursor: 'touch' };
const DESK = { viewport: { width: 1280, height: 800 }, scale: 2, cursor: 'arrow' };
const CHATBOX = { viewport: { width: 900, height: 700 }, scale: 2, cursor: 'arrow' };

// ---------- backend ----------
const tokens = {};
async function token(user) {
  if (tokens[user]) return tokens[user];
  const res = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: user, password: PASSWORD }) });
  if (!res.ok) throw new Error(`login ${user}: ${res.status}`);
  tokens[user] = (await res.json()).token;
  return tokens[user];
}
async function api(user, method, p, body) {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: { authorization: `Bearer ${await token(user)}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${p}: ${res.status} ${await res.text()}`);
  return res.json();
}
const reset = () => api('adviseur', 'POST', '/demo/reset');
const week = (w) => api('adviseur', 'POST', '/demo/week', { week: w });
const confirmTom = () => api('tom', 'POST', `/klanten/${TOM}/momenten/GEZINSUITBREIDING/bevestig`);
const shareJonas = () => api('jonas', 'POST', `/klanten/${JONAS}/momenten/delen`, { moment: 'ZAAK_UITBREIDEN', fase: 'plannend' });
const CO2 = 'product:business-co2-insights-and-sector-comparison';
const PAIR = 'koppeling:billit~kube';
const NOTE_CO2 = 'Verladers vragen steeds vaker CO2-cijfers. Met je elektrische vloot maak je daar meteen een troef van.';
const NOTE_PAIR = 'Laat Billit je walstroomfacturen meteen omzetten in CO2-cijfers in Kube.';
const sendKans = (link, bericht) => api('adviseur', 'POST', `/klanten/${JONAS}/kansen`, { link, bericht });
async function answerAll(user, klant) {
  for (const k of await api(user, 'GET', `/klanten/${klant}/kansen`)) {
    if (k.status === 'nieuw' || k.status === 'gezien') await api(user, 'PUT', `/klanten/${klant}/kansen/${k.id}`, { status: 'interesse' });
  }
}

// ---------- logins in the apps (before the recording starts) ----------
async function appLogin(page, user) {
  await page.goto(`${APP}/login`);
  await page.waitForLoadState('networkidle');
  await page.getByPlaceholder('bv. tom').fill(user);
  await page.locator('input[type=password]').fill(PASSWORD);
  await page.getByRole('button', { name: 'Inloggen', exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  await page.waitForLoadState('networkidle');
}
async function backofficeLogin(page, klantNaam) {
  await page.goto(BACKOFFICE);
  await page.waitForLoadState('networkidle');
  if (await page.getByRole('button', { name: /Aanmelden/ }).count()) {
    await page.locator('input').first().fill('adviseur');
    await page.locator('input[type=password]').fill(PASSWORD);
    await page.getByRole('button', { name: /Aanmelden/ }).click();
  }
  await page.getByRole('button', { name: 'Klanten', exact: true }).click();
  await page.locator('aside button', { hasText: klantNaam }).first().click();
  await page.waitForTimeout(1500);
}
async function chatLogin(page, user) {
  await page.goto(`${CHAT}/?app=chatgpt&exit=0`);
  await page.waitForLoadState('networkidle');
  if (await page.locator('#loginForm').isVisible()) {
    await page.locator('#loginForm label', { hasText: user[0].toUpperCase() + user.slice(1) }).first().click();
    await page.locator('#loginForm button[type=submit], #loginForm button').last().click();
  }
  await page.locator('#input').waitFor({ state: 'visible' });
  // Only the chat itself: no app switcher (it shows when the chat runs outside the showcase)
  await page.addStyleTag({ content: '.switcher{display:none!important}' });
  await page.waitForTimeout(600);
}

// ---------- recording ----------
/** One scene: a fresh browser on one app, `before` puts it in its starting state, `fn` is what's recorded. */
async function scene(name, opts, before, fn) {
  const browser = await L.launch();
  const ctx = await L.newContext(browser, opts);
  const page = await ctx.newPage();
  try {
    await run(page);
  } catch (e) {
    fs.mkdirSync(L.WORK, { recursive: true });
    await page.screenshot({ path: path.join(L.WORK, `${name}-error.png`) }).catch(() => {});
    await browser.close();
    throw e;
  }
  await browser.close();

  async function run(page) {
  await before(page);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(800);
  const rec = await L.startRecording(page, path.join(OUT, name));
  const p = L.pointer(page, opts.cursor);
  await page.waitForTimeout(600);
  const crop = await fn(page, p, rec);
  const info = await rec.stop();
  // A crop (CSS pixels) zooms the clip in on what matters
  fs.writeFileSync(path.join(OUT, name, 'crop.json'), JSON.stringify(crop ? { ...crop, vw: opts.viewport.width, vh: opts.viewport.height } : null));
  console.log(name, info, crop ? 'cropped' : '');
  }
}

/** The union of some elements' boxes, with a margin, inside the viewport. */
async function around(page, locators, margin = 16) {
  const boxes = [];
  for (const l of locators) boxes.push(await l.boundingBox());
  const vp = page.viewportSize();
  const x = Math.max(0, Math.min(...boxes.map((b) => b.x)) - margin);
  const y = Math.max(0, Math.min(...boxes.map((b) => b.y)) - margin);
  const x2 = Math.min(vp.width, Math.max(...boxes.map((b) => b.x + b.width)) + margin);
  const y2 = Math.min(vp.height, Math.max(...boxes.map((b) => b.y + b.height)) + margin);
  return { x: Math.round(x), y: Math.round(y), w: Math.round(x2 - x), h: Math.round(y2 - y) };
}
const agentCard = (page) => page.locator('section', { has: page.locator('h3', { hasText: 'KBC Agent' }) });

/** Clicks a hub label in the full-screen graph, then a link in its side panel. */
async function pickInGraph(page, p, hub, link) {
  await p.tap(page.locator('[role=dialog] svg text', { hasText: hub }).first(), { ms: 900 });
  await page.waitForTimeout(1100);
  await p.tap(page.locator('[role=dialog] aside button', { hasText: link }).first(), { ms: 800 });
  await page.waitForTimeout(1600);
}

const SCENES = {
  // Back office: Tom & Lien's score climbs, and the agent decides "Automatisch: Kate in de app".
  'tom-agent': () =>
    scene('tom-agent', DESK, async (page) => {
      await reset();
      await week(10);
      await backofficeLogin(page, 'Tom en Lien');
    }, async (page, p) => {
      await page.waitForTimeout(1500);
      await week(12);
      await page.waitForTimeout(2200);
      await week(14);
      await agentCard(page).getByText('Automatisch: Kate in de app').waitFor();
      await page.waitForTimeout(1200);
      await p.point(agentCard(page).getByText('Automatisch: Kate in de app'), { ms: 900 });
      await page.waitForTimeout(1400);
      await p.point(agentCard(page).getByText('Engagement via de app'), { ms: 800 });
      await page.waitForTimeout(3200);
      const crop = await around(page, [page.locator('main aside').first(), agentCard(page)]);
      await p.hide();
      await page.waitForTimeout(800);
      return crop;
    }),

  // App: Kate asks, Tom confirms, and Kate arranges the birth checklist with one tap.
  'tom-ask': () =>
    scene('tom-ask', PHONE, async (page) => {
      await reset();
      await week(14);
      await appLogin(page, 'tom');
      await page.getByText('Klopt dat?').first().waitFor();
    }, async (page, p) => {
      await page.waitForTimeout(2200);
      await p.tap(page.getByText('Bevestigen', { exact: true }).first(), { ms: 900 });
      await page.getByText('Bekijk checklist', { exact: true }).first().waitFor();
      await page.waitForTimeout(1800);
      await p.tap(page.getByText('Bekijk checklist', { exact: true }).first());
      await page.waitForTimeout(2000);
      await p.tap(page.getByText('Laat Kate alles regelen', { exact: true }).first());
      await page.getByText('5/5 geregeld').waitFor({ timeout: 30000 });
      await page.waitForTimeout(2500);
      await p.hide();
      return null;
    }),

  // App: the agent sends its offer by itself; a popup bursts open and Tom says yes.
  'tom-offer': () =>
    scene('tom-offer', PHONE, async (page) => {
      await reset();
      await week(14);
      await confirmTom();
      await week(18);
      await appLogin(page, 'tom');
    }, async (page, p) => {
      await page.waitForTimeout(2000);
      await week(20); // voorstel: the agent sends "Sparen voor iemand anders" on its own
      await page.getByText('Ja, graag!').waitFor({ timeout: 15000 });
      await page.waitForTimeout(3200);
      await p.tap(page.getByText('Ja, graag!'), { ms: 900 });
      await page.waitForTimeout(3600);
      await p.hide();
      return null;
    }),

  // Chat: Jonas asks his own AI, which shares only the moment with KBC.
  'jonas-ai': () =>
    scene('jonas-ai', CHATBOX, async (page) => {
      await reset();
      await week(20);
      await fetch(`${CHAT.replace(/\/$/, '')}/admin/reset`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).catch(() => {});
      await chatLogin(page, 'jonas');
    }, async (page, p) => {
      await page.waitForTimeout(1200);
      await p.type('#input', 'Ik wil een tweede elektrische duwboot laten bouwen voor Stroomvaart. Hoe financier ik dat best? Deel "zaak uitbreiden" (plannend) met KBC.', { delay: 28 });
      await page.waitForTimeout(500);
      await page.keyboard.press('Enter');
      await page.locator('.typing').waitFor({ state: 'detached', timeout: 60000 }).catch(() => {});
      await page.waitForTimeout(5000);
      await p.hide();
      return null;
    }),

  // Back office: for Jonas the agent calls in an adviser; his share moves the score live.
  'jonas-agent': () =>
    scene('jonas-agent', DESK, async (page) => {
      await reset();
      await week(20);
      await backofficeLogin(page, 'Jonas');
      await agentCard(page).getByText('Adviseur in de lus').waitFor();
    }, async (page, p) => {
      await page.waitForTimeout(1800);
      await shareJonas();
      await page.waitForTimeout(2500);
      await p.point(agentCard(page).getByText('Adviseur in de lus'), { ms: 900 });
      await page.waitForTimeout(1500);
      await p.point(agentCard(page).getByText(/Taak voor de adviseur/), { ms: 900 });
      await page.waitForTimeout(1600);
      await p.point(agentCard(page).getByText('Voorstel van de agent:'), { ms: 800 });
      await page.waitForTimeout(2600);
      const crop = await around(page, [page.locator('main aside').first(), agentCard(page)]);
      await p.hide();
      await page.waitForTimeout(600);
      return crop;
    }),

  // Back office: the network graph; the adviser sends CO2 insight, with its reasons, to Jonas's app.
  'jonas-co2': () =>
    scene('jonas-co2', DESK, async (page) => {
      await reset();
      await week(20);
      await shareJonas();
      await backofficeLogin(page, 'Jonas');
    }, async (page, p) => {
      await page.waitForTimeout(1000);
      await p.tap(page.getByRole('button', { name: /Volledig scherm/ }).first(), { ms: 900 });
      await page.waitForTimeout(2600);
      await pickInGraph(page, p, 'Energie en duurzaamheid', 'Business CO2 insights');
      await p.point(page.locator('[role=dialog] aside').getByText('Waarom').first(), { ms: 800 });
      await page.waitForTimeout(2200);
      await p.tap(page.locator('[role=dialog] aside').getByRole('button', { name: /Stuur naar KBC Mobile/ }));
      await page.waitForTimeout(1200);
      await p.type('textarea', NOTE_CO2, { delay: 22 });
      await page.waitForTimeout(700);
      await p.tap(page.getByRole('button', { name: /Versturen/ }));
      await page.waitForTimeout(2600);
      await p.hide();
      return null;
    }),

  // Back office: Billit and Kube both work for Jonas, not with each other; the adviser proposes the pair.
  'jonas-pair': () =>
    scene('jonas-pair', DESK, async (page) => {
      await reset();
      await week(20);
      await shareJonas();
      await sendKans(CO2, NOTE_CO2);
      await backofficeLogin(page, 'Jonas');
      await page.getByRole('button', { name: /Volledig scherm/ }).first().click();
      await page.waitForTimeout(2500);
    }, async (page, p) => {
      await page.waitForTimeout(1200);
      await pickInGraph(page, p, 'Ondernemen', 'Billit');
      await p.point(page.locator('[role=dialog] aside').getByText(/Samenwerking/).first(), { ms: 800 });
      await page.waitForTimeout(2200);
      await p.tap(page.locator('[role=dialog] aside').getByRole('button', { name: /Voorstel naar KBC Mobile/ }));
      await page.waitForTimeout(1200);
      await p.type('textarea', NOTE_PAIR, { delay: 22 });
      await page.waitForTimeout(700);
      await p.tap(page.getByRole('button', { name: /Versturen/ }));
      await page.waitForTimeout(2600);
      await p.hide();
      return null;
    }),

  // App: Jonas gets both proposals and says yes to both.
  'jonas-yes': () =>
    scene('jonas-yes', PHONE, async (page) => {
      await reset();
      await week(20);
      await shareJonas();
      await sendKans(CO2, NOTE_CO2);
      await sendKans(PAIR, NOTE_PAIR);
      await appLogin(page, 'jonas');
    }, async (page, p) => {
      await page.getByText('Ja, graag!').waitFor({ timeout: 20000 });
      await page.waitForTimeout(3200);
      await p.tap(page.getByText('Ja, graag!'), { ms: 900 });
      await page.getByText('Ja, laat ze samenwerken').waitFor({ timeout: 15000 });
      await page.waitForTimeout(3600);
      await p.tap(page.getByText('Ja, laat ze samenwerken'), { ms: 900 });
      await page.waitForTimeout(3200);
      await p.hide();
      return null;
    }),

  // Back office: Jonas said yes, and the violet line between Billit and Kube turns solid.
  'jonas-connected': () =>
    scene('jonas-connected', DESK, async (page) => {
      await reset();
      await week(20);
      await shareJonas();
      await sendKans(PAIR, NOTE_PAIR);
      await backofficeLogin(page, 'Jonas');
      await page.getByRole('button', { name: /Volledig scherm/ }).first().click();
      await page.waitForTimeout(2500);
      await page.locator('[role=dialog] svg text', { hasText: 'Ondernemen' }).first().click();
      await page.waitForTimeout(800);
      await page.locator('[role=dialog] aside button', { hasText: 'Billit' }).first().click();
      await page.waitForTimeout(1500);
    }, async (page) => {
      await page.waitForTimeout(2000);
      await answerAll('jonas', JONAS);
      await page.locator('[role=dialog] aside').getByText(/Klant heeft interesse|Actief: de klant gaf akkoord/).first().waitFor({ timeout: 10000 });
      await page.waitForTimeout(4500);
      return null;
    }),
};

(async () => {
  const want = process.argv.slice(2);
  for (const name of want.length ? want : Object.keys(SCENES)) {
    // eslint-disable-next-line no-await-in-loop -- one scene after the other: they share the backend
    await SCENES[name]();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
