// Export a character model sheet (headshot / front / side / back) + expression row as PNG,
// usable as a reference image in image-generation libraries (e.g. handraw-style 角色庫 CH-xxx).
//   node tools/character-sheet.mjs -o stickman-sheet.png [--accessory cap] [--color red] [--expressions]
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFigure, drawStrokes, PALETTE, S } from '../engine/stickman.js';
const here = path.dirname(fileURLToPath(import.meta.url));
GlobalFonts.registerFromPath(path.join(here, '../assets/fonts/jf-openhuninn-2.1.ttf'), 'Huninn');
const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const acc = opt('--accessory') ? { type: opt('--accessory'), color: opt('--color', 'red') } : undefined;
const withExpr = args.includes('--expressions');
const W = 1024, H = withExpr ? 900 : 768, oy = withExpr ? -150 : 0, ground = 640 + oy;
const c = createCanvas(W, H), ctx = c.getContext('2d');
ctx.fillStyle = '#FBF5E8'; ctx.fillRect(0, 0, W, H);
const draw = (pose, face, o) => { const f = buildFigure(pose, face, { time: 1.5, accessory: acc, paper: '#FBF5E8', ...o }); drawStrokes(ctx, f.strokes, { width: 4.2 * o.scale / 1.6, jitter: .7, seed: 7, scale: o.scale }); };
const label = (t, x, y) => { ctx.fillStyle = PALETTE.ink; ctx.font = '22px Huninn'; ctx.textAlign = 'center'; ctx.fillText(t, x, y); };
const front = { lean: 0, head: 0, armL: [-16, 6], armR: [16, 6], legL: [-7, 0], legR: [7, 0] };
const side = { lean: 0, head: 0, armL: [-4, 8], armR: [4, 8], legL: [-2, 0], legR: [2, 0] };
// headshot: big head, clipped to shoulders
ctx.save(); ctx.beginPath(); ctx.rect(30, 200 + oy, 230, 286); ctx.clip();
draw(front, 'happy', { x: 145, y: 1010 + oy, scale: 3.6, dir: 1, view: 0 }); ctx.restore();
label('HEADSHOT', 145, 560 + oy);
draw(front, 'neutral', { x: 410, y: ground, scale: 1.6, dir: 1, view: 0 }); label('FRONT VIEW', 410, ground + 50);
draw(side, 'neutral', { x: 640, y: ground, scale: 1.6, dir: 1, view: .62 }); label('SIDE VIEW', 640, ground + 50);
draw(front, 'neutral', { x: 870, y: ground, scale: 1.6, dir: -1, view: 0, noFace: true }); label('BACK VIEW', 870, ground + 50);
if (withExpr) {
  ['happy', 'laugh', 'surprised', 'sad', 'angry', 'think'].forEach((e, i) => {
    const x = 105 + i * 163; ctx.save(); ctx.beginPath(); ctx.rect(x - 75, 640, 150, 180); ctx.clip();
    draw(front, e, { x, y: 1220, scale: 2.6, dir: 1, view: .12 }); ctx.restore(); label(e.toUpperCase(), x, 855);
  });
}
const out = opt('-o', 'character-sheet.png'); fs.writeFileSync(out, c.toBuffer('image/png')); console.log('wrote', out);
