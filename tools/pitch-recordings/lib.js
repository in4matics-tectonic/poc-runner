'use strict';

// Helpers for recording the KBC Momentum clips: a browser, a visible pointer, and the DevTools screencast (every frame).
// The pointer, the screencast and ffmpeg come from Plannix's landing-page recordings (tools/landing-recordings there).
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { chromium } = require('playwright-core');

const ROOT = __dirname;
const WORK = process.env.DEMO_WORK || path.join(__dirname, '.work');
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

/** Runs ffmpeg with paths relative to the repository root (from the PATH, or the linuxserver/ffmpeg Docker image). */
function ffmpeg(args) {
  const base = ['-hide_banner', '-loglevel', 'error', '-y', ...args];
  const r = hasFfmpeg
    ? spawnSync('ffmpeg', base, { cwd: ROOT, stdio: 'inherit' })
    : spawnSync(
        'docker',
        ['run', '--rm', '--user', `${process.getuid()}:${process.getgid()}`, '-v', `${ROOT}:/w`, '-w', '/w', '--entrypoint', 'ffmpeg', 'linuxserver/ffmpeg:latest', ...base],
        { stdio: 'inherit' }
      );
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${args.join(' ')}`);
}


function launch() {
  return chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--font-render-hinting=none', '--disable-lcd-text'],
  });
}

// A visible pointer: a soft touch dot for the kiosk and phone, an arrow for the backoffice.
// It glides in the page itself, frame by frame, so a busy page or a slow round trip never makes it jump.
const cursorScript = (kind) => `
(() => {
  if (window.top !== window) return;
  const install = () => {
    // The pointer and its taps live in a full-screen layer over the page.
    const layer = document.createElement('div');
    layer.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;will-change:transform;contain:strict';
    const el = document.createElement('div');
    el.id = '__cursor';
    const touch = ${JSON.stringify(kind)} === 'touch';
    el.style.cssText = 'position:absolute;left:0;top:0;transition:opacity .25s;opacity:0;' +
      (touch ? 'width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;background:rgba(15,23,42,.18);border:2px solid rgba(255,255,255,.9);box-shadow:0 2px 10px rgba(15,23,42,.25)'
             : 'width:22px;height:22px;margin:-2px 0 0 -3px');
    if (!touch) el.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2l15 9-6.6 1.4L8 19z" fill="#0f172a" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    layer.appendChild(el);
    document.documentElement.appendChild(layer);
    // Keep Chrome rendering every frame. While only a video plays (the kiosk camera) it renders more lightly, and
    // switching back when the pointer starts to move costs a quarter of a second of frames: the pointer would jump.
    let beat = false;
    (function heartbeat() {
      beat = !beat;
      layer.style.opacity = beat ? '0.999' : '1';
      requestAnimationFrame(heartbeat);
    })();

    let cx = 0, cy = 0, glide = 0;
    const place = (x, y) => { cx = x; cy = y; el.style.opacity = 1; el.style.transform = 'translate(' + x + 'px,' + y + 'px)'; };
    // The pointer where it is, at a size. (Scale and position go in one transform: a separate 'scale' would also
    // scale the position, and pull the pointer towards the top left corner for a moment.)
    const at = (size) => 'translate(' + cx + 'px,' + cy + 'px) scale(' + size + ')';
    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    // One step per rendered frame (not by the clock): if the browser stalls for a moment, the pointer waits
    // instead of skipping ahead, so it never jumps in the recording.
    window.demoCursorGlide = (fx, fy, x, y, ms) => new Promise((resolve) => {
      const id = ++glide;
      const steps = Math.max(1, Math.round(ms / (1000 / 60)));
      let i = 0;
      const step = () => {
        if (id !== glide) return resolve();
        const e = ease(++i / steps);
        place(fx + (x - fx) * e, fy + (y - fy) * e);
        i < steps ? requestAnimationFrame(step) : resolve();
      };
      requestAnimationFrame(step);
    });
    window.demoCursorHide = () => { el.style.opacity = 0; };
    window.demoCursorTap = () => {
      const r = document.createElement('div');
      r.style.cssText = 'position:absolute;left:' + cx + 'px;top:' + cy + 'px;width:20px;height:20px;margin:-10px 0 0 -10px;border-radius:50%;background:rgba(79,70,229,.35);transition:transform .45s ease-out,opacity .45s ease-out';
      layer.appendChild(r);
      requestAnimationFrame(() => { r.style.transform = 'scale(' + (touch ? 4 : 2.4) + ')'; r.style.opacity = 0; });
      setTimeout(() => r.remove(), 500);
      // The touch dot presses in; the arrow stays put, so its tip doesn't move.
      if (touch) el.animate([{ transform: at(1) }, { transform: at(0.82) }, { transform: at(1) }], { duration: 220 });
    };
  };
  if (document.documentElement) install(); else document.addEventListener('DOMContentLoaded', install);
})();`;


async function newContext(browser, { viewport, scale = 2, cursor = 'touch', mobile = false }) {
  const ctx = await browser.newContext({
    viewport,
    deviceScaleFactor: scale,
    isMobile: mobile,
    hasTouch: mobile || cursor === 'touch',
    locale: 'nl-BE',
    timezoneId: 'Europe/Brussels',
  });
  if (cursor) await ctx.addInitScript(cursorScript(cursor));
  return ctx;
}

/**
 * The visible pointer: glides smoothly to elements, taps them and types into them. With a 'touch' pointer (the kiosk,
 * the phone) a tap is a real touch, so nothing hovers; with an 'arrow' pointer (the backoffice) a mouse moves along.
 */
function pointer(page, kind = 'touch') {
  let pos = { x: page.viewportSize().width * 0.62, y: page.viewportSize().height * 0.9 };
  async function moveTo(x, y, ms = 650) {
    const from = { ...pos };
    pos = { x, y };
    const start = Date.now() / 1000;
    const glide = page.evaluate((a) => window.demoCursorGlide && window.demoCursorGlide(...a), [from.x, from.y, x, y, ms])
      .catch(() => {
        // The page navigated away during the glide: the pointer went with it, nothing left to wait for.
      });
    // A mouse follows the arrow in small steps, so hover effects move along with it. A finger doesn't hover.
    await Promise.all([glide, kind === 'arrow' && page.mouse.move(x, y, { steps: Math.max(4, Math.round(ms / 40)) })]);
    // When the pointer moved, for check.js: frames must keep coming during a movement.
    (page.demoGlides ||= []).push([start, start + ms / 1000]);
  }
  /** Scrolls smoothly until the element is comfortably on screen, also inside a scrolling area (the app's page). */
  async function ensureVisible(el) {
    const box = await el.boundingBox();
    const vh = page.viewportSize().height;
    if (box && box.y >= 70 && box.y + box.height <= vh - 70) return;
    await el.evaluate((n) => n.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    await page.waitForTimeout(900);
  }
  async function point(locator, { dx = 0, dy = 0, ms } = {}) {
    const el = typeof locator === 'string' ? page.locator(locator).first() : locator;
    await el.waitFor({ state: 'visible' });
    await ensureVisible(el);
    const b = await el.boundingBox();
    await moveTo(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy, ms);
    return el;
  }
  async function tap(locator, opts = {}) {
    await point(locator, opts);
    await page.waitForTimeout(opts.pause ?? 140);
    await page.evaluate(() => window.demoCursorTap && window.demoCursorTap());
    if (kind === 'touch') {
      await page.touchscreen.tap(pos.x, pos.y);
      return;
    }
    await page.mouse.down();
    await page.waitForTimeout(70);
    await page.mouse.up();
  }
  /** Shows a tap without touching (for a <select>, whose picker can't be recorded); the value is set separately. */
  async function fakeTap(locator, opts = {}) {
    await point(locator, opts);
    await page.waitForTimeout(opts.pause ?? 140);
    await page.evaluate(() => window.demoCursorTap && window.demoCursorTap());
  }
  async function type(locator, text, { delay = 55 } = {}) {
    await tap(locator);
    const key = async (ch) => {
      await page.keyboard.type(ch);
      await page.waitForTimeout(delay + Math.random() * 40);
    };
    for (const ch of text) {
      // eslint-disable-next-line no-await-in-loop -- typed one key after the other, like a person
      await key(ch);
    }
  }
  /** Drags with the mouse (an 'arrow' pointer) from one point of the page to another ({ x, y }), as on a calendar. */
  async function drag(from, to, ms = 1100) {
    await moveTo(from.x, from.y);
    await page.waitForTimeout(160);
    await page.mouse.down();
    await moveTo(to.x, to.y, ms);
    await page.waitForTimeout(160);
    await page.mouse.up();
  }
  return { moveTo, point, tap, fakeTap, type, drag, hide: () => page.evaluate(() => window.demoCursorHide && window.demoCursorHide()) };
}

/**
 * Records the page with the DevTools screencast (every frame) into `dir`,
 * plus `marks` (named moments in seconds) for the chapters on the landing page.
 */
async function startRecording(page, dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  const writes = [];
  let n = 0;
  cdp.on('Page.screencastFrame', (f) => {
    // Acknowledge first: Chrome sends no new frame before that, and a late one shows as a jump in the video.
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {
      // The recording stopped or the page closed: no more frames to acknowledge.
    });
    const file = path.join(dir, `f${String(n).padStart(5, '0')}.jpg`);
    n += 1;
    frames.push({ file, t: f.metadata.timestamp });
    writes.push(fs.promises.writeFile(file, Buffer.from(f.data, 'base64')));
  });
  // Larger than the encoded videos (for a sharp downscale), small enough for Chrome to keep up at 60 frames a second.
  const vp = page.viewportSize();
  const scale = Math.min(await page.evaluate(() => devicePixelRatio), 1700 / vp.width);
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: Math.round(vp.width * scale), maxHeight: Math.round(vp.height * scale), everyNthFrame: 1 });
  const started = Date.now() / 1000;
  const marks = [];
  return {
    mark(name, value) {
      marks.push({ name, t: Date.now() / 1000 - started, ...(value && { value }) });
    },
    async stop() {
      // Hold the last frame a moment.
      await page.waitForTimeout(400);
      await cdp.send('Page.stopScreencast');
      await new Promise((r) => {
        setTimeout(r, 300);
      });
      await Promise.all(writes);
      // An ffmpeg concat list with each frame's duration (the screencast only sends a frame when something changed).
      const t0 = frames[0].t;
      let list = '';
      for (let i = 0; i < frames.length; i += 1) {
        const next = i + 1 < frames.length ? frames[i + 1].t : frames[i].t + 0.5;
        list += `file '${path.basename(frames[i].file)}'\nduration ${Math.max(0.001, next - frames[i].t).toFixed(4)}\n`;
      }
      list += `file '${path.basename(frames.at(-1).file)}'\n`;
      fs.writeFileSync(path.join(dir, 'frames.txt'), list);
      const offset = frames[0].t - started;
      fs.writeFileSync(path.join(dir, 'marks.json'), JSON.stringify(marks.map((m) => ({ ...m, t: Math.max(0, Number((m.t - offset).toFixed(2))) })), null, 1));
      const glides = (page.demoGlides || [])
        .filter(([a]) => a >= frames[0].t)
        .map(([a, b]) => [Number((a - t0).toFixed(3)), Number((b - t0).toFixed(3))]);
      fs.writeFileSync(path.join(dir, 'glides.json'), JSON.stringify(glides));
      return { frames: frames.length, duration: frames.at(-1).t - t0 + 0.5 };
    },
  };
}

module.exports = { ROOT, WORK, ffmpeg, launch, newContext, pointer, startRecording };
