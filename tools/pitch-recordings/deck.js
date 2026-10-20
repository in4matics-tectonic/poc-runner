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
  'tom-ask': { w: 720, h: 1476, s: 24.8 },
  'tom-offer': { w: 720, h: 1476, s: 13.3 },
  'jonas-ai': { w: 1440, h: 1120, s: 21.8 },
  'jonas-agent': { w: 1600, h: 1146, s: 15.5 },
  'jonas-co2': { w: 1600, h: 1000, s: 27.7 },
  'jonas-pair': { w: 1600, h: 1000, s: 21.8 },
  'jonas-yes': { w: 720, h: 1476, s: 16.3 },
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

/** A demo slide: who and which journey, the point, a consent line, and the clip on the right. */
function clipSlide(section, { clip, who, journey, title, points, consent, notes }) {
  const s = light(section);
  const c = CLIPS[clip];
  const phone = c.h > c.w;
  // The clip: phone clips tall on the right, back office and chat clips wide
  const vh = phone ? 6.5 : Math.min(6.1, (7.1 * c.h) / c.w);
  const vw = (vh * c.w) / c.h;
  const vx = 13.33 - 0.55 - vw;
  const vy = (7.5 - vh) / 2;
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: vx - 0.08, y: vy - 0.08, w: vw + 0.16, h: vh + 0.16, rectRadius: phone ? 0.35 : 0.15,
    fill: { color: phone ? '05090F' : C.white }, line: { color: C.line, width: 1 },
    shadow: { type: 'outer', color: '0B1F3A', opacity: 0.25, blur: 12, offset: 4, angle: 90 }, objectName: 'clip frame',
  });
  s.addMedia({ type: 'video', path: path.join(OUT, `${clip}.mp4`), x: vx, y: vy, w: vw, h: vh, cover: `data:image/png;base64,${fs.readFileSync(path.join(OUT, `${clip}.png`)).toString('base64')}`, objectName: `clip ${clip}` });
  videoSlides.push({ index: pres.slides.length, ms: Math.round(c.s * 1000) });

  // Text column
  const tw = vx - 0.6 - 0.45;
  s.addImage({ path: photo(who), x: 0.6, y: 0.55, w: 0.62, h: 0.62, rounding: true, sizing: { type: 'cover', w: 0.62, h: 0.62 }, objectName: 'persona' });
  text(s, [
    { text: who === 'jonas' ? 'Jonas · Stroomvaart' : 'Tom & Lien', options: { bold: true, color: C.ink, fontSize: 15, breakLine: true } },
    { text: journey, options: { color: C.soft, fontSize: 12 } },
  ], { x: 1.35, y: 0.58, w: tw - 0.75, h: 0.6 });
  text(s, title, { x: 0.6, y: 1.55, w: tw, h: 1.7, fontSize: 32, bold: true, color: C.ink, valign: 'top', fit: 'shrink' });
  text(s, points.map((p, i) => ({ text: p, options: { bullet: { indent: 18 }, breakLine: i < points.length - 1, paraSpaceAfter: 8 } })),
    { x: 0.6, y: 3.35, w: tw, h: 2.3, fontSize: 16, color: C.ink });
  if (consent) {
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.6, y: 5.85, w: tw, h: 0.9, rectRadius: 0.12, fill: { color: C.mint }, line: { color: '3CCF8E', width: 1.25 }, objectName: 'consent' });
    text(s, [
      { text: 'SHARED WITH CONSENT', options: { bold: true, fontSize: 10, color: '157A42', charSpacing: 1, breakLine: true } },
      { text: consent, options: { fontSize: 13, color: C.ink } },
    ], { x: 0.8, y: 5.97, w: tw - 0.4, h: 0.7 });
  }
  s.addNotes(notes);
  return s;
}

// ---------- 1 · Opening (speaker 1) ----------
pres.addSection({ title: 'Opening' });
{
  const s = dark('Opening');
  brand(s);
  text(s, ['Moving in together.', 'Buying a house.', 'Getting married.', 'A baby.', 'Retiring.'].map((t, i, a) => ({ text: t, options: { breakLine: i < a.length - 1 } })),
    { x: 0.6, y: 1.2, w: 6.6, h: 3.6, fontSize: 36, bold: true, color: C.white, paraSpaceAfter: 4 });
  text(s, 'The best moments of your life. And each one comes with a list.', { x: 0.6, y: 5.3, w: 6.6, h: 1.2, fontSize: 22, color: C.sun, italic: true });
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
  brand(s, false);
  text(s, 'Today, you figure it out yourself', { x: 0.6, y: 0.9, w: 12, h: 0.8, fontSize: 36, bold: true, color: C.ink });
  const cards = [
    ['?', 'Which insurance?', 'Which product fits now, and which one do you already have?'],
    ['✎', 'Which form, which agency, by when?', 'Child benefit, the municipality, your health fund, your employer.'],
    ['⇄', 'See, compare, coordinate', 'All of it yourself, at the moment you have the least time.'],
  ];
  cards.forEach(([icon, head, body], i) => {
    const x = 0.6 + i * 4.1;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y: 2.0, w: 3.8, h: 2.6, rectRadius: 0.15, fill: { color: C.white }, line: { color: C.line, width: 1 }, objectName: `card ${i + 1}` });
    s.addShape(pres.shapes.OVAL, { x: x + 0.3, y: 2.3, w: 0.7, h: 0.7, fill: { color: C.sky }, line: { type: 'none' } });
    text(s, icon, { x: x + 0.3, y: 2.3, w: 0.7, h: 0.7, fontSize: 22, bold: true, color: C.white, align: 'center', valign: 'middle' });
    text(s, head, { x: x + 0.3, y: 3.15, w: 3.2, h: 0.6, fontSize: 18, bold: true, color: C.ink });
    text(s, body, { x: x + 0.3, y: 3.8, w: 3.2, h: 0.75, fontSize: 14, color: C.soft });
  });
  text(s, 'At the most important moments of your life, you want to be there for your family. Not for your paperwork.', { x: 0.6, y: 5.0, w: 12, h: 0.8, fontSize: 20, color: C.ink });
  text(s, "That's exactly KBC's question: how do you get from intent to action?", { x: 0.6, y: 5.9, w: 12, h: 0.7, fontSize: 22, bold: true, color: C.sky });
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
  brand(s, false);
  text(s, 'One engine for every life moment', { x: 0.6, y: 0.9, w: 12, h: 0.8, fontSize: 36, bold: true, color: C.ink });
  const cols = [
    ['1', 'Kate sees it', 'Signals from five sources, only with your consent, and never health data.'],
    ['2', 'Kate asks first', 'Nothing happens without your yes. Then an AI agent picks the channel: Kate in the app, or an adviser.'],
    ['3', 'Kate arranges it', 'One plan with KBC and partners, that mostly runs by itself.'],
  ];
  cols.forEach(([n, head, body], i) => {
    const x = 0.6 + i * 4.1;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y: 2.0, w: 3.8, h: 3.0, rectRadius: 0.15, fill: { color: C.white }, line: { color: C.line, width: 1 }, objectName: `step ${n}` });
    s.addShape(pres.shapes.OVAL, { x: x + 0.3, y: 2.3, w: 0.75, h: 0.75, fill: { color: C.navy }, line: { type: 'none' } });
    text(s, n, { x: x + 0.3, y: 2.3, w: 0.75, h: 0.75, fontSize: 24, bold: true, color: C.sun, align: 'center', valign: 'middle' });
    text(s, head, { x: x + 0.3, y: 3.25, w: 3.2, h: 0.6, fontSize: 22, bold: true, color: C.ink });
    text(s, body, { x: x + 0.3, y: 3.9, w: 3.2, h: 1.0, fontSize: 15, color: C.soft });
  });
  text(s, 'You live the moment. Kate handles the rest.', { x: 0.6, y: 5.6, w: 12, h: 0.9, fontSize: 30, bold: true, color: C.sky });
  s.addNotes('"One engine for every life moment. And at each moment Kate does three things. She sees it: signals from five sources, only with your consent and never health data. She asks first: nothing happens without your yes, and our AI agent picks the right channel. She arranges it: one plan with KBC and partners that mostly runs by itself. You live the moment. Kate handles the rest."');
}

// ---------- 3 · Tom & Lien: fully automatic ----------
pres.addSection({ title: 'Tom & Lien' });
clipSlide('Tom & Lien', {
  clip: 'tom-agent', who: 'tom', journey: 'Journey 1 · fully automatic',
  title: 'The agent decides: Kate handles this herself',
  points: ['Their score climbs past 70% from signals they allowed', 'Retail, standard products, very digital: 83% engagement via the app, 30% via an adviser'],
  consent: 'Account transactions, KBC Mobile use, their own AI · never health data',
  notes: '"Tom and Lien haven\'t told anyone yet. But from the sources they allowed, their bank sees a baby store, a childcare registration, a question to their own AI. KBC\'s agent decides who should approach them: retail, standard products, very digital. Kate handles this herself. No adviser needed."',
});
clipSlide('Tom & Lien', {
  clip: 'tom-offer', who: 'tom', journey: 'Journey 1 · fully automatic',
  title: 'Kate even sends an offer on her own',
  points: ['After their yes, Kate arranges the birth checklist with one tap', 'Then the agent goes one step further: a savings plan for the little one, straight into the app', 'Tom says yes. No person touched it'],
  consent: 'Only after Tom confirmed the moment himself',
  notes: '"Kate asks first, and after their yes she arranges the rest with one tap. Then the agent goes one step further on its own: a savings plan for the little one, straight into the app. Tom says yes. No person touched it."',
});

// ---------- 4 · Jonas: an adviser in the loop ----------
pres.addSection({ title: 'Jonas' });
clipSlide('Jonas', {
  clip: 'jonas-agent', who: 'jonas', journey: 'Journey 2 · adviser in the loop',
  title: 'For Jonas, the agent calls in an adviser',
  points: ['His own AI shared only the moment: a second electric ship', 'Business customer, big investment: 75% engagement via a person, 63% via the app', 'The adviser gets a task, with the agent\'s suggestions'],
  consent: 'His own AI shared the moment after his yes · never the conversation',
  notes: '"Jonas runs Stroomvaart: electric inland shipping on the Scheldt. His own AI shares only the moment with KBC. Here the agent decides differently: a business customer, a big investment. He will engage more with a person. So it hands this to an adviser, with a task and suggestions."',
});
clipSlide('Jonas', {
  clip: 'jonas-pair', who: 'jonas', journey: 'Journey 2 · adviser in the loop',
  title: 'Connecting partners, for one customer',
  points: ['Billit and Kube both work for Jonas, but not with each other', 'From the network graph, the adviser proposes the link: shore-power invoices become CO2 figures'],
  consent: 'Billit and Kube exchange data only after Jonas\'s yes',
  notes: '"The adviser opens Stroomvaart\'s network. Billit and Kube both work for Jonas, but not with each other. With one click, the adviser proposes that they work together for him: his shore-power invoices become CO2 figures."',
});
clipSlide('Jonas', {
  clip: 'jonas-connected', who: 'jonas', journey: 'Journey 2 · adviser in the loop',
  title: 'Jonas says yes, and the line turns solid',
  points: ['The proposal pops up in his app, he agrees', 'In KBC\'s network the two partners are now connected, for him'],
  consent: 'He can switch it off any time',
  notes: '"Jonas says yes in his app, and in his network the line turns solid: two partners now work together, for one customer."',
});

// ---------- 5 · Closing ----------
pres.addSection({ title: 'Closing' });
{
  const s = dark('Closing');
  brand(s);
  text(s, 'One agent, for millions of customers', { x: 0.6, y: 1.0, w: 12, h: 0.9, fontSize: 40, bold: true, color: C.white });
  text(s, 'Automatic where it can. A person where it matters.', { x: 0.6, y: 1.9, w: 12, h: 0.6, fontSize: 22, color: C.sky });
  [['Customer', 'From intent to action, without searching'], ['KBC', 'At the right moment, through the right channel'], ['Partner', 'Customers who gave consent, and partners that work together for them']].forEach(([h, b], i) => {
    const x = 0.6 + i * 4.1;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y: 2.9, w: 3.8, h: 1.9, rectRadius: 0.15, fill: { color: C.navy2 }, line: { color: '22385C', width: 1 }, objectName: `win ${h}` });
    text(s, h, { x: x + 0.3, y: 3.15, w: 3.2, h: 0.5, fontSize: 22, bold: true, color: C.sun });
    text(s, b, { x: x + 0.3, y: 3.7, w: 3.2, h: 1.0, fontSize: 15, color: C.white });
  });
  text(s, 'No language model decides · Health data never counts · Consent per source and per partner pair · The customer has the last word', { x: 0.6, y: 5.2, w: 12, h: 0.5, fontSize: 14, color: '8EA2C2' });
  text(s, 'You live the moment. Kate handles the rest.', { x: 0.6, y: 5.95, w: 12, h: 0.8, fontSize: 30, bold: true, color: C.white });
  s.addNotes('"One agent, for millions of customers: automatic where it can, a person where it matters. Customers go from intent to action without searching. KBC shows up at the right moment, through the right channel. Partners get customers who gave consent, and work together for them. And trust is built in: no language model decides, health data never counts, the customer always has the last word. You live the moment. Kate handles the rest."');
}
{
  const s = dark('Closing');
  brand(s);
  text(s, 'Questions?', { x: 0.6, y: 2.6, w: 12, h: 1.3, fontSize: 60, bold: true, color: C.white });
  text(s, 'KBC Momentum · In4matics', { x: 0.6, y: 4.0, w: 12, h: 0.5, fontSize: 20, color: C.sky });
  s.addNotes('Q&A: the backup clips after this slide show the rest of the demo.');
}

// ---------- Backup clips for the Q&A ----------
pres.addSection({ title: 'Backup clips' });
clipSlide('Backup clips', {
  clip: 'tom-ask', who: 'tom', journey: 'Backup · Tom & Lien',
  title: 'Kate asks first, then arranges it all',
  points: ['"Klopt dat?": nothing happens without their yes', '4 things already in order, 5 arranged with one tap'],
  consent: 'Only sources they allowed · never health data',
  notes: 'Backup clip: Kate asks, Tom confirms, the birth checklist runs.',
});
clipSlide('Backup clips', {
  clip: 'jonas-ai', who: 'jonas', journey: 'Backup · Jonas',
  title: 'His own AI shares the moment',
  points: ['Through KBC\'s MCP server: share, read, revoke, nothing more', 'Only the moment and a phase, never the conversation'],
  consent: 'Shared only after Jonas asked for it',
  notes: 'Backup clip: Jonas asks his own AI (ChatGPT look, Claude behind it) and it shares the moment through MCP.',
});
clipSlide('Backup clips', {
  clip: 'jonas-co2', who: 'jonas', journey: 'Backup · Jonas',
  title: 'The network shows why',
  points: ['CO2 insight is suggested because Encon, Kube and Sweco all point there', 'The adviser sends it with a personal note'],
  consent: 'Encon, Kube and Billit share data because Jonas switched them on',
  notes: 'Backup clip: the full-screen network graph, the reasoning lines behind CO2 insight, sending it to the app.',
});
clipSlide('Backup clips', {
  clip: 'jonas-yes', who: 'jonas', journey: 'Backup · Jonas',
  title: 'Two proposals, two yeses',
  points: ['The CO2 insight from his adviser', 'Billit and Kube working together for him'],
  consent: 'Data flows between partners only after his yes',
  notes: 'Backup clip: the proposals pop up in Jonas\'s app and he agrees to both.',
});

(async () => {
  await pres.writeFile({ fileName: DECK });
  fs.writeFileSync(path.join(OUT, 'video-slides.json'), JSON.stringify(videoSlides));
  console.log(DECK, videoSlides.length, 'clips');
})();
