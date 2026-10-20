'use strict';

// Builds the finals deck (out/KBC-Momentum-finals.pptx) around the recorded clips: one clip per slide, playing by
// itself when the slide opens. The speaker's lines are in the notes. Usage: node deck.js (after record + encode).
const fs = require('node:fs');
const path = require('node:path');
const pptxgen = require('pptxgenjs');

const OUT = path.join(__dirname, 'out');
const PHOTOS = path.resolve(__dirname, '../../gateway/public/img');
const DECK = path.join(OUT, 'KBC-Momentum-finals.pptx');

const C = { navy: '0B1F3A', navy2: '13294B', sky: '00AEEF', sun: 'FFD34D', ink: '12305A', soft: '5D7290', paper: 'F4F8FC', white: 'FFFFFF', green: '1F9D55', mint: 'E4F6EB', line: 'D8E3EF' };
const FONT = 'Arial';

/** Clip sizes and lengths (ffprobe), for the frame and the autoplay timing. */
const CLIPS = {
  'tom-agent': { w: 1600, h: 1146, s: 15.5 },
  'tom-ask': { w: 720, h: 1476, s: 19.1 }, // encoded at 1.3x
  'tom-offer': { w: 720, h: 1476, s: 13.3 },
  'jonas-ai': { w: 1440, h: 1120, s: 15.6 }, // encoded at 1.4x (the typing)
  'jonas-agent': { w: 1600, h: 1146, s: 15.5 },
  'jonas-co2': { w: 1600, h: 1000, s: 27.7 },
  'jonas-pair': { w: 1600, h: 1000, s: 17.4 }, // encoded at 1.25x
  'jonas-yes': { w: 720, h: 1476, s: 13.6 }, // encoded at 1.2x
  'jonas-connected': { w: 1600, h: 1000, s: 11.3 },
};

const pres = new pptxgen();
pres.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5 in
pres.title = 'KBC Momentum: finals pitch';
pres.author = 'In4matics';
pres.theme = { headFontFace: FONT, bodyFontFace: FONT };

const text = (slide, t, o) => slide.addText(t, { fontFace: FONT, isTextBox: true, margin: 0, valign: 'top', ...o });
const dark = (section) => { const s = pres.addSlide({ sectionTitle: section }); s.background = { color: C.navy }; return s; };
const light = (section) => { const s = pres.addSlide({ sectionTitle: section }); s.background = { color: C.paper }; return s; };
const photo = (who) => path.join(PHOTOS, who === 'jonas' ? 'jonas.jpg' : 'tom-lien.jpg');
const brand = (slide, onDark = true) =>
  text(slide, 'KBC Momentum', { x: 0.6, y: 0.4, w: 4, h: 0.3, fontSize: 12, bold: true, charSpacing: 2, color: onDark ? C.sky : C.ink });

/** Slides with a clip, for the autoplay step after writing. */
const videoSlides = [];

// ---------- the two journeys, step by step ----------
const JOURNEYS = {
  tom: {
    who: 'tom', name: 'Tom & Lien', journey: 'Journey 1', mode: 'Fully automatic',
    intro: 'The agent sees standard products and very digital customers: Kate handles everything in the app. No person involved.',
    steps: [
      { clip: 'tom-agent', label: 'The agent decides', title: 'Signals come in, the agent decides', text: 'From sources they allowed, their score passes 70%. The agent picks the channel: Kate in the app.', consent: 'Their account, app use and own AI · never health data',
        notes: '"Tom and Lien haven\'t told anyone yet. But from the sources they allowed, their bank sees a baby store, a childcare registration, a question to their own AI. KBC\'s agent decides who approaches them: retail, standard products, very digital. Kate handles this herself."' },
      { clip: 'tom-ask', label: 'Kate asks first', title: 'Kate asks first, then arranges it', text: 'Nothing happens without their yes. Then Kate arranges the birth checklist with one tap.', consent: 'Only after Tom confirms',
        notes: '"Kate asks first. Only after a yes does anything happen. Four things are already in order; Kate arranges the rest with one tap."' },
      { clip: 'tom-offer', label: "Kate's own offer", title: 'Kate sends an offer on her own', text: 'A savings plan for the little one, straight into the app. Tom says yes. No person involved.', consent: 'Only once the moment is confirmed',
        notes: '"Then the agent goes one step further on its own: a savings plan for the little one, straight into the app. Tom says yes. No person touched it."' },
    ],
  },
  jonas: {
    who: 'jonas', name: 'Jonas · Stroomvaart', journey: 'Journey 2', mode: 'An adviser in the loop',
    intro: 'A business customer and a big investment: the agent sees he engages more with a person, and brings in an adviser.',
    adviser: [2, 3],
    steps: [
      { clip: 'jonas-ai', label: 'His own AI shares', title: 'His own AI shares the moment', text: 'Jonas asks how to finance a second electric ship, and lets his AI share only the moment with KBC.', consent: 'Only because he asked · never the conversation',
        notes: '"Jonas runs Stroomvaart: electric inland shipping on the Scheldt. He asks his own AI how to finance a second ship, and lets it share only the moment with KBC. Never the conversation."' },
      { clip: 'jonas-agent', label: 'The agent calls an adviser', title: 'The agent calls in an adviser', text: 'Business customer, big investment: 75% engagement via a person, 63% via the app. The adviser gets a task.', consent: 'His account, his app, and the moment he shared',
        notes: '"Here the agent decides differently: a business customer, a big investment. He will engage more with a person. So it hands this to an adviser, with a task and suggestions."' },
      { clip: 'jonas-pair', label: 'The adviser connects partners', title: 'The adviser connects his partners', text: 'Billit and Kube both work for Jonas, not with each other. In the network graph, one click proposes they do.', consent: 'Data flows between them only after his yes',
        notes: '"In Stroomvaart\'s network the adviser sees more: Billit and Kube both work for Jonas, but not with each other. One click proposes they work together: his shore-power invoices become CO2 figures."' },
      { clip: 'jonas-yes', label: 'Jonas says yes', title: 'Jonas says yes in his app', text: 'Both proposals pop up in his app: the CO2 insight and the partner link.', consent: 'He decides, and can switch it off any time',
        notes: '"Seconds later both proposals are in his app, and Jonas says yes to both."' },
      { clip: 'jonas-connected', label: 'Partners connected', title: 'The partners now work together', text: "In KBC's network the line between Billit and Kube turns solid: two partners, working for one customer.", consent: 'He can switch it off any time',
        notes: '"And in his network the line turns solid: two partners now work together, for one customer."' },
    ],
  },
};

/** A journey's opening slide: its name and the steps as one numbered process, nothing more. */
function journeyIntro(section, j) {
  const s = light(section);
  text(s, `${j.who === 'jonas' ? 'Jonas' : 'Tom & Lien'}: ${j.mode.toLowerCase()}`, { x: 0.6, y: 2.0, w: 12.1, h: 0.9, fontSize: 40, bold: true, color: C.ink, align: 'center' });
  const n = j.steps.length;
  const gap = 12.13 / n;
  const y = 3.6;
  s.addShape(pres.shapes.LINE, { x: 0.6 + gap / 2, y: y + 0.3, w: gap * (n - 1), h: 0, line: { color: C.line, width: 2 } });
  j.steps.forEach((st, i) => {
    const cx = 0.6 + gap * i + gap / 2;
    const human = j.adviser?.includes(i + 1);
    s.addShape(pres.shapes.OVAL, { x: cx - 0.3, y, w: 0.6, h: 0.6, fill: { color: human ? C.white : C.navy }, line: { color: C.navy, width: 2 }, objectName: `step ${i + 1}` });
    text(s, String(i + 1), { x: cx - 0.3, y, w: 0.6, h: 0.6, fontSize: 18, bold: true, color: human ? C.navy : C.white, align: 'center', valign: 'middle' });
    text(s, st.label, { x: cx - gap / 2 + 0.1, y: y + 0.8, w: gap - 0.2, h: 0.8, fontSize: 16, bold: true, color: C.ink, align: 'center' });
  });
  if (j.adviser) text(s, '○ with the adviser   ● by itself', { x: 0.6, y: 5.6, w: 12.1, h: 0.4, fontSize: 13, color: C.soft, align: 'center' });
  s.addNotes(`${j.journey}: ${j.mode}. ${j.intro}`);
}

/** One step: the same layout on every slide. Left the step and the list of steps, right the clip. */
function stepSlide(section, j, i) {
  const st = j.steps[i];
  const s = light(section);

  // Left: the step's title and where it sits in the journey, nothing more (the speaker says the rest)
  const lw = 4.55;
  const listH = j.steps.length * 0.5;
  const top = (7.5 - (1.5 + 0.35 + listH)) / 2;
  text(s, st.title, { x: 0.6, y: top, w: lw, h: 1.5, fontSize: 32, bold: true, color: C.ink, valign: 'bottom', fit: 'shrink' });
  j.steps.forEach((x, k) => {
    const y = top + 1.85 + k * 0.5;
    const now = k === i;
    const done = k < i;
    s.addShape(pres.shapes.OVAL, { x: 0.6, y: y + 0.03, w: 0.3, h: 0.3, fill: { color: now ? C.navy : done ? C.sky : C.white }, line: { color: now ? C.navy : done ? C.sky : C.line, width: 1.25 } });
    text(s, done ? '✓' : String(k + 1), { x: 0.6, y: y + 0.03, w: 0.3, h: 0.3, fontSize: 10, bold: true, color: now || done ? C.white : C.soft, align: 'center', valign: 'middle' });
    text(s, x.label, { x: 1.05, y: y + 0.02, w: lw - 0.45, h: 0.34, fontSize: 16, bold: now, color: now ? C.ink : C.soft });
  });

  // Right: the clip, in a phone body or a screen frame. The padding is larger than what the rounded corners cut
  // away, so the clip's square corners stay inside the frame.
  const c = CLIPS[st.clip];
  const phone = c.h > c.w;
  const pad = phone ? { x: 0.2, y: 0.32, r: 0.42 } : { x: 0.1, y: 0.1, r: 0.12 };
  const box = { x: 5.7, y: 0.45, w: 7.03, h: 6.6 };
  const vh = Math.min(box.h - 2 * pad.y, ((box.w - 2 * pad.x) * c.h) / c.w);
  const vw = (vh * c.w) / c.h;
  const vx = box.x + (box.w - vw) / 2;
  const vy = box.y + (box.h - vh) / 2;
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: vx - pad.x, y: vy - pad.y, w: vw + 2 * pad.x, h: vh + 2 * pad.y, rectRadius: pad.r,
    fill: { color: phone ? '05090F' : C.white }, line: { color: phone ? '2A3A55' : C.line, width: phone ? 2 : 1 },
    shadow: { type: 'outer', color: '0B1F3A', opacity: 0.18, blur: 10, offset: 3, angle: 90 }, objectName: phone ? 'phone body' : 'screen frame',
  });
  s.addMedia({ type: 'video', path: path.join(OUT, `${st.clip}.mp4`), x: vx, y: vy, w: vw, h: vh, cover: `data:image/png;base64,${fs.readFileSync(path.join(OUT, `${st.clip}.png`)).toString('base64')}`, objectName: `clip ${st.clip}` });
  videoSlides.push({ index: pres.slides.length, ms: Math.round(c.s * 1000) });
  s.addNotes(`${st.notes}\n\nConsent: ${st.consent}.`);
}

/** Three points and nothing else: the speaker says the rest (it's in the notes). */
function threePoints(s, items) {
  items.forEach(([badge, head], i) => {
    const x = 0.6 + i * 4.1;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y: 2.35, w: 3.8, h: 2.8, rectRadius: 0.15, fill: { color: C.white }, line: { color: C.line, width: 1 }, objectName: `point ${i + 1}` });
    s.addShape(pres.shapes.OVAL, { x: x + 1.4, y: 2.75, w: 1.0, h: 1.0, fill: { color: C.navy }, line: { type: 'none' } });
    text(s, badge, { x: x + 1.4, y: 2.75, w: 1.0, h: 1.0, fontSize: 30, bold: true, color: C.white, align: 'center', valign: 'middle' });
    text(s, head, { x: x + 0.3, y: 4.0, w: 3.2, h: 1.0, fontSize: 24, bold: true, color: C.ink, align: 'center' });
  });
}

// ---------- 1 · Opening (speaker 1) ----------
pres.addSection({ title: 'Opening' });
{
  const s = dark('Opening');
  brand(s);
  text(s, ['Moving in together.', 'Buying a house.', 'Getting married.', 'A baby.', 'Retiring.'].map((t, i, a) => ({ text: t, options: { breakLine: i < a.length - 1 } })),
    { x: 0.6, y: 1.2, w: 6.6, h: 3.6, fontSize: 36, bold: true, color: C.white, paraSpaceAfter: 4 });
  text(s, 'The best moments of your life. And each one comes with a list.', { x: 0.6, y: 5.3, w: 6.6, h: 1.2, fontSize: 22, color: C.sky });
  s.addImage({ path: photo('tom'), x: 7.75, y: 0.9, w: 5.0, h: 2.79, rounding: false, objectName: 'photo Tom & Lien' });
  s.addImage({ path: photo('jonas'), x: 7.75, y: 3.9, w: 5.0, h: 2.79, objectName: 'photo Jonas' });
  s.addNotes('Speaker 1. "Moving in together. Buying a house. Getting married. A baby. Retiring. The best moments of your life. And each one comes with a list."');
}
{
  const s = dark('Opening');
  brand(s);
  text(s, 'We believe your bank should be there at the moments that matter.', { x: 0.6, y: 1.6, w: 9.5, h: 2.2, fontSize: 40, bold: true, color: C.white });
  text(s, 'Not afterwards. Before.', { x: 0.6, y: 4.3, w: 9.5, h: 1, fontSize: 40, bold: true, color: C.sky });
  s.addNotes('"We believe your bank should be there at the moments that matter. Not afterwards. Before."');
}
{
  const s = light('Opening');
  threePoints(s, [['?', 'Which insurance?'], ['✎', 'Which form, which agency, by when?'], ['⇄', 'See, compare, coordinate']]);
  s.addNotes('"Today you figure it out yourself. Which insurance? Which form, at which agency, by when? You have to see what is needed yourself, compare yourself and coordinate yourself. But at the most important moments of your life you want to be there for your family. Not for your paperwork. That is exactly KBC\'s question: how do you get from intent to action?"');
}

// ---------- 2 · The reveal (speaker 2, 0:50–1:20) ----------
pres.addSection({ title: 'The reveal' });
{
  const s = dark('The reveal');
  brand(s);
  text(s, 'Our answer: KBC Momentum', { x: 0.6, y: 1.3, w: 12, h: 0.9, fontSize: 40, bold: true, color: C.white });
  text(s, 'Banks today think in Next Best Offer.', { x: 0.6, y: 3.0, w: 12, h: 0.8, fontSize: 30, color: '8EA2C2' });
  text(s, 'We built Next Best Moment.', { x: 0.6, y: 4.0, w: 12, h: 1.0, fontSize: 44, bold: true, color: C.sun });
  s.addNotes('Speaker 2 (0:50). "Our answer is called KBC Momentum. Banks today think in Next Best Offer. [Pause] We built Next Best Moment."');
}
{
  const s = light('The reveal');
  threePoints(s, [['1', 'Kate sees it'], ['2', 'Kate asks first'], ['3', 'Kate arranges it']]);
  s.addNotes('"One engine for every life moment. And at each moment Kate does three things. She sees it: signals from five sources, only with your consent and never health data. She asks first: nothing happens without your yes, and our AI agent picks the right channel. She arranges it: one plan with KBC and partners that mostly runs by itself. You live the moment. Kate handles the rest."');
}

// ---------- 3 · Tom & Lien: fully automatic, step by step ----------
pres.addSection({ title: 'Tom & Lien' });
journeyIntro('Tom & Lien', JOURNEYS.tom);
JOURNEYS.tom.steps.forEach((_, i) => stepSlide('Tom & Lien', JOURNEYS.tom, i));

// ---------- 4 · Jonas: an adviser in the loop, step by step ----------
pres.addSection({ title: 'Jonas' });
journeyIntro('Jonas', JOURNEYS.jonas);
JOURNEYS.jonas.steps.forEach((_, i) => stepSlide('Jonas', JOURNEYS.jonas, i));

// ---------- 5 · Closing ----------
pres.addSection({ title: 'Closing' });
{
  const s = dark('Closing');
  text(s, 'One agent, for millions of customers', { x: 0.6, y: 2.6, w: 12, h: 1.0, fontSize: 44, bold: true, color: C.white });
  text(s, 'Automatic where it can. A person where it matters.', { x: 0.6, y: 3.75, w: 12, h: 0.7, fontSize: 26, color: C.sky });
  s.addNotes('"One agent, for millions of customers: automatic where it can, a person where it matters. Customers go from intent to action without searching. KBC shows up at the right moment, through the right channel. Partners get customers who gave consent, and work together for them. And trust is built in: no language model decides, health data never counts, the customer always has the last word."');
}
{
  const s = dark('Closing');
  text(s, 'You live the moment.\nKate handles the rest.', { x: 0.6, y: 2.2, w: 12, h: 1.9, fontSize: 48, bold: true, color: C.white });
  text(s, 'Questions?', { x: 0.6, y: 4.5, w: 12, h: 0.7, fontSize: 28, color: C.sky });
  s.addNotes('"You live the moment. Kate handles the rest." Then the questions.');
}

(async () => {
  await pres.writeFile({ fileName: DECK });
  fs.writeFileSync(path.join(OUT, 'video-slides.json'), JSON.stringify(videoSlides));
  console.log(DECK, videoSlides.length, 'clips');
})();
