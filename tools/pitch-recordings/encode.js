'use strict';

// Encodes the recorded clips (H.264 MP4 + a PNG poster) into out/, cropped to what matters where a scene says so.
// Usage: node encode.js [scene ...]
const fs = require('node:fs');
const path = require('node:path');
const { ffmpeg, WORK, ROOT } = require('./lib');

const RAW = path.join(WORK, 'raw');
const OUT = path.join(ROOT, 'out');
fs.mkdirSync(OUT, { recursive: true });
const rel = (p) => path.relative(ROOT, p);
// Phone clips stay narrow, back office and chat get a wider frame
const WIDTH = { 'tom-ask': 720, 'tom-offer': 720, 'jonas-yes': 720, 'jonas-ai': 1440 };
// A little faster where nothing is lost: the typing in the chat, the note typed in the dialog
const SPEED = { 'jonas-ai': 1.4, 'jonas-pair': 1.25, 'tom-ask': 1.3, 'jonas-yes': 1.2 };

const names = process.argv.slice(2).length ? process.argv.slice(2) : fs.readdirSync(RAW);
for (const name of names) {
  const dir = path.join(RAW, name);
  const crop = JSON.parse(fs.readFileSync(path.join(dir, 'crop.json'), 'utf8'));
  const width = WIDTH[name] ?? 1600;
  const filters = [];
  if (crop) filters.push(`crop=iw*${crop.w}/${crop.vw}:ih*${crop.h}/${crop.vh}:iw*${crop.x}/${crop.vw}:ih*${crop.y}/${crop.vh}`);
  if (SPEED[name]) filters.push(`setpts=PTS/${SPEED[name]}`);
  filters.push(`scale=${width}:-2:flags=lanczos`, 'fps=30', 'format=yuv420p');
  const video = path.join(OUT, `${name}.mp4`);
  ffmpeg(['-f', 'concat', '-safe', '0', '-i', rel(path.join(dir, 'frames.txt')), '-vf', filters.join(','),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-profile:v', 'high', '-movflags', '+faststart', '-an', rel(video)]);
  ffmpeg(['-i', rel(video), '-vframes', '1', rel(path.join(OUT, `${name}.png`))]);
  console.log(name, `${(fs.statSync(video).size / 1e6).toFixed(1)} MB`);
}
