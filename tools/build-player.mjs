// Build a single self-contained HTML preview player for a scene (engine + scene inlined).
//   node tools/build-player.mjs examples/ai-workflow.scene.json -o preview.html
// Open the HTML directly (double-click). Space = play/pause, scrub with the slider, "Export WebM" records in-browser.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const scene = args.find(a => a.endsWith('.json'));
const out = args[args.indexOf('-o') + 1] && args.includes('-o') ? args[args.indexOf('-o') + 1] : 'preview.html';
const engine = fs.readFileSync(path.join(here, '../engine/stickman.js'), 'utf8')
  .replace(/^export default .*$/m, '').replace(/^export /gm, '');
const data = fs.readFileSync(scene, 'utf8');
const fontRel = path.relative(path.dirname(path.resolve(out)), path.join(here, '../assets/fonts/jf-openhuninn-2.1.ttf')).split(path.sep).join('/');
const html = `<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><title>Stickman preview</title>
<style>
@font-face{font-family:Huninn;src:url("${fontRel}")}
body{margin:0;background:#2b2a28;color:#eee;font:14px system-ui;display:flex;flex-direction:column;align-items:center;gap:10px;padding:16px}
canvas{max-width:100%;height:auto;box-shadow:0 6px 30px #0008;background:#fff}
.bar{display:flex;gap:10px;align-items:center;width:min(1280px,100%)}input[type=range]{flex:1}
button{background:#f2b33d;border:0;border-radius:6px;padding:6px 12px;font-weight:600;cursor:pointer}
</style>
<canvas id="c"></canvas>
<div class="bar"><button id="pp">▶︎</button><input id="sl" type="range" min="0" step="0.001"><span id="tm">0.00s</span><button id="ex">Export WebM</button></div>
<script>
${engine}
const project = compile(${data});
const c = document.getElementById('c'), ctx = c.getContext('2d');
c.width = project.width; c.height = project.height;
const sl = document.getElementById('sl'), tm = document.getElementById('tm'), pp = document.getElementById('pp');
sl.max = project.duration; let t = 0, playing = false, last = 0;
const draw = () => { renderFrame(ctx, project, t); sl.value = t; tm.textContent = t.toFixed(2) + 's / ' + project.duration.toFixed(1) + 's'; };
const loop = now => { if (playing) { t += (now - last) / 1000; if (t >= project.duration) { t = project.duration - 1e-3; playing = false; pp.textContent = '▶︎'; } } last = now; draw(); requestAnimationFrame(loop); };
pp.onclick = () => { if (t >= project.duration - .01) t = 0; playing = !playing; pp.textContent = playing ? '❚❚' : '▶︎'; };
sl.oninput = () => { t = +sl.value; };
addEventListener('keydown', e => { if (e.code === 'Space') { e.preventDefault(); pp.onclick(); } });
document.getElementById('ex').onclick = () => {
  const rec = new MediaRecorder(c.captureStream(project.fps), { mimeType: 'video/webm' }), chunks = [];
  rec.ondataavailable = e => chunks.push(e.data);
  rec.onstop = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(chunks, { type: 'video/webm' })); a.download = 'stickman.webm'; a.click(); };
  t = 0; playing = true; pp.textContent = '❚❚'; rec.start();
  const chk = setInterval(() => { if (!playing) { clearInterval(chk); rec.stop(); } }, 100);
};
(document.fonts ? document.fonts.load('40px Huninn') : Promise.resolve()).finally(() => requestAnimationFrame(loop));
</script></html>`;
fs.writeFileSync(out, html); console.log('wrote', out);
