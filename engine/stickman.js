// stickman.js — pure-code, line-art stickman animation engine.
// Zero dependencies. Works with any CanvasRenderingContext2D (browser or @napi-rs/canvas).
// Everything (characters, props, text underline, arrows) is drawn as jittered polylines,
// so the whole film shares one hand-drawn line language and can be "drawn on" stroke by stroke.

/* ============================================================ math */
export const DEG = Math.PI / 180;
export const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const EASE = {
  linear: t => t,
  in: t => t * t,
  out: t => 1 - (1 - t) * (1 - t),
  inOut: t => (t < .5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  back: t => { const c = 1.70158; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; },
  elastic: t => (t === 0 || t === 1 ? t : 2 ** (-10 * t) * Math.sin((t * 10 - .75) * (2 * Math.PI / 3)) + 1),
  bounce: t => { const n = 7.5625, d = 2.75;
    if (t < 1 / d) return n * t * t; if (t < 2 / d) return n * (t -= 1.5 / d) * t + .75;
    if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + .9375; return n * (t -= 2.625 / d) * t + .984375; },
  step: t => (t < 1 ? 0 : 1),
};
const ease = (name, t) => (EASE[name] || EASE.inOut)(clamp(t));
function rnd(seed) { // deterministic 0..1
  let t = (seed + 0x6D2B79F5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const strSeed = s => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
const progress = (t, at, dur) => (dur <= 0 ? (t >= at ? 1 : 0) : clamp((t - at) / dur));

/* ============================================================ palette */
export const PALETTE = {
  ink: '#1E1C1A', paper: '#FDFDFC', gray: '#8A857E', light: '#CFCAC2',
  red: '#E0453A', blue: '#2F6FD6', yellow: '#F2B33D', green: '#3BA55C', orange: '#F07F2E', purple: '#7B5BD6', pink: '#EC6FA0',
};
const col = c => (c && PALETTE[c]) || c || PALETTE.ink;

/* ============================================================ polyline primitives
   A "stroke" = { pts:[[x,y],...], w?, color?, fill?, closed?, dot? }.  */
export const S = {
  line: (x1, y1, x2, y2, o = {}) => ({ pts: [[x1, y1], [x2, y2]], ...o }),
  poly: (pts, o = {}) => ({ pts: pts.map(p => [...p]), ...o }),
  circle: (cx, cy, r, o = {}) => S.arc(cx, cy, r, r, 0, Math.PI * 2, { closed: true, ...o }),
  ellipse: (cx, cy, rx, ry, o = {}) => S.arc(cx, cy, rx, ry, 0, Math.PI * 2, { closed: true, ...o }),
  arc: (cx, cy, rx, ry, a0, a1, o = {}) => {
    const n = Math.max(8, Math.ceil(Math.abs(a1 - a0) * Math.max(rx, ry) / 6));
    const pts = []; for (let i = 0; i <= n; i++) { const a = lerp(a0, a1, i / n); pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]); }
    return { pts, ...o };
  },
  rect: (x, y, w, h, o = {}) => ({ pts: [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]], closed: true, ...o }),
  rrect: (x, y, w, h, r, o = {}) => {
    r = Math.min(r, w / 2, h / 2); const pts = [];
    const corner = (cx, cy, a0) => { for (let i = 0; i <= 6; i++) { const a = a0 + i / 6 * Math.PI / 2; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } };
    corner(x + w - r, y + r, -Math.PI / 2); corner(x + w - r, y + h - r, 0); corner(x + r, y + h - r, Math.PI / 2); corner(x + r, y + r, Math.PI);
    pts.push([...pts[0]]); return { pts, closed: true, ...o };
  },
  bez: (p0, p1, p2, p3, o = {}) => {
    const pts = []; const n = 20;
    for (let i = 0; i <= n; i++) { const t = i / n, u = 1 - t;
      pts.push([u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
        u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]); }
    return { pts, ...o };
  },
  quad: (p0, p1, p2, o = {}) => {
    const pts = []; const n = 16;
    for (let i = 0; i <= n; i++) { const t = i / n, u = 1 - t; pts.push([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]); }
    return { pts, ...o };
  },
  dot: (x, y, r = 3, o = {}) => ({ pts: [[x, y]], dot: r, ...o }),
};

// minimal SVG path parser (M L H V C S Q T A Z, abs+rel) -> strokes. Lets an agent draw any custom line art.
export function svgPath(d, o = {}) {
  const toks = String(d).match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) || [];
  const strokes = []; let cur = null, x = 0, y = 0, sx = 0, sy = 0, cmd = '', lc = null, i = 0;
  const num = () => parseFloat(toks[i++]);
  const start = () => { cur = { pts: [[x, y]], ...o }; strokes.push(cur); };
  const push = (px, py) => { if (!cur) start(); cur.pts.push([px, py]); x = px; y = py; };
  while (i < toks.length) {
    if (/[a-zA-Z]/.test(toks[i])) cmd = toks[i++];
    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase(), ox = rel ? x : 0, oy = rel ? y : 0;
    if (C === 'M') { x = ox + num(); y = oy + num(); sx = x; sy = y; start(); cmd = rel ? 'l' : 'L'; lc = null; }
    else if (C === 'L') { push(ox + num(), oy + num()); lc = null; }
    else if (C === 'H') { push(ox + num(), y); lc = null; } // note: rel H uses ox
    else if (C === 'V') { push(x, (rel ? y : 0) + num()); lc = null; }
    else if (C === 'C' || C === 'S' || C === 'Q' || C === 'T') {
      let c1, c2, e;
      if (C === 'C') { c1 = [ox + num(), oy + num()]; c2 = [ox + num(), oy + num()]; e = [ox + num(), oy + num()]; }
      else if (C === 'S') { c1 = lc ? [2 * x - lc[0], 2 * y - lc[1]] : [x, y]; c2 = [ox + num(), oy + num()]; e = [ox + num(), oy + num()]; }
      else if (C === 'Q') { const q = [ox + num(), oy + num()]; e = [ox + num(), oy + num()]; c1 = [x + 2 / 3 * (q[0] - x), y + 2 / 3 * (q[1] - y)]; c2 = [e[0] + 2 / 3 * (q[0] - e[0]), e[1] + 2 / 3 * (q[1] - e[1])]; }
      else { const q = lc ? [2 * x - lc[0], 2 * y - lc[1]] : [x, y]; e = [ox + num(), oy + num()]; c1 = [x + 2 / 3 * (q[0] - x), y + 2 / 3 * (q[1] - y)]; c2 = [e[0] + 2 / 3 * (q[0] - e[0]), e[1] + 2 / 3 * (q[1] - e[1])]; }
      const b = S.bez([x, y], c1, c2, e); b.pts.slice(1).forEach(p => push(p[0], p[1])); lc = c2;
    } else if (C === 'A') { // approximate arc by straight sampling of endpoints with bulge
      const rx = num(), ry = num(); num(); num(); const sw = num(); const ex = ox + num(), ey = oy + num();
      const mx = (x + ex) / 2, my = (y + ey) / 2, dx = ex - x, dy = ey - y, L = Math.hypot(dx, dy) || 1;
      const h = Math.min(Math.max(rx, ry), L / 2) * (sw ? 1 : -1);
      const q = [mx - dy / L * h, my + dx / L * h]; const b = S.quad([x, y], q, [ex, ey]); b.pts.slice(1).forEach(p => push(p[0], p[1])); lc = null;
    } else if (C === 'Z') { push(sx, sy); if (cur) cur.closed = true; cur = null; lc = null; }
    else i++;
  }
  return strokes;
}

/* ============================================================ stroke rendering */
function resample(pts, step) {
  if (pts.length < 2) return pts;
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i]; const L = Math.hypot(bx - ax, by - ay); const n = Math.max(1, Math.ceil(L / step));
    for (let k = 1; k <= n; k++) out.push([lerp(ax, bx, k / n), lerp(ay, by, k / n)]);
  }
  return out;
}
function jitterPts(pts, amp, seed) {
  if (!amp) return pts;
  // low-frequency wobble: random values at every 3rd point, interpolated
  const n = pts.length, key = i => (rnd(seed + i * 977) * 2 - 1) * amp;
  return pts.map((p, i) => { const k = Math.floor(i / 3), f = (i % 3) / 3;
    const jx = lerp(key(k * 2), key(k * 2 + 2), f), jy = lerp(key(k * 2 + 1), key(k * 2 + 3), f);
    return [p[0] + jx, p[1] + jy]; });
}
const lenOf = pts => { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return L; };
function cut(pts, frac) {
  if (frac >= 1) return pts; if (frac <= 0) return [];
  const total = lenOf(pts) * frac; let acc = 0; const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (acc + d >= total) { const f = (total - acc) / (d || 1); out.push([lerp(pts[i - 1][0], pts[i][0], f), lerp(pts[i - 1][1], pts[i][1], f)]); return out; }
    acc += d; out.push(pts[i]); }
  return out;
}
function tracePath(ctx, pts) {
  ctx.moveTo(pts[0][0], pts[0][1]);
  if (pts.length < 3) { for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); return; }
  for (let i = 1; i < pts.length - 1; i++) { const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2; ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my); }
  const l = pts[pts.length - 1]; ctx.lineTo(l[0], l[1]);
}
/** Draw strokes with a 0..1 "draw-on" reveal over the whole list (in order). */
export function drawStrokes(ctx, strokes, { reveal = 1, width = 4, color = PALETTE.ink, jitter = 1.2, seed = 1, scale = 1, alpha = 1 } = {}) {
  const prepared = strokes.map((s, i) => {
    const step = 7 / Math.max(.3, scale);
    const pts = s.dot ? s.pts : jitterPts(resample(s.pts, step), (s.jitter ?? jitter) / Math.max(.3, scale), seed + i * 131);
    return { s, pts, L: s.dot ? 1 : lenOf(pts) };
  });
  const total = prepared.reduce((a, p) => a + p.L, 0) || 1; let budget = reveal * total;
  ctx.save(); ctx.globalAlpha *= alpha; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const { s, pts, L } of prepared) {
    if (budget <= 0 && reveal < 1) break; const frac = reveal >= 1 ? 1 : clamp(budget / L); budget -= L;
    const c = col(s.color || color);
    if (s.dot) { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(pts[0][0], pts[0][1], s.dot * frac, 0, Math.PI * 2); ctx.fill(); continue; }
    if (s.fill && frac >= 1) { // marker-style fill, slightly offset like hand colouring
      ctx.save(); ctx.globalAlpha *= s.fillAlpha ?? .9; ctx.fillStyle = col(s.fill); ctx.beginPath();
      const off = (s.fillOffset ?? 2.5) / Math.max(.3, scale); tracePath(ctx, pts.map(p => [p[0] + off, p[1] + off])); ctx.closePath(); ctx.fill(); ctx.restore();
    }
    if (s.w === 0) continue;
    const p = cut(pts, frac); if (p.length < 2) continue;
    ctx.strokeStyle = c; ctx.lineWidth = (s.w ?? width) / (s.absWidth ? 1 : 1); ctx.beginPath(); tracePath(ctx, p); ctx.stroke();
  }
  ctx.restore();
}

/* ============================================================ the rig */
// Proportions in px at scale 1 (≈ 4.7 heads tall, slender B1-like figure).
export const RIG = { headR: 20, neck: 5, torso: 60, upperArm: 34, lowerArm: 33, upperLeg: 45, lowerLeg: 45, foot: 11, hand: 3.6 };

/* Angles in degrees. 0 = pointing straight down; + rotates toward the facing direction (forward).
   arm:[shoulder, elbow]  elbow bend adds forward/upward.     leg:[hip, knee]  knee bends backward.
   lean: torso forward tilt. head: nod (+ down/forward). rot: whole-body rotation around hip.
   lift: px above ground. ground:false + hipY: hip height above ground (sitting). */
export const POSES = {
  stand:    { lean: 0, head: 0, armL: [-14, 8], armR: [14, 8], legL: [-6, 2], legR: [6, 2] },
  relaxed:  { lean: -2, head: -3, armL: [-8, 18], armR: [10, 14], legL: [-4, 0], legR: [9, 4] },
  wave:     { lean: -2, head: -5, armL: [-12, 10], armR: [140, 35], legL: [-6, 2], legR: [6, 2] },
  point:    { lean: 6, head: -2, armL: [-12, 12], armR: [92, 0], legL: [-10, 2], legR: [12, 2] },
  pointUp:  { lean: -4, head: -12, armL: [-12, 12], armR: [160, 5], legL: [-6, 2], legR: [6, 2] },
  present:  { lean: -3, head: -4, armL: [-14, 10], armR: [118, -25], legL: [-8, 2], legR: [8, 2] },
  cheer:    { lean: -4, head: -12, armL: [-138, -22], armR: [138, 22], legL: [-16, 4], legR: [16, 4] },
  think:    { lean: 2, head: 10, armL: [-5, 95], armR: [22, 150], legL: [-5, 2], legR: [7, 2] },
  shrug:    { lean: -2, head: 12, armL: [-38, -105], armR: [38, 105], legL: [-7, 2], legR: [7, 2] },
  facepalm: { lean: 12, head: 22, armL: [-8, 8], armR: [32, 150], legL: [-6, 2], legR: [8, 4] },
  sad:      { lean: 14, head: 28, armL: [-3, 4], armR: [4, 4], legL: [-3, 4], legR: [4, 4] },
  tired:    { lean: 22, head: 32, armL: [8, 0], armR: [16, 0], legL: [-4, 14], legR: [6, 14] },
  surprised:{ lean: -10, head: -8, armL: [-50, -55], armR: [50, 55], legL: [-12, 4], legR: [12, 4] },
  scared:   { lean: -14, head: 6, armL: [40, 135], armR: [52, 145], legL: [-5, 16], legR: [5, 16] },
  angry:    { lean: 10, head: 4, armL: [-34, -28], armR: [34, 28], legL: [-14, 2], legR: [14, 2] },
  hold:     { lean: 0, head: 6, armL: [38, 62], armR: [48, 62], legL: [-6, 2], legR: [6, 2] },
  holdUp:   { lean: -6, head: -16, armL: [150, 20], armR: [165, 10], legL: [-10, 2], legR: [10, 2] },
  type:     { lean: 10, head: 14, armL: [40, 50], armR: [50, 46], legL: [-6, 2], legR: [6, 2] },
  crouch:   { lean: 30, head: -10, armL: [20, 40], armR: [35, 40], legL: [60, 120], legR: [75, 125] },
  run:      { lean: 16, head: -4, armL: [-30, 80], armR: [30, 80], legL: [-20, 30], legR: [25, 20] },
  walk:     { lean: 4, head: 0, armL: [-14, 12], armR: [14, 12], legL: [-14, 4], legR: [14, 4] },
  sit:      { ground: false, hipY: 52, lean: -4, head: 2, armL: [12, 70], armR: [22, 64], legL: [82, 86], legR: [90, 90] },
  sitType:  { ground: false, hipY: 52, lean: 8, head: 12, armL: [48, 50], armR: [58, 46], legL: [82, 86], legR: [90, 90] },
  sitSlump: { ground: false, hipY: 52, lean: -16, head: 24, armL: [-6, 0], armR: [6, 0], legL: [70, 50], legR: [80, 60] },
  lie:      { rot: 90, lean: 0, head: -8, armL: [-20, 10], armR: [20, 10], legL: [-4, 0], legR: [4, 0], ground: true },
  bow:      { lean: 55, head: 10, armL: [-10, 0], armR: [10, 0], legL: [-3, 0], legR: [3, 0] },
  dance1:   { lean: -8, head: -10, armL: [-118, -18], armR: [60, 90], legL: [-25, 0], legR: [20, 40] },
  dance2:   { lean: 8, head: 10, armL: [-60, -90], armR: [118, 18], legL: [-20, 40], legR: [25, 0] },
};

export const FACES = {
  neutral:   { smile: .15, open: 0, brow: 0, raise: 0, eye: 1, arc: 0, asym: 0 },
  happy:     { smile: .85, open: .12, brow: 0, raise: .2, eye: 1, arc: 0, asym: 0 },
  laugh:     { smile: 1, open: .9, brow: .1, raise: .3, eye: 1, arc: 1, asym: 0 },
  sad:       { smile: -.8, open: 0, brow: -.9, raise: .3, eye: .85, arc: 0, asym: 0 },
  cry:       { smile: -1, open: .6, brow: -1, raise: .4, eye: .3, arc: 0, asym: 0, tears: 1 },
  angry:     { smile: -.6, open: .25, brow: 1, raise: 0, eye: .9, arc: 0, asym: 0 },
  surprised: { smile: 0, open: 1, brow: -.2, raise: 1, eye: 1.45, arc: 0, asym: 0 },
  scared:    { smile: -.6, open: .55, brow: -1, raise: .8, eye: 1.45, arc: 0, asym: 0, sweat: 1 },
  think:     { smile: -.15, open: 0, brow: .2, raise: .2, eye: 1, arc: 0, asym: 1, lookY: -1 },
  confused:  { smile: -.3, open: 0, brow: -.3, raise: .4, eye: 1.1, arc: 0, asym: 1, squiggle: 1 },
  sleepy:    { smile: 0, open: 0, brow: -.2, raise: 0, eye: .08, arc: 0, asym: 0 },
  determined:{ smile: .25, open: 0, brow: .8, raise: 0, eye: .9, arc: 0, asym: 0 },
  smug:      { smile: .6, open: 0, brow: .4, raise: 0, eye: .5, arc: 0, asym: .6 },
  worried:   { smile: -.4, open: 0, brow: -.8, raise: .5, eye: 1.1, arc: 0, asym: 0, sweat: 1 },
  wow:       { smile: .7, open: .8, brow: -.1, raise: 1, eye: 1.4, arc: 0, asym: 0 },
};

const mergePose = p => {
  if (typeof p === 'string') return { ...POSES.stand, ...(POSES[p] || {}) };
  if (p && p.base) return { ...POSES.stand, ...(POSES[p.base] || {}), ...p };
  return { ...POSES.stand, ...(p || {}) };
};
const mergeFace = f => (typeof f === 'string' ? { ...FACES.neutral, ...(FACES[f] || {}) } : { ...FACES.neutral, ...(f && f.base ? FACES[f.base] : {}), ...(f || {}) });
function mixObj(a, b, t) { // interpolate numbers & [n,n] arrays; snap the rest at t>=.5
  const o = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const va = a[k] ?? b[k], vb = b[k] ?? a[k];
    if (typeof va === 'number' && typeof vb === 'number') o[k] = lerp(va, vb, t);
    else if (Array.isArray(va) && Array.isArray(vb)) o[k] = va.map((v, i) => lerp(v, vb[i], t));
    else o[k] = t < .5 ? va : vb;
  }
  return o;
}

/** Forward kinematics. Returns joints in figure space (hip at 0,0 before ground shift) */
function solve(P, dir) {
  const R = RIG, v = (a, L) => [Math.sin(a * DEG) * dir * L, Math.cos(a * DEG) * L];
  const add = (p, d) => [p[0] + d[0], p[1] + d[1]];
  const hip = [0, 0];
  const up = [Math.sin(P.lean * DEG) * dir, -Math.cos(P.lean * DEG)];
  const neck = [up[0] * R.torso, up[1] * R.torso];
  const shoulder = [up[0] * R.torso * .9, up[1] * R.torso * .9];
  const ht = P.lean + P.head;
  const headUp = [Math.sin(ht * DEG) * dir, -Math.cos(ht * DEG)];
  const head = add(neck, [headUp[0] * (R.neck + R.headR), headUp[1] * (R.neck + R.headR)]);
  const arm = a => { const e = add(shoulder, v(a[0] + P.lean, R.upperArm)); const h = add(e, v(a[0] + a[1] + P.lean, R.lowerArm)); return [e, h]; };
  const leg = l => { const k = add(hip, v(l[0], R.upperLeg)); const la = l[0] - l[1]; const a = add(k, v(la, R.lowerLeg)); const f = add(a, v(la + 90, R.foot)); return [k, a, f]; };
  const [elbowL, handL] = arm(P.armL), [elbowR, handR] = arm(P.armR);
  const [kneeL, ankleL, toeL] = leg(P.legL), [kneeR, ankleR, toeR] = leg(P.legR);
  return { hip, neck, shoulder, head, headTilt: ht, elbowL, handL, elbowR, handR, kneeL, ankleL, toeL, kneeR, ankleR, toeR };
}
function rotPt(p, a) { const c = Math.cos(a), s = Math.sin(a); return [p[0] * c - p[1] * s, p[0] * s + p[1] * c]; }

/** Build an actor's strokes in world space. Returns { strokes, joints }. */
export function buildFigure(pose, face, o) {
  const { x, y, scale = 1, dir = 1, view = .32, time = 0, blinkSeed = 0, talk = 0, lookX = 0, lookY = 0, accessory } = o;
  const P = mergePose(pose); const F = mergeFace(face);
  let J = solve(P, dir);
  if (P.rot) { const a = P.rot * DEG * dir; for (const k in J) if (Array.isArray(J[k])) J[k] = rotPt(J[k], a); }
  // ground the figure: lowest point of feet (or body if rotated) touches y
  let hipX = x, hipY;
  if (P.ground === false) hipY = y - (P.hipY ?? 50) * scale;
  else {
    const pts = P.rot ? Object.values(J).filter(Array.isArray) : [J.ankleL, J.ankleR, J.toeL, J.toeR];
    const maxY = Math.max(...pts.map(p => p[1])) + (P.rot ? RIG.headR * 0 : 0);
    hipY = y - maxY * scale - (P.rot && Math.abs(P.rot) > 45 ? 4 : 0);
  }
  hipY -= (P.lift || 0) * scale;
  const W = {}; for (const k in J) if (Array.isArray(J[k])) W[k] = [hipX + J[k][0] * scale, hipY + J[k][1] * scale];
  const R = RIG.headR * scale;
  const st = [];
  // order matters for draw-on: head, torso, far limbs, near limbs
  st.push(S.circle(W.head[0], W.head[1], R, { part: 'head' }));
  st.push(S.poly([W.neck, W.hip], { part: 'torso' }));
  st.push(S.poly([W.shoulder, W.elbowL, W.handL], { part: 'armL' }));
  st.push(S.poly([W.hip, W.kneeL, W.ankleL, W.toeL], { part: 'legL' }));
  st.push(S.poly([W.hip, W.kneeR, W.ankleR, W.toeR], { part: 'legR' }));
  st.push(S.poly([W.shoulder, W.elbowR, W.handR], { part: 'armR' }));
  st.push(S.circle(W.handL[0], W.handL[1], RIG.hand * scale, { part: 'hand', fill: o.paper || PALETTE.paper, fillOffset: 0, fillAlpha: 1 }));
  st.push(S.circle(W.handR[0], W.handR[1], RIG.hand * scale, { part: 'hand', fill: o.paper || PALETTE.paper, fillOffset: 0, fillAlpha: 1 }));
  // ---------- face
  const tilt = (J.headTilt + (P.rot || 0)) * DEG * dir * .6;
  const fx = (px, py) => { const r = rotPt([px, py], tilt); return [W.head[0] + r[0] * scale, W.head[1] + r[1] * scale]; };
  const look = view * RIG.headR * dir + lookX * 3, ly = (F.lookY || 0) * 2.5 + lookY * 3;
  const ex = 6.5, ey = -3 + ly;
  // blink every ~3.4s (deterministic)
  const bp = (time + rnd(blinkSeed) * 3.4) % 3.4; const blink = bp < .12 ? .08 : 1;
  const eyeOpen = F.eye * blink;
  for (const side of [-1, 1]) {
    const cx = look + side * ex * (1 - Math.abs(view) * .25) + (side === dir ? 0 : 0), cy = ey;
    if (F.arc > .5) st.push(S.poly([fx(cx - 3, cy + 1.5), fx(cx, cy - 2), fx(cx + 3, cy + 1.5)], { w: 2.2 * scale, part: 'face' }));
    else if (eyeOpen < .25) st.push(S.poly([fx(cx - 3, cy), fx(cx + 3, cy)], { w: 2.2 * scale, part: 'face' }));
    else if (eyeOpen > 1.2) { st.push(S.circle(...fx(cx, cy), 3.6 * scale, { w: 1.6 * scale, part: 'face' })); st.push(S.dot(...fx(cx + dir * .8, cy), 1.6 * scale, { part: 'face' })); }
    else st.push({ ...S.ellipse(...fx(cx, cy), 2.1 * scale, 2.6 * eyeOpen * scale), w: 0, fill: PALETTE.ink, fillOffset: 0, fillAlpha: 1, part: 'face' });
    // brows
    const expressive = Math.abs(F.brow) > .15 || F.raise > .15 || F.asym > .1;
    if (expressive) {
      const asymLift = F.asym * (side === dir ? -3 : 1.5);
      const by = cy - 6 - F.raise * 3 + asymLift; const inner = cx - side * 3.5, outer = cx + side * 3.5;
      const innerY = by + F.brow * 2.6, outerY = by - F.brow * .8;
      st.push(S.poly([fx(inner, innerY), fx(outer, outerY)], { w: 2 * scale, part: 'face' }));
    }
  }
  // mouth
  const mx = look * 1.05, my = 8.5 + ly * .5;
  const flap = talk ? (.25 + .55 * Math.abs(Math.sin(time * 17 + Math.sin(time * 5.3) * 2))) * talk : 0;
  const open = Math.max(F.open, flap);
  const w = 5 + Math.max(0, F.smile) * 1.5;
  if (F.squiggle) st.push(S.poly([fx(mx - 5, my), fx(mx - 2.5, my - 2), fx(mx, my + 1), fx(mx + 2.5, my - 1.5), fx(mx + 5, my)], { w: 2 * scale, part: 'face' }));
  else if (open > .55 && Math.abs(F.smile) < .35) { // round "O" mouth
    st.push({ ...S.ellipse(...fx(mx, my + 2), (3 + open * 1.5) * scale, (3 + open * 4) * scale), w: 2 * scale, part: 'face', fill: PALETTE.ink, fillOffset: 0, fillAlpha: .85 });
  } else if (open > .12) {
    const top = my - 1 - open * 1.5 + Math.max(0, -F.smile) * 1, bot = my + 2 + open * 7 + F.smile * 1.5;
    st.push(S.poly([
      ...S.quad(fx(mx - w, my - F.smile * 1.5), fx(mx, top), fx(mx + w, my - F.smile * 1.5)).pts,
      ...S.quad(fx(mx + w, my - F.smile * 1.5), fx(mx, bot + 1.5 * open), fx(mx - w, my - F.smile * 1.5)).pts], { w: 2 * scale, closed: true, part: 'face', fill: PALETTE.ink, fillOffset: 0, fillAlpha: .85 }));
  } else {
    const side = F.asym * 1.2 * dir;
    st.push(S.quad(fx(mx - w, my - F.smile * 2.5 - side), fx(mx, my + F.smile * 4), fx(mx + w, my - F.smile * 2.5 + side), { w: 2.1 * scale, part: 'face' }));
  }
  if (F.sweat) { const sx = -dir * 15, sy = -12; st.push(S.poly([fx(sx, sy - 5), fx(sx - 2.5, sy + 1), fx(sx, sy + 3), fx(sx + 2.5, sy + 1), fx(sx, sy - 5)], { w: 1.6 * scale, color: 'blue', part: 'face' })); }
  if (F.tears) { for (const s of [-1, 1]) { const tx = look + s * ex, tt = (time * 1.5 + s * .3) % 1; st.push(S.poly([fx(tx, ey + 3), fx(tx + s, ey + 6 + tt * 10)], { w: 1.8 * scale, color: 'blue', part: 'face' })); } }
  if (F.blush) for (const s of [-1, 1]) st.push(S.poly([fx(look + s * 10 - 2, 4), fx(look + s * 10 + 2, 3)], { w: 1.6 * scale, color: 'pink', part: 'face' }));
  // optional accessory (keeps the cast distinguishable with lines only)
  if (accessory) st.push(...accessoryStrokes(accessory, fx, dir, scale));
  return { strokes: o.noFace ? st.filter(x => x.part !== 'face') : st, joints: W, scale };
}
function accessoryStrokes(a, fx, dir, scale) {
  const c = typeof a === 'object' ? a.color : undefined; const k = typeof a === 'object' ? a.type : a;
  const o = { w: 2.6 * scale, color: c || 'ink', part: 'acc' };
  if (k === 'hair') return [S.poly([fx(-19, -6), fx(-16, -16), fx(-8, -21), fx(0, -22), fx(9, -20), fx(16, -15), fx(19, -6)], o), S.poly([fx(-12, -19), fx(-6, -12), fx(2, -17), fx(8, -11), fx(14, -16)], o)];
  if (k === 'ponytail') return [S.poly([fx(-18, -10), fx(-14, -18), fx(0, -22), fx(14, -18), fx(18, -10)], o), S.bez(fx(-dir * 18, -12), fx(-dir * 32, -14), fx(-dir * 34, 4), fx(-dir * 26, 12), o)];
  if (k === 'cap') return [S.poly([fx(-19, -8), fx(-14, -19), fx(0, -23), fx(14, -19), fx(19, -8), fx(-19, -8)], { ...o, fill: c || 'red', fillOffset: 0, fillAlpha: .9 }), S.poly([fx(dir * 8, -8), fx(dir * 32, -6)], { ...o, w: 3.4 * scale })];
  if (k === 'glasses') return [S.circle(...fx(dir * 6 - 6.5, -3), 5 * scale, o), S.circle(...fx(dir * 6 + 6.5, -3), 5 * scale, o), S.poly([fx(dir * 6 - 1.5, -3), fx(dir * 6 + 1.5, -3)], o)];
  if (k === 'tie') return [];
  if (k === 'beanie') return [S.poly([fx(-20, -4), fx(-18, -16), fx(-8, -24), fx(8, -24), fx(18, -16), fx(20, -4), fx(-20, -4)], { ...o, fill: c || 'red', fillOffset: 0, fillAlpha: .95 })];
  return [];
}

/* ============================================================ props / icons (local coords, ~100px unit) */
const icon = {
  bulb: () => [S.arc(0, -10, 26, 26, Math.PI * .78, Math.PI * 2.22), S.poly([[-14, 10], [-12, 24], [12, 24], [14, 10]]), S.line(-11, 30, 11, 30), S.line(-8, 36, 8, 36),
    S.line(-7, 10, -8, 0, { color: 'yellow', w: 2.5 }), S.line(7, 10, 8, 0, { color: 'yellow', w: 2.5 }), svgPath('M-8 0 q2 -8 4 0 q2 -8 4 0 q2 -8 4 0 q2 -8 4 0', { color: 'yellow', w: 3 })[0]],
  heart: () => [S.bez([0, 22], [-38, -2], [-22, -34], [0, -12], { color: 'red', fill: 'red' }), S.bez([0, -12], [22, -34], [38, -2], [0, 22], { color: 'red', fill: 'red' })],
  star: () => { const p = []; for (let i = 0; i <= 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 12 : 28; p.push([Math.cos(a) * r, Math.sin(a) * r]); } return [S.poly(p, { color: 'yellow', fill: 'yellow', closed: true })]; },
  question: () => [S.bez([-14, -18], [-14, -40], [18, -40], [16, -18]), S.bez([16, -18], [14, -6], [0, -6], [0, 8]), S.dot(0, 22, 4)],
  exclaim: () => [S.line(0, -34, 0, 6, { w: 6 }), S.dot(0, 22, 5)],
  check: () => [S.poly([[-24, 0], [-6, 18], [26, -22]], { color: 'green', w: 7 })],
  cross: () => [S.line(-20, -20, 20, 20, { color: 'red', w: 7 }), S.line(20, -20, -20, 20, { color: 'red', w: 7 })],
  clock: (e, t) => { const h = (e.spin ?? 1) * t; return [S.circle(0, 0, 32), S.line(0, 0, Math.sin(h * 0.5) * 16, -Math.cos(h * 0.5) * 16, { w: 4 }), S.line(0, 0, Math.sin(h * 6) * 25, -Math.cos(h * 6) * 25, { color: 'red', w: 3 }), S.dot(0, 0, 3)]; },
  gear: (e, t) => { const a0 = (e.spin ?? 1) * t * 1.5, p = []; for (let i = 0; i <= 48; i++) { const a = a0 + i / 48 * Math.PI * 2, r = (Math.floor(i / 3) % 2) ? 26 : 34; p.push([Math.cos(a) * r, Math.sin(a) * r]); } return [S.poly(p, { closed: true }), S.circle(0, 0, 10)]; },
  coin: () => [S.circle(0, 0, 28, { color: 'yellow', fill: 'yellow', fillAlpha: .5 }), svgPath('M8 -12 C4 -18 -12 -16 -10 -8 C-8 0 10 -2 10 8 C10 16 -6 18 -10 11 M0 -22 L0 22')].flat(),
  phone: () => [S.rrect(-20, -36, 40, 72, 7), S.line(-6, 28, 6, 28), S.rect(-14, -26, 28, 46, { color: 'blue', w: 2 })],
  laptop: () => [S.poly([[-46, 18], [-38, -36], [38, -36], [46, 18]], { closed: true }), S.poly([[-58, 18], [58, 18], [52, 28], [-52, 28], [-58, 18]]), S.rect(-30, -28, 60, 36, { color: 'blue', w: 2 })],
  monitor: () => [S.rrect(-50, -40, 100, 64, 5), S.line(0, 24, 0, 40), S.line(-22, 40, 22, 40)],
  desk: () => [S.line(-90, 0, 90, 0, { w: 5 }), S.line(-80, 0, -80, 62), S.line(80, 0, 80, 62)],
  chair: () => [S.poly([[-22, -60], [-22, 0], [24, 0], [24, 48]]), S.line(-22, 0, -22, 48)],
  door: () => [S.rect(-34, -120, 68, 120), S.dot(22, -60, 4)],
  window: () => [S.rect(-40, -40, 80, 80), S.line(0, -40, 0, 40), S.line(-40, 0, 40, 0)],
  tree: () => [S.line(0, 0, 0, -50, { w: 5 }), ...[[0, -78, 30], [-22, -62, 22], [22, -62, 22]].map(([x, y, r]) => S.circle(x, y, r, { color: 'green' }))],
  house: () => [S.poly([[-50, 0], [-50, -60], [0, -100], [50, -60], [50, 0], [-50, 0]]), S.rect(-12, -36, 24, 36)],
  cloud: () => [svgPath('M-40 10 C-60 10 -60 -18 -38 -18 C-36 -40 -6 -44 2 -26 C10 -40 40 -36 38 -14 C60 -14 58 12 38 10 Z')].flat(),
  sun: (e, t) => [S.circle(0, 0, 22, { color: 'yellow', fill: 'yellow', fillAlpha: .4 }), ...Array.from({ length: 8 }, (_, i) => { const a = i / 8 * Math.PI * 2 + t * .4; return S.line(Math.cos(a) * 30, Math.sin(a) * 30, Math.cos(a) * 42, Math.sin(a) * 42, { color: 'yellow', w: 4 }); })],
  rain: (e, t) => [svgPath('M-40 10 C-60 10 -60 -18 -38 -18 C-36 -40 -6 -44 2 -26 C10 -40 40 -36 38 -14 C60 -14 58 12 38 10 Z'), ...Array.from({ length: 5 }, (_, i) => { const yy = 20 + ((t * 90 + i * 23) % 40); return S.line(-30 + i * 15, yy, -34 + i * 15, yy + 9, { color: 'blue', w: 2.5 }); })].flat(),
  box: () => [S.poly([[-40, -20], [0, -38], [40, -20], [40, 26], [0, 44], [-40, 26], [-40, -20]]), S.poly([[-40, -20], [0, -2], [40, -20]]), S.line(0, -2, 0, 44)],
  flag: () => [S.line(-20, 40, -20, -44, { w: 4 }), S.poly([[-20, -44], [30, -32], [-20, -18]], { color: 'red', fill: 'red', closed: true })],
  trophy: () => [S.poly([[-24, -36], [24, -36], [18, -4], [0, 6], [-18, -4], [-24, -36]], { color: 'yellow', fill: 'yellow', fillAlpha: .5 }), S.arc(-24, -24, 10, 10, Math.PI * .5, Math.PI * 1.5, { color: 'yellow' }), S.arc(24, -24, 10, 10, -Math.PI * .5, Math.PI * .5, { color: 'yellow' }), S.line(0, 6, 0, 24), S.line(-16, 26, 16, 26, { w: 5 })],
  rocket: () => [svgPath('M0 -50 C18 -30 18 10 12 24 L-12 24 C-18 10 -18 -30 0 -50 Z M-12 10 L-24 28 L-12 24 M12 10 L24 28 L12 24'), [S.circle(0, -14, 7, { color: 'blue' }), S.poly([[-6, 28], [0, 46], [6, 28]], { color: 'orange' })]].flat(),
  doc: () => [S.poly([[-28, -38], [16, -38], [28, -26], [28, 38], [-28, 38], [-28, -38]]), S.line(-16, -18, 16, -18, { w: 2.5 }), S.line(-16, -4, 16, -4, { w: 2.5 }), S.line(-16, 10, 8, 10, { w: 2.5 })],
  bolt: () => [S.poly([[6, -40], [-16, 4], [2, 4], [-6, 40], [18, -8], [0, -8], [6, -40]], { color: 'yellow', fill: 'yellow', closed: true })],
  magnifier: () => [S.circle(-6, -6, 22), S.line(10, 10, 32, 32, { w: 7 })],
  target: () => [S.circle(0, 0, 34, { color: 'red' }), S.circle(0, 0, 20, { color: 'red' }), S.dot(0, 0, 6, { color: 'red' })],
  battery: (e, t) => { const lv = clamp(e.level ?? .5); return [S.rrect(-40, -18, 74, 36, 5), S.rect(34, -8, 8, 16), S.rect(-34, -12, 62 * lv, 24, { color: lv < .3 ? 'red' : 'green', fill: lv < .3 ? 'red' : 'green', w: 0 })]; },
  zzz: (e, t) => [0, 1, 2].map(i => { const s = 8 + i * 4, x = i * 14, y = -i * 16 - (t * 6 % 6); return svgPath(`M${x} ${y} l${s} 0 l${-s} ${s} l${s} 0`, { w: 2.5 })[0]; }),
  ai: () => [S.rrect(-34, -30, 68, 60, 12), S.dot(-12, -4, 5), S.dot(12, -4, 5), S.line(-10, 14, 10, 14), S.line(0, -30, 0, -44), S.circle(0, -48, 4, { color: 'red' }), S.line(-34, 0, -44, 0), S.line(34, 0, 44, 0)],
};

/* ============================================================ elements */
function elementStrokes(e, t) {
  const T = e.type;
  if (icon[T]) return icon[T](e, t);
  if (T === 'line') return [S.poly(e.pts, { closed: e.closed, fill: e.fill, fillAlpha: e.fillAlpha ?? .35 })];
  if (T === 'path') return svgPath(e.d, { fill: e.fill, closed: e.closed, fillAlpha: e.fillAlpha ?? .35 });
  if (T === 'circle') return [S.circle(0, 0, e.r ?? 40, { fill: e.fill, fillAlpha: e.fillAlpha ?? .35 })];
  if (T === 'ellipse') return [S.ellipse(0, 0, e.rx ?? 60, e.ry ?? 30, { fill: e.fill, fillAlpha: e.fillAlpha ?? .35 })];
  if (T === 'rect') return [e.r ? S.rrect(-(e.w ?? 100) / 2, -(e.h ?? 60) / 2, e.w ?? 100, e.h ?? 60, e.r, { fill: e.fill, fillAlpha: e.fillAlpha ?? .35 }) : S.rect(-(e.w ?? 100) / 2, -(e.h ?? 60) / 2, e.w ?? 100, e.h ?? 60, { fill: e.fill, fillAlpha: e.fillAlpha ?? .35 })];
  if (T === 'ground') return [S.line(-(e.w ?? 4000) / 2, 0, (e.w ?? 4000) / 2, 0, { w: e.width ?? 3 })];
  if (T === 'arrow') {
    const [a, b] = [e.from, e.to], bend = e.bend ?? .2; const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, dx = b[0] - a[0], dy = b[1] - a[1];
    const c = [mx - dy * bend, my + dx * bend]; const body = S.quad(a, c, b);
    const ang = Math.atan2(b[1] - c[1], b[0] - c[0]), hs = e.head ?? 16;
    const head = S.poly([[b[0] - Math.cos(ang - .45) * hs, b[1] - Math.sin(ang - .45) * hs], b, [b[0] - Math.cos(ang + .45) * hs, b[1] - Math.sin(ang + .45) * hs]]);
    return [body, head];
  }
  if (T === 'underline') { const w = e.w ?? 200; return [S.bez([-w / 2, 0], [-w / 6, 5], [w / 6, -4], [w / 2, 2], { w: e.width ?? 5 })]; }
  if (T === 'circleMark') { const rx = e.rx ?? 120, ry = e.ry ?? 50; return [S.arc(0, 0, rx, ry, -Math.PI * .6, Math.PI * 1.55, { w: e.width ?? 4 })]; }
  if (T === 'bubble' || T === 'thought') {
    const w = e.w ?? 220, h = e.h ?? 90, tl = e.tail ?? [-w * .25, h * .9];
    if (T === 'thought') { // scalloped cloud
      const n = e.bumps ?? 9, pts = [];
      for (let i = 0; i < n; i++) { const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2, am = (a0 + a1) / 2;
        const p0 = [Math.cos(a0) * w / 2, Math.sin(a0) * h / 2], p1 = [Math.cos(a1) * w / 2, Math.sin(a1) * h / 2];
        const bulge = 1.28; const c = [Math.cos(am) * w / 2 * bulge, Math.sin(am) * h / 2 * bulge];
        pts.push(...S.quad(p0, c, p1).pts); }
      const tx = tl[0], ty = tl[1];
      return [S.poly(pts, { closed: true, fill: e.fill, fillAlpha: e.fillAlpha ?? .3 }), S.circle(tx * .62, ty * .62 + 4, 10), S.circle(tx * .86, ty * .86, 6)];
    }
    const r = 22, x0 = -w / 2, y0 = -h / 2; const box = S.rrect(x0, y0, w, h, r, { fill: e.fill, fillAlpha: e.fillAlpha ?? .3 });
    const bx = clamp(tl[0] * .5, x0 + r, x0 + w - r - 22);
    return [box, S.poly([[bx, h / 2 - 2], tl, [bx + 26, h / 2 - 2]])];
  }
  if (T === 'bars') { // bar chart that grows: values 0..1
    const vals = e.values || [.3, .5, .8], bw = e.barW ?? 34, gap = e.gap ?? 18, H = e.h ?? 160, g = e.grow ?? 1;
    const out = [S.poly([[-10, -H - 10], [-10, 0], [vals.length * (bw + gap) + 10, 0]], { w: 3 })];
    vals.forEach((v, i) => { const x = i * (bw + gap) + gap / 2, hh = H * v * g; const c = (e.colors || [])[i] || (i === vals.length - 1 ? 'red' : 'blue');
      if (hh > 1) out.push(S.rect(x, -hh, bw, hh, { color: c, fill: c, fillAlpha: .35, w: 3 })); });
    return out;
  }
  if (T === 'linechart') {
    const vals = e.values || [.2, .35, .3, .6, .9], W = e.w ?? 260, H = e.h ?? 150;
    const pts = vals.map((v, i) => [i / (vals.length - 1) * W, -v * H]);
    return [S.poly([[0, -H - 10], [0, 0], [W + 10, 0]], { w: 3 }), S.poly(pts, { color: e.lineColor || 'red', w: 5 }), ...pts.map(p => S.dot(p[0], p[1], 4, { color: e.lineColor || 'red' }))];
  }
  if (T === 'burst') { // radial pop lines (animated by 'at')
    const n = e.n ?? 10, r0 = e.r0 ?? 30, r1 = e.r1 ?? 70; return Array.from({ length: n }, (_, i) => { const a = i / n * Math.PI * 2 + (e.seedRot ?? 0); return S.line(Math.cos(a) * r0, Math.sin(a) * r0, Math.cos(a) * r1, Math.sin(a) * r1, { w: e.width ?? 4 }); });
  }
  if (T === 'speed') { const n = e.n ?? 4, L = e.len ?? 60; return Array.from({ length: n }, (_, i) => S.line(0, i * 14 - n * 7, -L + (i % 2) * 18, i * 14 - n * 7, { w: 3 })); }
  if (T === 'sparkle') return [S.line(0, -18, 0, 18, { w: 3 }), S.line(-18, 0, 18, 0, { w: 3 }), S.line(-8, -8, 8, 8, { w: 2 }), S.line(8, -8, -8, 8, { w: 2 })];
  if (T === 'strokes') return e.strokes || [];
  return [];
}

/* ============================================================ keyframes */
function evalKeys(keys, prop, t, fallback) {
  let prev = null, next = null;
  for (const k of keys) { if (k[prop] === undefined) continue; if (k.t <= t) prev = k; else { next = k; break; } }
  if (!prev && !next) return fallback;
  if (!prev) return next[prop]; if (!next) return prev[prop];
  const u = ease(next.ease || 'inOut', (t - prev.t) / (next.t - prev.t || 1));
  const a = prev[prop], b = next[prop];
  if (typeof a === 'number' && typeof b === 'number') return lerp(a, b, u);
  if (Array.isArray(a) && Array.isArray(b)) return a.map((v, i) => lerp(v, b[i], u));
  return u < .5 ? a : b;
}
function evalBlend(keys, prop, t, fallback, merger) { // pose/face: blend merged objects
  let prev = null, next = null;
  for (const k of keys) { if (k[prop] === undefined) continue; if (k.t <= t) prev = k; else { next = k; break; } }
  if (!prev && !next) return merger(fallback);
  if (!prev) return merger(next[prop]); if (!next) return merger(prev[prop]);
  const dur = next.blend ?? Math.min(.45, next.t - prev.t); const start = next.t - dur;
  if (t <= start) return merger(prev[prop]);
  return mixObj(merger(prev[prop]), merger(next[prop]), ease(next.ease || 'inOut', (t - start) / (dur || 1)));
}

/* ============================================================ procedural acts */
function applyActs(actor, P, F, st, t) {
  let talk = 0, lift = 0, dx = 0, dy = 0;
  for (const a of actor.acts || []) {
    if (t < a.from || t > a.to) continue;
    const u = (t - a.from), L = a.to - a.from, env = Math.min(1, u / .15, (a.to - t) / .15), amt = a.amount ?? 1;
    switch (a.type) {
      case 'talk': talk = Math.max(talk, env * amt); break;
      case 'walk': case 'run': {
        const run = a.type === 'run'; const stride = (a.stride ?? (run ? 95 : 70)) * (actor.scale ?? 1);
        const ph = (st.dist / stride) * Math.PI * 2 + (a.phase ?? 0); const sw = (run ? 40 : 24) * env * amt, s = Math.sin(ph), c = Math.cos(ph);
        P.legL = [P.legL[0] * (1 - env) + s * sw, P.legL[1] * (1 - env) + Math.max(0, -c) * (run ? 70 : 32) * env + 4];
        P.legR = [P.legR[0] * (1 - env) - s * sw, P.legR[1] * (1 - env) + Math.max(0, c) * (run ? 70 : 32) * env + 4];
        if (!a.keepArms) { P.armL = [lerp(P.armL[0], -s * sw * 1.1, env), lerp(P.armL[1], run ? 85 : 18, env)]; P.armR = [lerp(P.armR[0], s * sw * 1.1, env), lerp(P.armR[1], run ? 85 : 18, env)]; }
        P.lean += (run ? 14 : 4) * env; lift += Math.abs(Math.sin(ph)) * (run ? 7 : 3) * env; break;
      }
      case 'wave': { const s = Math.sin(u * (a.speed ?? 10)); const arm = a.arm === 'L' ? 'armL' : 'armR'; P[arm] = [lerp(P[arm][0], 145 * (arm === 'armL' ? -1 : 1), env), lerp(P[arm][1], (25 + s * 28) * (arm === 'armL' ? -1 : 1), env)]; break; }
      case 'nod': P.head += Math.sin(u * (a.speed ?? 12)) * 9 * env * amt; break;
      case 'shake': P.head += 0; dx += 0; F.lookX = (F.lookX || 0) + Math.sin(u * (a.speed ?? 16)) * 1.4 * env; P.lean += Math.sin(u * (a.speed ?? 16)) * 1.5 * env; break;
      case 'jump': { const k = clamp(u / L); const crouch = k < .25 ? Math.sin(k / .25 * Math.PI) : 0; const air = k >= .25 ? Math.sin((k - .25) / .75 * Math.PI) : 0;
        lift += air * (a.height ?? 70); P.legL = [P.legL[0] + crouch * 50, P.legL[1] + crouch * 90 + air * 30]; P.legR = [P.legR[0] + crouch * 40, P.legR[1] + crouch * 80 + air * 20]; P.lean += crouch * 20; break; }
      case 'hop': lift += Math.abs(Math.sin(u * (a.speed ?? 9))) * (a.height ?? 16) * env; break;
      case 'type': { const s = Math.sin(u * 22), c2 = Math.sin(u * 19 + 1); P.armL = [P.armL[0] + s * 4 * env, P.armL[1] + s * 6 * env]; P.armR = [P.armR[0] + c2 * 4 * env, P.armR[1] + c2 * 6 * env]; break; }
      case 'tremble': dx += Math.sin(u * 60) * 1.6 * env * amt; dy += Math.cos(u * 47) * .8 * env * amt; break;
      case 'bounce': lift += Math.abs(Math.sin(u * (a.speed ?? 6))) * 6 * env; P.head += Math.sin(u * (a.speed ?? 6) * 2) * 4 * env; break;
      case 'dance': { const k = (Math.sin(u * (a.speed ?? 6)) + 1) / 2; const D = mixObj(mergePose('dance1'), mergePose('dance2'), k); for (const key of ['armL', 'armR', 'legL', 'legR', 'lean', 'head']) P[key] = Array.isArray(P[key]) ? P[key].map((v, i) => lerp(v, D[key][i], env)) : lerp(P[key], D[key], env); lift += Math.abs(Math.sin(u * (a.speed ?? 6) * 2)) * 6 * env; break; }
      case 'scratch': { const arm = 'armR'; P[arm] = [lerp(P[arm][0], 150, env), lerp(P[arm][1], 120 + Math.sin(u * 25) * 12, env)]; break; }
    }
  }
  // idle life: breathing + micro sway, never a frozen figure
  if (actor.idle !== false) { const s = strSeed(actor.id || 'a') % 100; P.lean += Math.sin(t * 1.7 + s) * 1.2; P.head += Math.sin(t * 1.1 + s * 2) * 1.5;
    P.armL = [P.armL[0] - Math.sin(t * 1.7 + s) * 1.5, P.armL[1]]; P.armR = [P.armR[0] + Math.sin(t * 1.7 + s) * 1.5, P.armR[1]]; }
  P.lift = (P.lift || 0) + lift;
  return { talk, dx, dy };
}

/* ============================================================ compile */
export function compile(project) {
  const p = JSON.parse(JSON.stringify(project));
  p.width ??= 1280; p.height ??= 720; p.fps ??= 30; p.bg ??= PALETTE.paper; p.ink ??= PALETTE.ink; p.boil ??= 4; p.jitter ??= 1.1;
  if (p.palette) Object.assign(PALETTE, p.palette);
  let t0 = 0;
  for (const [i, sc] of p.scenes.entries()) {
    sc.start = t0; sc.dur ??= 3; t0 += sc.dur; sc.index = i;
    sc.elements ??= []; sc.actors ??= []; sc.camera ??= []; sc.shake ??= [];
    for (const a of sc.actors) {
      a.keys ??= []; a.acts ??= []; a.keys.unshift({ t: -1e-3, x: a.x ?? p.width / 2, y: a.y ?? p.height * .78, scale: a.scale ?? 1.4, dir: a.dir ?? 1, pose: a.pose ?? 'stand', face: a.face ?? 'neutral' });
      a.keys.sort((m, n) => m.t - n.t);
      // translate walk/run "toX"/"toY" into position keys (linear), and record distance for gait phase
      for (const act of a.acts.slice().sort((m, n) => m.from - n.from)) {
        if (act.toX === undefined && act.toY === undefined) continue;
        const x0 = evalKeys(a.keys, 'x', act.from, a.x), y0 = evalKeys(a.keys, 'y', act.from, a.y);
        a.keys.push({ t: act.from, x: x0, y: y0, ease: 'linear' }, { t: act.to, x: act.toX ?? x0, y: act.toY ?? y0, ease: act.ease || 'linear' });
        if (act.toX !== undefined) a.keys.push({ t: act.from + 1e-3, dir: Math.sign(act.toX - x0) || evalKeys(a.keys, 'dir', act.from, 1) });
        a.keys.sort((m, n) => m.t - n.t);
      }
    }
  }
  p.duration = t0;
  p.captions ??= [];
  for (const sc of p.scenes) for (const c of sc.captions || []) p.captions.push({ ...c, from: c.from + sc.start, to: c.to + sc.start });
  return p;
}

/* ============================================================ render */
function drawPaper(ctx, p, sc) {
  const { width: W, height: H } = p; ctx.fillStyle = col(sc.bg || p.bg); ctx.fillRect(0, 0, W, H);
  if ((sc.grid ?? p.grid) !== false) {
    const g = (sc.gridSize ?? p.gridSize ?? 64) * W / 1280; ctx.strokeStyle = p.gridColor || 'rgba(76,90,105,.045)'; ctx.lineWidth = .8 * W / 1280; ctx.beginPath();
    const limit = p.captions?.length ? H - H * .155 : H;
    for (let x = g; x < W; x += g) { ctx.moveTo(x, 0); ctx.lineTo(x, limit); }
    for (let y = g; y < limit; y += g) { ctx.moveTo(0, y); ctx.lineTo(W, y); } ctx.stroke();
  }
}
function visibility(o, t) { // appear / disappear animation -> {reveal, alpha, s}
  const at = o.at ?? 0, dur = o.dur ?? (o.anim === 'none' ? 0 : .6), anim = o.anim ?? 'draw';
  let reveal = 1, alpha = 1, s = 1;
  if (t < at) return null;
  const u = progress(t, at, dur);
  if (anim === 'draw' || anim === 'type') reveal = ease('out', u);
  else if (anim === 'fade') alpha = u;
  else if (anim === 'pop') { s = EASE.back(u); alpha = clamp(u * 3); }
  else if (anim === 'grow') { reveal = 1; }
  if (o.out !== undefined) { if (t > o.out + (o.outDur ?? .3)) return null; if (t > o.out) { const v = progress(t, o.out, o.outDur ?? .3); if ((o.outAnim ?? 'fade') === 'pop') { s *= 1 - EASE.in(v); } else alpha *= 1 - v; } }
  return { reveal, alpha, s, u };
}
function loopFx(e, t) { const L = e.loop; if (!L) return { dx: 0, dy: 0, r: 0, s: 1 };
  const k = t * (e.loopSpeed ?? 1);
  return { dx: L === 'shake' ? Math.sin(k * 40) * 3 : 0, dy: L === 'bob' || L === 'float' ? Math.sin(k * 3) * 6 : 0, r: L === 'spin' ? k * 2 : L === 'wiggle' ? Math.sin(k * 8) * .12 : 0, s: L === 'pulse' ? 1 + Math.sin(k * 6) * .06 : 1 }; }

function drawText(ctx, e, v, t, p, seed) {
  const size = e.size ?? 64; const font = `${e.weight ?? ''} ${size}px ${e.font || p.font || 'Huninn, "jf open 粉圓", "Noto Sans CJK TC", sans-serif'}`.trim();
  ctx.font = font; ctx.textAlign = e.align ?? 'center'; ctx.textBaseline = 'middle';
  const chars = [...String(e.text)]; let shown = chars.length;
  if ((e.anim ?? 'type') === 'type' || e.anim === 'draw') shown = Math.ceil(chars.length * v.reveal - 1e-6);
  const lines = chars.slice(0, shown).join('').split('\n');
  const lh = size * (e.lineHeight ?? 1.25);
  // boiling text: tiny per-boil rotation & offset
  const j = (rnd(seed) - .5) * .012 * (p.jitter ? 1 : 0);
  ctx.rotate(j);
  lines.forEach((ln, i) => {
    const y = (i - (String(e.text).split('\n').length - 1) / 2) * lh;
    if (e.highlight) { const w = ctx.measureText(ln).width; const hx = ctx.textAlign === 'center' ? -w / 2 : ctx.textAlign === 'right' ? -w : 0; ctx.save(); ctx.globalAlpha *= .35; ctx.fillStyle = col(e.highlight); ctx.fillRect(hx - 6, y - size * .1, w * clamp(v.u * 1.4) + 12, size * .5); ctx.restore(); }
    if (e.stroke) { ctx.lineWidth = e.stroke; ctx.strokeStyle = col(e.strokeColor || p.bg); ctx.lineJoin = 'round'; ctx.strokeText(ln, 0, y); }
    ctx.fillStyle = col(e.color || p.ink); ctx.fillText(ln, 0, y);
  });
  if (e.underline && v.reveal >= 1) {
    const w = Math.max(...String(e.text).split('\n').map(l => ctx.measureText(l).width)); const ux = ctx.textAlign === 'center' ? 0 : ctx.textAlign === 'right' ? -w / 2 : w / 2;
    const ul = progress(t, (e.at ?? 0) + (e.dur ?? .6), .35);
    ctx.save(); ctx.translate(ux, lines.length * lh / 2 + size * .05);
    drawStrokes(ctx, [S.bez([-w / 2, 0], [-w / 6, 5], [w / 6, -4], [w / 2, 2])], { reveal: ul, width: Math.max(3, size / 14), color: col(e.underline === true ? 'red' : e.underline), seed });
    ctx.restore();
  }
}

/** Render one frame of the compiled project at absolute time t. */
export function renderFrame(ctx, p, t) {
  const { width: W, height: H } = p;
  const idx = p.scenes.findIndex(s => t < s.start + s.dur); const i = idx < 0 ? p.scenes.length - 1 : idx;
  const sc = p.scenes[i]; const lt = t - sc.start;
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
  const tr = sc.transition; const prev = p.scenes[i - 1];
  if (tr && prev && lt < (tr.dur ?? .5) && tr.type !== 'cut') {
    const u = ease('inOut', lt / (tr.dur ?? .5));
    renderScene(ctx, p, prev, prev.dur + lt, t);
    ctx.save();
    if (tr.type === 'fade') ctx.globalAlpha = u;
    else { ctx.beginPath(); if (tr.type === 'wipeLeft') ctx.rect(W * (1 - u), 0, W * u, H); else if (tr.type === 'iris') ctx.arc(W / 2, H / 2, Math.hypot(W, H) / 2 * u, 0, Math.PI * 2); else ctx.rect(0, 0, W * u, H); ctx.clip(); }
    renderScene(ctx, p, sc, lt, t); ctx.restore();
    if (tr.type === 'wipe' || tr.type === 'wipeLeft' || tr.type === undefined) { // pencil edge on the wipe
      const x = tr.type === 'wipeLeft' ? W * (1 - u) : W * u; drawStrokes(ctx, [S.line(x, -10, x, H + 10)], { width: 5, seed: Math.floor(t * p.fps / p.boil) });
    }
  } else renderScene(ctx, p, sc, lt, t);
  drawCaptions(ctx, p, t);
  ctx.restore();
}

function renderScene(ctx, p, sc, lt, gt) {
  const { width: W, height: H } = p; const boilSeed = p.boil ? Math.floor(gt * p.fps / p.boil) : 0;
  drawPaper(ctx, p, sc);
  // camera
  const cx = evalKeys(sc.camera, 'x', lt, W / 2), cy = evalKeys(sc.camera, 'y', lt, H / 2), z = evalKeys(sc.camera, 'zoom', lt, 1);
  let sx = 0, sy = 0;
  for (const s of sc.shake) { const d = lt - s.at, D = s.dur ?? .3; if (d >= 0 && d < D) { const e = (1 - d / D) ** 2; sx += Math.sin(d * 97) * (s.mag ?? 12) * e; sy += Math.cos(d * 83) * (s.mag ?? 12) * .6 * e; } }
  ctx.save(); ctx.translate(W / 2 + sx, H / 2 + sy); ctx.scale(z, z); ctx.translate(-cx, -cy);
  // actors first (so elements can attach to joints)
  const joints = {}; const draws = [];
  for (const a of sc.actors) {
    const v = visibility({ at: a.enter?.at ?? 0, dur: a.enter?.dur ?? (a.enter ? .8 : 0), anim: a.enter?.type ?? 'none', out: a.exit?.at, outDur: a.exit?.dur, outAnim: a.exit?.type }, lt);
    if (!v) continue;
    const x = evalKeys(a.keys, 'x', lt), y = evalKeys(a.keys, 'y', lt), scale = evalKeys(a.keys, 'scale', lt, 1.4), dir = evalKeys(a.keys, 'dir', lt, 1) >= 0 ? 1 : -1;
    const P = evalBlend(a.keys, 'pose', lt, 'stand', mergePose); const F = evalBlend(a.keys, 'face', lt, 'neutral', mergeFace);
    // distance travelled (for foot-locked gait)
    let dist = 0; const steps = 24; const t0 = Math.max(0, (a.acts.find(q => (q.type === 'walk' || q.type === 'run') && lt >= q.from && lt <= q.to) || {}).from ?? lt);
    for (let k = 1; k <= steps; k++) { const ta = t0 + (lt - t0) * (k - 1) / steps, tb = t0 + (lt - t0) * k / steps; dist += Math.hypot(evalKeys(a.keys, 'x', tb) - evalKeys(a.keys, 'x', ta), evalKeys(a.keys, 'y', tb) - evalKeys(a.keys, 'y', ta)); }
    const { talk, dx, dy } = applyActs(a, P, F, { dist }, lt);
    const fig = buildFigure(P, F, { x: x + dx, y: y + dy, scale: scale * v.s, dir, time: lt, blinkSeed: strSeed(a.id), talk, view: a.view ?? .32, accessory: a.accessory, paper: p.bg, lookX: F.lookX || 0 });
    joints[a.id] = fig.joints;
    draws.push({ z: a.z ?? 1, fn: () => drawStrokes(ctx, fig.strokes, { reveal: v.reveal, width: (a.width ?? 4) * scale / 1.4 * (p.lineScale ?? 1), color: col(a.color || p.ink), jitter: p.jitter, seed: boilSeed * 7 + strSeed(a.id), scale, alpha: v.alpha }) });
  }
  for (const [n, e] of sc.elements.entries()) {
    const v = visibility(e, lt); if (!v) continue;
    const kx = e.keys ? evalKeys(e.keys, 'x', lt, e.x ?? 0) : e.x ?? 0, ky = e.keys ? evalKeys(e.keys, 'y', lt, e.y ?? 0) : e.y ?? 0;
    const ks = e.keys ? evalKeys(e.keys, 'scale', lt, e.scale ?? 1) : e.scale ?? 1, kr = e.keys ? evalKeys(e.keys, 'rot', lt, e.rot ?? 0) : e.rot ?? 0;
    const ka = e.keys ? evalKeys(e.keys, 'opacity', lt, 1) : 1;
    let X = kx, Y = ky;
    if (e.attach) { const J = joints[e.attach.actor]; if (J) { const jp = J[e.attach.joint || 'handR'] || J.head; X = jp[0] + (e.attach.dx ?? 0); Y = jp[1] + (e.attach.dy ?? 0); } }
    const L = loopFx(e, lt);
    const ee = { ...e }; if (e.type === 'bars') ee.grow = ease('out', progress(lt, e.at ?? 0, e.growDur ?? 1.2));
    if (e.type === 'burst') { const u = progress(lt, e.at ?? 0, e.dur ?? .45); ee.r0 = lerp(e.r0 ?? 20, e.r1 ?? 70, EASE.out(u)); ee.r1 = lerp(e.r0 ?? 20, (e.r1 ?? 70) + 20, EASE.out(clamp(u * 1.6))); v.reveal = 1; v.alpha *= 1 - EASE.in(u); }
    draws.push({ z: e.z ?? (e.attach ? 2 : 0), fn: () => {
      ctx.save(); ctx.translate(X + L.dx, Y + L.dy); ctx.rotate(kr * DEG + L.r); const s = ks * v.s * L.s; ctx.scale(s, s); ctx.globalAlpha *= v.alpha * ka;
      if (e.type === 'text') drawText(ctx, e, v, lt, p, boilSeed + n);
      else {
        drawStrokes(ctx, elementStrokes(ee, lt), { reveal: v.reveal, width: (e.width ?? 4) * (p.lineScale ?? 1), color: col(e.color || p.ink), jitter: p.jitter, seed: boilSeed * 13 + n * 101 + sc.index * 7, scale: s });
        if (e.text && (e.type === 'bubble' || e.type === 'thought' || e.type === 'rect' || e.type === 'circle')) { ctx.globalAlpha *= clamp((v.reveal - .6) / .3); drawText(ctx, { text: e.text, size: e.textSize ?? 30, color: e.textColor, anim: 'none' }, { reveal: 1, u: 1 }, lt, p, boilSeed + n); }
      }
      ctx.restore(); } });
  }
  draws.sort((m, n) => m.z - n.z).forEach(d => d.fn());
  ctx.restore();
}

function drawCaptions(ctx, p, t) {
  const c = p.captions.find(c => t >= c.from && t < c.to); if (!c) return;
  const { width: W, height: H } = p; const band = H * .155;
  ctx.save(); ctx.fillStyle = col(p.captionBg || p.bg); ctx.fillRect(0, H - band, W, band);
  const size = (p.captionSize ?? 34) * Math.min(W, H) / 720; ctx.font = `${size}px ${p.captionFont || p.font || 'Huninn, "jf open 粉圓", "Noto Sans CJK TC", sans-serif'}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const a = Math.min(1, (t - c.from) / .12, (c.to - t) / .12); ctx.globalAlpha = clamp(a);
  ctx.fillStyle = col(p.captionColor || p.ink); ctx.fillText(c.text, W / 2, H - band / 2);
  ctx.restore();
}

export default { compile, renderFrame, POSES, FACES, PALETTE, RIG, S, svgPath, drawStrokes, buildFigure, EASE };
