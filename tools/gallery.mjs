// Generates references/poses.png and references/faces.png — a visual catalogue of the built-in library.
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { POSES, FACES, buildFigure, drawStrokes, S } from '../engine/stickman.js';
const here = path.dirname(fileURLToPath(import.meta.url));
GlobalFonts.registerFromPath(path.join(here, '../assets/fonts/jf-openhuninn-2.1.ttf'), 'Huninn');
const outDir = process.argv[2] || path.join(here, '../references');

function sheet(names, cellW, cellH, cols, draw, file) {
  const rows = Math.ceil(names.length / cols); const c = createCanvas(cols * cellW, rows * cellH); const ctx = c.getContext('2d');
  ctx.fillStyle = '#FDFDFC'; ctx.fillRect(0, 0, c.width, c.height);
  names.forEach((n, i) => { const x = (i % cols) * cellW, y = Math.floor(i / cols) * cellH;
    ctx.strokeStyle = '#eee'; ctx.strokeRect(x, y, cellW, cellH); draw(ctx, n, x, y);
    ctx.fillStyle = '#1E1C1A'; ctx.font = '22px Huninn'; ctx.textAlign = 'center'; ctx.fillText(n, x + cellW / 2, y + cellH - 14); });
  fs.writeFileSync(path.join(outDir, file), c.toBuffer('image/png')); console.log('wrote', file);
}
sheet(Object.keys(POSES), 200, 260, 7, (ctx, n, x, y) => {
  drawStrokes(ctx, [S.line(x + 20, y + 215, x + 180, y + 215)], { width: 2, color: '#bbb', jitter: 0 });
  const f = buildFigure(n, 'neutral', { x: x + 100, y: y + 215, scale: 1, dir: 1 });
  drawStrokes(ctx, f.strokes, { width: 3.5, jitter: .8, seed: 3 });
}, 'poses.png');
sheet(Object.keys(FACES), 160, 170, 8, (ctx, n, x, y) => {
  const f = buildFigure('stand', n, { x: x + 80, y: y + 470, scale: 2.4, dir: 1, view: .15, time: 1 });
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, 160, 135); ctx.clip(); drawStrokes(ctx, f.strokes, { width: 5, jitter: .6, seed: 3, scale: 2.4 }); ctx.restore();
}, 'faces.png');
