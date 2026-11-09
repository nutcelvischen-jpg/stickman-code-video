#!/usr/bin/env node
// Render a stickman scene JSON to MP4 (or stills / a contact sheet) — pure code, no image generation.
//   node render.mjs scene.json -o out.mp4
//   node render.mjs scene.json --sheet sheet.png [--frames 12]      contact sheet for review
//   node render.mjs scene.json --still 3.5 -o frame.png                single frame
//   node render.mjs scene.json --from 4 --to 9 -o part.mp4             render a time range
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile, renderFrame } from './engine/stickman.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const file = args.find(a => a.endsWith('.json') || a.endsWith('.mjs'));
if (!file) { console.error('usage: node render.mjs scene.json [-o out.mp4] [--sheet sheet.png] [--still t] [--from s --to s] [--scale 0.5]'); process.exit(1); }

const raw = file.endsWith('.mjs') ? (await import(path.resolve(file))).default : JSON.parse(fs.readFileSync(file, 'utf8'));
const baseDir = path.dirname(path.resolve(file));

// fonts: bundled jf open-huninn (OFL) as "Huninn" + any project fonts
const bundled = path.join(here, 'assets/fonts/jf-openhuninn-2.1.ttf');
if (fs.existsSync(bundled)) GlobalFonts.registerFromPath(bundled, 'Huninn');
for (const f of raw.fonts || []) GlobalFonts.registerFromPath(path.resolve(baseDir, f.path), f.family);

const p = compile(raw);
const k = parseFloat(opt('--scale', '1'));
const W = Math.round(p.width * k), H = Math.round(p.height * k);
const canvas = createCanvas(W, H); const ctx = canvas.getContext('2d');
const frame = t => { ctx.setTransform(k, 0, 0, k, 0, 0); renderFrame(ctx, p, t); };

if (opt('--still')) {
  frame(parseFloat(opt('--still')));
  const out = opt('-o', 'still.png'); fs.writeFileSync(out, await canvas.encode('png')); console.log('wrote', out); process.exit(0);
}

if (opt('--sheet')) {
  const n = parseInt(opt('--frames', '12')), cols = Math.min(4, n), rows = Math.ceil(n / cols), tw = 480, th = Math.round(tw * p.height / p.width);
  const sheet = createCanvas(cols * tw, rows * (th + 26)); const sc = sheet.getContext('2d'); sc.fillStyle = '#fff'; sc.fillRect(0, 0, sheet.width, sheet.height);
  for (let i = 0; i < n; i++) {
    const t = (i + .5) / n * p.duration; frame(t);
    const x = (i % cols) * tw, y = Math.floor(i / cols) * (th + 26);
    sc.drawImage(canvas, x, y, tw, th); sc.fillStyle = '#333'; sc.font = '16px sans-serif'; sc.fillText(`t=${t.toFixed(2)}s`, x + 8, y + th + 18);
  }
  const out = opt('--sheet'); fs.writeFileSync(out, await sheet.encode('png')); console.log('wrote', out); process.exit(0);
}

const from = parseFloat(opt('--from', '0')), to = Math.min(p.duration, parseFloat(opt('--to', String(p.duration))));
const out = opt('-o', 'out.mp4');
const ff = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(p.fps), '-i', '-'];
// audio: narration / sfx / music  [{ src, at, volume }]  (times are absolute seconds)
const audio = (raw.audio || []).filter(a => fs.existsSync(path.resolve(baseDir, a.src)));
for (const a of audio) ff.push('-i', path.resolve(baseDir, a.src));
if (audio.length) {
  const parts = audio.map((a, i) => `[${i + 1}:a]adelay=${Math.max(0, Math.round(((a.at ?? 0) - from) * 1000))}:all=1,volume=${a.volume ?? 1}[a${i}]`);
  ff.push('-filter_complex', parts.join(';') + ';' + audio.map((_, i) => `[a${i}]`).join('') + `amix=inputs=${audio.length}:normalize=0[aout]`, '-map', '0:v', '-map', '[aout]', '-c:a', 'aac', '-b:a', '192k');
}
ff.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-t', String(to - from), '-movflags', '+faststart', out);
const proc = spawn('ffmpeg', ff, { stdio: ['pipe', 'ignore', 'inherit'] });
const total = Math.round((to - from) * p.fps);
for (let f = 0; f < total; f++) {
  frame(from + f / p.fps);
  const buf = Buffer.from(ctx.getImageData(0, 0, W, H).data.buffer);
  if (!proc.stdin.write(buf)) await new Promise(r => proc.stdin.once('drain', r));
  if (f % p.fps === 0) process.stdout.write(`\r${(f / p.fps).toFixed(0)}s / ${(total / p.fps).toFixed(0)}s`);
}
proc.stdin.end();
await new Promise(r => proc.on('close', r));
console.log(`\nwrote ${out} (${(to - from).toFixed(1)}s, ${W}x${H}@${p.fps})`);
