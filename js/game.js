/* Bordeaux Escape — Canvas 2D 3D renderer, HUD, minimap and game loop (no dependencies). */
(() => {
  'use strict';
  const BW = window.BordeauxWorld;
  const world = BW.createWorld(42);
  const $ = (id) => document.getElementById(id);
  const view = $('view'), ctx = view.getContext('2d');
  const mini = $('minimap'), mctx = mini.getContext('2d');
  const TAU = Math.PI * 2;
  const NEAR = 0.6, FAR = 340, FOV = 60 * Math.PI / 180;
  const PENALTY = 15;
  const PLAYER_SCALE = 1.35;
  const LIGHT = norm([0.45, 0.8, -0.5]);

  function norm(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function angleDiff(a, b) { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; }
  function hexToRgb(h) {
    h = h.trim();
    if (h.startsWith('rgb')) { const m = h.match(/[\d.]+/g).map(Number); return [m[0], m[1], m[2]]; }
    h = h.replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgbStr = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

  // ---------------- palette (CSS variables, follows prefers-color-scheme) ----------------
  let PAL = {};
  function readPalette() {
    const cs = getComputedStyle(document.documentElement);
    const g = (n) => cs.getPropertyValue(n).trim();
    PAL = {
      sky0: g('--sky-0'), sky1: g('--sky-1'), ground: g('--ground'), grid: g('--grid'),
      street: g('--street'), streetEdge: g('--street-edge'), plaza: g('--plaza'), river: g('--river'),
      edge: g('--building-edge'), neon: g('--neon'), neon2: g('--neon-2'), neon3: g('--neon-3'), ok: g('--ok'),
      rgb: {
        bld: hexToRgb(g('--building')), stone: hexToRgb(g('--landmark')), fog: hexToRgb(g('--fog')),
        neon: hexToRgb(g('--neon')), neon2: hexToRgb(g('--neon-2')), neon3: hexToRgb(g('--neon-3')),
        white: [235, 250, 255], dark: [10, 20, 30],
      },
    };
    PAL.font = '600 13px ' + getComputedStyle(document.body).fontFamily;
    skyGrad = null;
    buildMinimapBase();
  }
  let skyGrad = null;

  // ---------------- static geometry ----------------
  const faces = [];
  function addFace(pts, base, k, center, opts) {
    const n = pts.length;
    let cx = 0, cy = 0, cz = 0, nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      cx += a[0]; cy += a[1]; cz += a[2];
      nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]);
    }
    cx /= n; cy /= n; cz /= n;
    let nv = norm([nx, ny, nz]);
    if (center && nv[0] * (cx - center[0]) + nv[1] * (cy - center[1]) + nv[2] * (cz - center[2]) < 0) nv = [-nv[0], -nv[1], -nv[2]];
    let rad = 0;
    for (const p of pts) rad = Math.max(rad, Math.hypot(p[0] - cx, p[1] - cy, p[2] - cz));
    const flat = new Float32Array(n * 3);
    pts.forEach((p, i) => { flat[i * 3] = p[0]; flat[i * 3 + 1] = p[1]; flat[i * 3 + 2] = p[2]; });
    const lit = 0.5 + 0.5 * Math.max(0, nv[0] * LIGHT[0] + nv[1] * LIGHT[1] + nv[2] * LIGHT[2]);
    const f = { pts: flat, n: nv, base, k: k * lit, cx, cy, cz, rad, edge: opts && opts.edge, glow: opts && opts.glow, cull: !(opts && opts.noCull) };
    (opts && opts.list || faces).push(f);
    return f;
  }
  function prism(foot, y0, y1, base, k, opts) {
    let cx = 0, cz = 0; for (const p of foot) { cx += p[0]; cz += p[1]; } cx /= foot.length; cz /= foot.length;
    const c = [cx, (y0 + y1) / 2, cz];
    for (let i = 0; i < foot.length; i++) {
      const a = foot[i], b = foot[(i + 1) % foot.length];
      addFace([[a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]]], base, k, c, opts);
    }
    if (!(opts && opts.noTop)) addFace(foot.map(p => [p[0], y1, p[1]]), base, k * 1.08, c, opts);
    if (y0 > 0.01) addFace(foot.map(p => [p[0], y0, p[1]]).reverse(), base, k * 0.7, c, opts);
  }
  const rect = (x0, x1, z0, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
  function box(x0, x1, z0, z1, y0, y1, base, k, opts) { prism(rect(x0, x1, z0, z1), y0, y1, base, k, opts); }
  function ngon(x, z, r, n, rot = 0) { const o = []; for (let i = 0; i < n; i++) { const a = rot + i / n * TAU; o.push([x + Math.cos(a) * r, z + Math.sin(a) * r]); } return o; }
  function pyramid(foot, y0, apexY, base, k, opts) {
    let cx = 0, cz = 0; for (const p of foot) { cx += p[0]; cz += p[1]; } cx /= foot.length; cz /= foot.length;
    const c = [cx, y0 + (apexY - y0) * 0.25, cz];
    for (let i = 0; i < foot.length; i++) {
      const a = foot[i], b = foot[(i + 1) % foot.length];
      addFace([[a[0], y0, a[1]], [b[0], y0, b[1]], [cx, apexY, cz]], base, k, c, opts);
    }
  }
  function hipRoof(x0, x1, z0, z1, y0, y1, base, k, opts) {
    const w = x1 - x0, d = z1 - z0, c = [(x0 + x1) / 2, y0, (z0 + z1) / 2];
    if (w >= d) {
      const r0 = [x0 + d / 2, y1, c[2]], r1 = [x1 - d / 2, y1, c[2]];
      addFace([[x0, y0, z0], [x1, y0, z0], r1, r0], base, k, c, opts);
      addFace([[x1, y0, z1], [x0, y0, z1], r0, r1], base, k, c, opts);
      addFace([[x0, y0, z1], [x0, y0, z0], r0], base, k, c, opts);
      addFace([[x1, y0, z0], [x1, y0, z1], r1], base, k, c, opts);
    } else {
      const r0 = [c[0], y1, z0 + w / 2], r1 = [c[0], y1, z1 - w / 2];
      addFace([[x0, y0, z0], [x0, y0, z1], r1, r0], base, k, c, opts);
      addFace([[x1, y0, z1], [x1, y0, z0], r0, r1], base, k, c, opts);
      addFace([[x0, y0, z0], [x1, y0, z0], r0], base, k, c, opts);
      addFace([[x1, y0, z1], [x0, y0, z1], r1], base, k, c, opts);
    }
  }

  // generic buildings
  for (const b of world.buildings) {
    const k = 0.82 + b.tint * 0.36;
    const roof = b.tint > 0.55 && b.x1 - b.x0 > 14 && b.z1 - b.z0 > 14;
    box(b.x0, b.x1, b.z0, b.z1, 0, b.h, 'bld', k, { edge: true, noTop: roof });
    if (roof) hipRoof(b.x0, b.x1, b.z0, b.z1, b.h, b.h + 4, 'bld', k * 0.8, { edge: true });
  }
  // landmarks
  const LM = { edge: true }, LMR = { edge: true, noTop: true };
  // Porte d'Aquitaine (Place de la Victoire)
  box(-10, -1, -732, -716, 0, 14, 'stone', 1, LM); box(17, 26, -732, -716, 0, 14, 'stone', 1, LM);
  box(-11, 27, -733, -715, 14, 19, 'stone', 1.05, LM); pyramid(rect(-11, 27, -733, -715), 19, 23, 'stone', 0.95, LM);
  // La Grosse Cloche (gate over Rue Saint-James)
  for (const tx of [108, 144]) { prism(ngon(tx, -134, 6, 10), 0, 26, 'stone', 1, LM); pyramid(ngon(tx, -134, 6.6, 10), 26, 38, 'neon2', 0.55, LM); }
  box(110, 142, -140, -128, 12, 24, 'stone', 1.05, LM);
  box(118, 134, -138, -130, 24, 31, 'stone', 1, LM); box(123, 129, -135.5, -132.5, 25, 29, 'neon2', 0.9, { glow: 'neon2' });
  pyramid(rect(117, 135, -139, -129), 31, 39, 'neon2', 0.55, LM);
  // Cathédrale Saint-André + Tour Pey-Berland
  box(-470, -385, 106, 134, 0, 26, 'stone', 1, LMR); hipRoof(-470, -385, 106, 134, 26, 36, 'stone', 0.8, LM);
  box(-440, -424, 96, 106, 0, 24, 'stone', 1.02, LM); box(-440, -424, 134, 144, 0, 24, 'stone', 1.02, LM);
  for (const tz of [109, 131]) { box(-490, -476, tz - 6, tz + 6, 0, 40, 'stone', 1, LM); pyramid(rect(-490, -476, tz - 6, tz + 6), 40, 64, 'stone', 0.9, LM); }
  box(-336, -324, 34, 46, 0, 46, 'stone', 1, LM); pyramid(rect(-336, -324, 34, 46), 46, 62, 'stone', 0.9, LM);
  box(-331, -329, 39, 41, 62, 66, 'neon2', 1, { glow: 'neon2' });
  // Grand Théâtre
  box(-115, -30, 575, 640, 0, 19, 'stone', 1.05, LM); box(-110, -35, 580, 635, 19, 24, 'stone', 0.9, LM);
  for (let i = 0; i < 12; i++) {
    const z = 579 + i * (57 / 11);
    prism(ngon(-120, z, 1.1, 6), 0, 16, 'stone', 1.2, LM);
    box(-120.6, -119.4, z - 0.6, z + 0.6, 19, 21.5, 'neon2', 1, { glow: 'neon2' });
  }
  box(-123, -116, 576, 640, 16, 19, 'stone', 1.1, LM);
  // Place de la Bourse
  for (const [x0, x1, z0, z1] of [[230, 320, 507, 527], [230, 320, 413, 433], [215, 235, 413, 527]]) {
    box(x0, x1, z0, z1, 0, 17, 'stone', 1.05, LMR); hipRoof(x0, x1, z0, z1, 17, 23, 'stone', 0.75, LM);
  }
  prism(ngon(285, 470, 4, 10), 0, 1, 'stone', 1, LM); prism(ngon(285, 470, 1, 6), 1, 6, 'neon2', 0.8, { glow: 'neon2' });
  // Monument aux Girondins
  box(-8, 8, 832, 848, 0, 6, 'stone', 1, LM); prism(ngon(0, 840, 1.8, 8), 6, 40, 'stone', 1.1, LM);
  box(-1, 1, 839, 841, 40, 44, 'neon2', 1, { glow: 'neon2' });

  // obstacles (static, neon)
  for (const o of world.obstacles) {
    const px = -o.dz, pz = o.dx, t = o.thick / 2, h = o.half;
    const corner = (a, l) => [o.x + o.dx * a + px * l, o.z + o.dz * a + pz * l];
    if (o.kind === 'barrier') {
      for (const l of [-h + 0.4, h - 0.4]) {
        prism([corner(-t, l - 0.3), corner(t, l - 0.3), corner(t, l + 0.3), corner(-t, l + 0.3)], 0, o.h, 'neon3', 0.75, { glow: 'neon3', edge: true });
      }
      prism([corner(-t * 0.6, -h), corner(t * 0.6, -h), corner(t * 0.6, h), corner(-t * 0.6, h)], o.h - 0.35, o.h, 'neon3', 1, { glow: 'neon3', edge: true });
    } else {
      const n = 5;
      for (let i = 0; i < n; i++) {
        const l0 = -h + (2 * h / n) * i + 0.08, l1 = l0 + 2 * h / n - 0.16;
        prism([corner(-t, l0), corner(t, l0), corner(t, l1), corner(-t, l1)], 0, o.h - (i % 2) * 0.15, 'neon3', 0.6 + (i % 2) * 0.25, { glow: 'neon3', edge: true });
      }
    }
  }

  // ground layers (drawn first, in order, no sorting)
  const ground = { river: [world.river], streets: [], plazas: [], miroir: [rect(330, 359, 422, 518)] };
  for (const s of world.segs) {
    const px = -s.dz * world.HW, pz = s.dx * world.HW;
    ground.streets.push([[s.ax + px, s.az + pz], [s.bx + px, s.bz + pz], [s.bx - px, s.bz - pz], [s.ax - px, s.az - pz]]);
  }
  for (const k in world.nodes) ground.streets.push(ngon(world.nodes[k].x, world.nodes[k].z, world.HW, 12));
  for (const p of world.plazas) ground.plazas.push(ngon(p.x, p.z, p.r, 32));

  // ---------------- camera & projection ----------------
  let VW = 0, VH = 0, DPR = 1;
  const cam = { x: 0, y: 0, z: 0, r: [1, 0, 0], u: [0, 1, 0], f: [0, 0, 1], F: 1, yaw: 0, dist: 20 };
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 1.75);
    VW = view.clientWidth || window.innerWidth; VH = view.clientHeight || window.innerHeight;
    skyGrad = null;
    view.width = Math.round(VW * DPR); view.height = Math.round(VH * DPR);
    cam.F = (VH / 2) / Math.tan(FOV / 2);
    const md = Math.min(window.devicePixelRatio || 1, 2);
    const r = mini.getBoundingClientRect();
    mini.width = Math.round((r.width || 200) * md); mini.height = Math.round((r.height || 280) * md);
    buildMinimapBase();
  }
  function setupCamera(p, dt) {
    cam.yaw += angleDiff(cam.yaw, p.heading) * Math.min(1, dt * 4.5);
    const sy = Math.sin(cam.yaw), cy = Math.cos(cam.yaw);
    const back = cam.dist, up = cam.dist * 0.55 + 2;
    cam.x = p.x - sy * back; cam.z = p.z - cy * back; cam.y = p.y * 0.5 + up;
    const tx = p.x + sy * 6, ty = p.y * 0.5 + 1.2, tz = p.z + cy * 6;
    const f = norm([tx - cam.x, ty - cam.y, tz - cam.z]);
    const r = norm([f[2], 0, -f[0]]);
    const u = [f[1] * r[2] - f[2] * r[1], f[2] * r[0] - f[0] * r[2], f[0] * r[1] - f[1] * r[0]];
    cam.f = f; cam.r = r; cam.u = u;
  }
  // camera space buffer
  let cbuf = new Float32Array(64 * 3);
  function toCamera(flat) {
    const n = flat.length / 3;
    if (cbuf.length < flat.length) cbuf = new Float32Array(flat.length * 2);
    const { r, u, f } = cam;
    let behind = 0;
    for (let i = 0; i < n; i++) {
      const dx = flat[i * 3] - cam.x, dy = flat[i * 3 + 1] - cam.y, dz = flat[i * 3 + 2] - cam.z;
      const z = dx * f[0] + dy * f[1] + dz * f[2];
      cbuf[i * 3] = dx * r[0] + dy * r[1] + dz * r[2];
      cbuf[i * 3 + 1] = dx * u[0] + dy * u[1] + dz * u[2];
      cbuf[i * 3 + 2] = z;
      if (z < NEAR) behind++;
    }
    return behind === n ? -1 : behind;
  }
  // returns flat screen coords array (x,y,...) after near-plane clipping
  function projectCam(n, clip) {
    const out = [];
    const hw = VW / 2, hh = VH / 2, F = cam.F;
    if (!clip) {
      for (let i = 0; i < n; i++) { const z = cbuf[i * 3 + 2]; out.push(hw + F * cbuf[i * 3] / z, hh - F * cbuf[i * 3 + 1] / z); }
      return out;
    }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = cbuf[i * 3], ay = cbuf[i * 3 + 1], az = cbuf[i * 3 + 2];
      const bx = cbuf[j * 3], by = cbuf[j * 3 + 1], bz = cbuf[j * 3 + 2];
      const ain = az >= NEAR, bin = bz >= NEAR;
      if (ain) out.push(hw + F * ax / az, hh - F * ay / az);
      if (ain !== bin) {
        const t = (NEAR - az) / (bz - az);
        const x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
        out.push(hw + F * x / NEAR, hh - F * y / NEAR);
      }
    }
    return out.length >= 6 ? out : null;
  }
  function projectFlat(flat) { const b = toCamera(flat); if (b < 0) return null; return projectCam(flat.length / 3, b > 0); }
  function projectPoint(x, y, z) {
    const dx = x - cam.x, dy = y - cam.y, dz = z - cam.z;
    const cz = dx * cam.f[0] + dy * cam.f[1] + dz * cam.f[2];
    if (cz < NEAR) return null;
    return [VW / 2 + cam.F * (dx * cam.r[0] + dy * cam.r[1] + dz * cam.r[2]) / cz, VH / 2 - cam.F * (dx * cam.u[0] + dy * cam.u[1] + dz * cam.u[2]) / cz, cz];
  }
  function tracePoly(s) { ctx.beginPath(); ctx.moveTo(s[0], s[1]); for (let i = 2; i < s.length; i += 2) ctx.lineTo(s[i], s[i + 1]); ctx.closePath(); }
  const flatGround = (poly, y = 0) => { const f = new Float32Array(poly.length * 3); poly.forEach((p, i) => { f[i * 3] = p[0]; f[i * 3 + 1] = y; f[i * 3 + 2] = p[1]; }); return f; };
  for (const k in ground) ground[k] = ground[k].map(p => ({ flat: flatGround(p), cx: p.reduce((a, q) => a + q[0], 0) / p.length, cz: p.reduce((a, q) => a + q[1], 0) / p.length, rad: Math.max(...p.map(q => Math.hypot(q[0] - p[0][0], q[1] - p[0][1]))) }));

  // ---------------- game state ----------------
  const SPEEDS = BW.SPEEDS;
  let speed = SPEEDS.find(s => s.default) || SPEEDS[0];
  let state = 'intro', stage = 0, timeLeft = BW.TIME_LIMIT, elapsed = 0, wrongCount = 0;
  let player = BW.createPlayer(world);
  let animT = 0, prevState = 'play', lastBump = 0;
  const keys = {};
  let jumpQueued = false;

  function resetGame() {
    player = BW.createPlayer(world);
    cam.yaw = player.heading;
    stage = 0; timeLeft = BW.TIME_LIMIT; elapsed = 0; wrongCount = 0;
    updateStops();
  }

  // ---------------- rendering ----------------
  const drawList = [];
  function shade(f, depth) {
    const base = PAL.rgb[f.base] || PAL.rgb.bld;
    const fog = clamp((depth - 90) / (FAR - 90), 0, 1);
    const ff = f.glow ? fog * 0.5 : fog * 0.92;
    const k = f.k;
    return [base[0] * k * (1 - ff) + PAL.rgb.fog[0] * ff, base[1] * k * (1 - ff) + PAL.rgb.fog[1] * ff, base[2] * k * (1 - ff) + PAL.rgb.fog[2] * ff, fog];
  }
  // spatial cells so whole blocks of faces are culled with one test
  const CELL = 80, cells = new Map();
  function buildCells() {
    for (const f of faces) {
      const key = Math.floor(f.cx / CELL) + ',' + Math.floor(f.cz / CELL);
      let c = cells.get(key);
      if (!c) { c = { cx: (Math.floor(f.cx / CELL) + 0.5) * CELL, cz: (Math.floor(f.cz / CELL) + 0.5) * CELL, rad: CELL * 0.75, faces: [] }; cells.set(key, c); }
      c.rad = Math.max(c.rad, Math.hypot(f.cx - c.cx, f.cz - c.cz) + f.rad);
      c.faces.push(f);
    }
  }
  function collectCells() {
    for (const c of cells.values()) {
      const dx = c.cx - cam.x, dz = c.cz - cam.z, lim = FAR + c.rad;
      if (dx * dx + dz * dz > lim * lim) continue;
      if (dx * cam.f[0] + dz * cam.f[2] < -c.rad) continue;
      collect(c.faces);
    }
  }
  function collect(list) {
    for (const f of list) {
      const dx = f.cx - cam.x, dz = f.cz - cam.z;
      const d2 = dx * dx + dz * dz, lim = FAR + f.rad;
      if (d2 > lim * lim) continue;
      const depth = dx * cam.f[0] + (f.cy - cam.y) * cam.f[1] + dz * cam.f[2];
      if (depth < -f.rad) continue;
      if (f.cull && f.n[0] * (cam.x - f.cx) + f.n[1] * (cam.y - f.cy) + f.n[2] * (cam.z - f.cz) <= 0) continue;
      const s = projectFlat(f.pts);
      if (!s) continue;
      let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
      for (let i = 0; i < s.length; i += 2) { const x = s[i], y = s[i + 1]; if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; }
      if (maxx < 0 || minx > VW || maxy < 0 || miny > VH) continue;
      drawList.push({ f, s, depth });
    }
  }
  function drawGroundLayer(list, fill, stroke, alpha = 1) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = fill;
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; }
    for (const g of list) {
      const dx = g.cx - cam.x, dz = g.cz - cam.z;
      if (Math.hypot(dx, dz) > FAR + g.rad) continue;
      const s = projectFlat(g.flat);
      if (!s) continue;
      tracePoly(s); ctx.fill(); if (stroke) ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  function drawGrid() {
    const STEP = 25, R = 420;
    const gx = Math.round(cam.x / STEP) * STEP, gz = Math.round(cam.z / STEP) * STEP;
    ctx.strokeStyle = PAL.grid; ctx.lineWidth = 1;
    for (const band of [[0, 160, 0.55], [160, 290, 0.3], [290, R, 0.14]]) {
      ctx.globalAlpha = band[2];
      ctx.beginPath();
      for (let i = -R; i <= R; i += STEP) {
        for (const axis of [0, 1]) {
          for (const sgn of [-1, 1]) {
            const a0 = sgn > 0 ? band[0] : -band[1], a1 = sgn > 0 ? band[1] : -band[0];
            const p0 = axis ? [gx + i, gz + a0] : [gx + a0, gz + i];
            const p1 = axis ? [gx + i, gz + a1] : [gx + a1, gz + i];
            segLine(p0[0], 0, p0[1], p1[0], 0, p1[1]);
          }
        }
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  function segLine(x0, y0, z0, x1, y1, z1) {
    let a = toCam3(x0, y0, z0), b = toCam3(x1, y1, z1);
    if (a[2] < NEAR && b[2] < NEAR) return;
    if (a[2] < NEAR) a = lerp3(a, b, (NEAR - a[2]) / (b[2] - a[2]));
    else if (b[2] < NEAR) b = lerp3(b, a, (NEAR - b[2]) / (a[2] - b[2]));
    ctx.moveTo(VW / 2 + cam.F * a[0] / a[2], VH / 2 - cam.F * a[1] / a[2]);
    ctx.lineTo(VW / 2 + cam.F * b[0] / b[2], VH / 2 - cam.F * b[1] / b[2]);
  }
  function toCam3(x, y, z) {
    const dx = x - cam.x, dy = y - cam.y, dz = z - cam.z;
    return [dx * cam.r[0] + dy * cam.r[1] + dz * cam.r[2], dx * cam.u[0] + dy * cam.u[1] + dz * cam.u[2], dx * cam.f[0] + dy * cam.f[1] + dz * cam.f[2]];
  }
  const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

  function playerFaces() {
    const list = [];
    const p = player, S = PLAYER_SCALE;
    const sh = Math.sin(p.heading), ch = Math.cos(p.heading);
    const local = (a, l) => [p.x + sh * a + ch * l, p.z + ch * a - sh * l];
    const boxL = (a0, a1, l0, l1, y0, y1, base, k, glow) =>
      prism([local(a0 * S, l0 * S), local(a1 * S, l0 * S), local(a1 * S, l1 * S), local(a0 * S, l1 * S)], p.y + y0 * S, p.y + y1 * S, base, k, { list, glow, edge: true });
    const swing = p.moving && p.onGround ? Math.sin(animT * 14) * 0.18 : 0;
    boxL(-0.12 + swing, 0.12 + swing, -0.3, -0.06, 0, 0.75, 'neon', 0.6, 'neon');
    boxL(-0.12 - swing, 0.12 - swing, 0.06, 0.3, 0, 0.75, 'neon', 0.6, 'neon');
    boxL(-0.2, 0.2, -0.36, 0.36, 0.72, 1.4, 'neon', 0.95, 'neon');
    boxL(-0.17, 0.17, -0.17, 0.17, 1.44, 1.8, 'neon', 1.05, 'neon');
    boxL(0.15, 0.2, -0.13, 0.13, 1.56, 1.68, 'white', 1.2, 'neon');
    return list;
  }

  function render(dt) {
    setupCamera(player, dt);
    if (!skyGrad) {
      skyGrad = ctx.createLinearGradient(0, 0, 0, VH);
      skyGrad.addColorStop(0, PAL.sky0); skyGrad.addColorStop(0.55, PAL.sky1); skyGrad.addColorStop(1, PAL.sky1);
    }
    ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, VW, VH);
    // ground plane
    const G = 4000;
    const gp = projectFlat(flatGround([[cam.x - G, cam.z - G], [cam.x + G, cam.z - G], [cam.x + G, cam.z + G], [cam.x - G, cam.z + G]]));
    if (gp) { tracePoly(gp); ctx.fillStyle = PAL.ground; ctx.fill(); }
    drawGrid();
    drawGroundLayer(ground.river, PAL.river, null);
    drawGroundLayer(ground.plazas, PAL.plaza, PAL.streetEdge, 0.95);
    drawGroundLayer(ground.streets, PAL.street, null, 0.95);
    drawGroundLayer(ground.miroir, PAL.neon, PAL.neon, 0.16 + 0.06 * Math.sin(animT * 2));
    drawTargetRing();
    drawShadow();
    // solids
    drawList.length = 0;
    collectCells();
    collect(playerFaces());
    drawList.sort((a, b) => b.depth - a.depth);
    ctx.lineJoin = 'round';
    for (const d of drawList) {
      const c = shade(d.f, d.depth);
      tracePoly(d.s);
      ctx.fillStyle = rgbStr(c);
      if (d.f.glow && d.depth < 70) { ctx.shadowColor = PAL[d.f.glow]; ctx.shadowBlur = 14; ctx.fill(); ctx.shadowBlur = 0; }
      else ctx.fill();
      if (d.f.edge && (d.depth < 160 || d.f.glow || d.f.base === 'stone')) {
        ctx.lineWidth = 1;
        ctx.strokeStyle = d.f.glow ? rgbStr(PAL.rgb[d.f.glow], 0.9 * (1 - c[3])) : d.f.base === 'stone' ? rgbStr(PAL.rgb.neon2, 0.22 * (1 - c[3])) : PAL.edge;
        ctx.stroke();
      }
    }
    drawBeacon();
    drawLabels();
  }

  function currentTarget() { return state !== 'intro' && stage > 0 && stage < world.places.length ? world.places[stage] : null; }
  function drawTargetRing() {
    const t = currentTarget(); if (!t) return;
    const n = world.nodes[t.node];
    const r = BW.ARRIVE_R * (0.92 + 0.08 * Math.sin(animT * 4));
    const s = projectFlat(flatGround(ngon(n.x, n.z, r, 40), 0.05));
    if (!s) return;
    tracePoly(s);
    ctx.fillStyle = rgbStr(PAL.rgb.neon3, 0.12); ctx.fill();
    ctx.strokeStyle = PAL.neon3; ctx.lineWidth = 2; ctx.shadowColor = PAL.neon3; ctx.shadowBlur = 12; ctx.stroke(); ctx.shadowBlur = 0;
  }
  function drawShadow() {
    const s = projectFlat(flatGround(ngon(player.x, player.z, 0.7 * PLAYER_SCALE / (1 + player.y * 0.4), 14), 0.04));
    if (!s) return;
    tracePoly(s); ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fill();
    ctx.strokeStyle = rgbStr(PAL.rgb.neon, 0.35); ctx.lineWidth = 1; ctx.stroke();
  }
  function drawBeacon() {
    const t = currentTarget(); if (!t) return;
    const n = world.nodes[t.node];
    ctx.save();
    ctx.lineCap = 'round';
    ctx.beginPath(); segLine(n.x, 0, n.z, n.x, 110, n.z);
    ctx.strokeStyle = rgbStr(PAL.rgb.neon3, 0.75); ctx.lineWidth = 3; ctx.shadowColor = PAL.neon3; ctx.shadowBlur = 18; ctx.stroke();
    const top = projectPoint(n.x, 110, n.z);
    if (top) {
      const s = clamp(900 / top[2], 6, 14);
      ctx.beginPath(); ctx.moveTo(top[0], top[1] - s); ctx.lineTo(top[0] + s * 0.7, top[1]); ctx.lineTo(top[0], top[1] + s); ctx.lineTo(top[0] - s * 0.7, top[1]); ctx.closePath();
      ctx.fillStyle = PAL.neon3; ctx.fill();
    }
    ctx.restore();
  }
  function drawLabels() {
    ctx.font = PAL.font;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    world.places.forEach((pl, i) => {
      const isTarget = currentTarget() === pl;
      const visited = i < stage || (i === 0 && state !== 'intro');
      if (!isTarget && !visited) return;
      const n = world.nodes[pl.node];
      const p = projectPoint(n.x, isTarget ? 120 : 30, n.z);
      if (!p || p[2] > 900) return;
      const text = (visited && !isTarget ? '✓ ' : '') + pl.name;
      const w = ctx.measureText(text).width + 18;
      ctx.fillStyle = 'rgba(5,8,14,.72)';
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(p[0] - w / 2, p[1] - 24, w, 22, 11) : ctx.rect(p[0] - w / 2, p[1] - 24, w, 22); ctx.fill();
      ctx.fillStyle = isTarget ? PAL.neon3 : PAL.ok;
      ctx.fillText(text, p[0], p[1] - 13);
    });
  }

  // ---------------- minimap ----------------
  let mmBase = null, mmScale = 1;
  const mmB = world.bounds;
  function mmXY(x, z) { return [(x - mmB.x0) * mmScale + mmOff[0], mini.height - ((z - mmB.z0) * mmScale + mmOff[1])]; }
  let mmOff = [0, 0];
  function buildMinimapBase() {
    if (!PAL.rgb || !mini.width) return;
    const W = mini.width, H = mini.height;
    mmScale = Math.min(W / (mmB.x1 - mmB.x0), H / (mmB.z1 - mmB.z0));
    mmOff = [(W - (mmB.x1 - mmB.x0) * mmScale) / 2, (H - (mmB.z1 - mmB.z0) * mmScale) / 2];
    mmBase = document.createElement('canvas'); mmBase.width = W; mmBase.height = H;
    const c = mmBase.getContext('2d');
    c.fillStyle = PAL.ground; c.fillRect(0, 0, W, H);
    c.strokeStyle = rgbStr(hexToRgb(PAL.grid), 0.5); c.lineWidth = 1;
    const gstep = 100 * mmScale;
    for (let x = mmOff[0] % gstep; x < W; x += gstep) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); }
    for (let y = H % gstep; y > 0; y -= gstep) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
    c.fillStyle = PAL.river; c.beginPath();
    world.river.forEach((p, i) => { const q = mmXY(p[0], p[1]); i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]); }); c.fill();
    c.fillStyle = rgbStr(PAL.rgb.bld, 0.9);
    for (const b of world.buildings) { const a = mmXY(b.x0, b.z1), d = mmXY(b.x1, b.z0); c.fillRect(a[0], a[1], d[0] - a[0], d[1] - a[1]); }
    c.fillStyle = rgbStr(PAL.rgb.stone, 1);
    for (const l of world.landmarkRects) { const a = mmXY(l.x0, l.z1), d = mmXY(l.x1, l.z0); c.fillRect(a[0], a[1], d[0] - a[0], d[1] - a[1]); }
    c.strokeStyle = '#8fa3c0'; c.globalAlpha = 0.55; c.lineCap = 'round'; c.lineWidth = Math.max(1.5, world.HW * 2 * mmScale);
    for (const s of world.segs) { const a = mmXY(s.ax, s.az), b = mmXY(s.bx, s.bz); c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke(); }
    c.fillStyle = '#8fa3c0';
    for (const p of world.plazas) { const a = mmXY(p.x, p.z); c.beginPath(); c.arc(a[0], a[1], p.r * mmScale, 0, TAU); c.fill(); }
    c.globalAlpha = 1;
    c.fillStyle = rgbStr(PAL.rgb.neon3, 0.9);
    for (const o of world.obstacles) { const a = mmXY(o.x, o.z); c.fillRect(a[0] - 1, a[1] - 1, 2, 2); }
  }
  function drawMinimap() {
    if (!mmBase) return;
    const W = mini.width, H = mini.height, k = W / 200;
    mctx.drawImage(mmBase, 0, 0);
    world.places.forEach((pl, i) => {
      const n = world.nodes[pl.node], a = mmXY(n.x, n.z);
      if (i < stage || (i === 0 && state !== 'intro')) {
        mctx.fillStyle = PAL.ok; mctx.beginPath(); mctx.arc(a[0], a[1], 4 * k, 0, TAU); mctx.fill();
      } else if (currentTarget() === pl) {
        const r = (6 + 3 * Math.sin(animT * 5)) * k;
        mctx.strokeStyle = PAL.neon3; mctx.lineWidth = 2 * k; mctx.shadowColor = PAL.neon3; mctx.shadowBlur = 10 * k;
        mctx.beginPath(); mctx.arc(a[0], a[1], r, 0, TAU); mctx.stroke(); mctx.shadowBlur = 0;
        mctx.fillStyle = PAL.neon3; mctx.beginPath(); mctx.arc(a[0], a[1], 2.5 * k, 0, TAU); mctx.fill();
      }
    });
    const p = mmXY(player.x, player.z);
    mctx.save(); mctx.translate(p[0], p[1]); mctx.rotate(player.heading);
    mctx.fillStyle = rgbStr(PAL.rgb.neon, 0.14);
    mctx.beginPath(); mctx.moveTo(0, 0); mctx.arc(0, 0, 34 * k, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5); mctx.closePath(); mctx.fill();
    mctx.fillStyle = PAL.neon; mctx.shadowColor = PAL.neon; mctx.shadowBlur = 8 * k;
    mctx.beginPath(); mctx.moveTo(0, -7 * k); mctx.lineTo(5 * k, 6 * k); mctx.lineTo(0, 3 * k); mctx.lineTo(-5 * k, 6 * k); mctx.closePath(); mctx.fill();
    mctx.restore();
    void H;
  }

  // ---------------- HUD ----------------
  const elTimer = $('timer'), elName = $('obj-name'), elDist = $('obj-dist'), elHint = $('hint'), elArrow = $('arrow').firstElementChild;
  function fmt(t) { t = Math.max(0, Math.ceil(t)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; }
  function updateStops() {
    [...$('stops').children].forEach((s, i) => {
      s.className = i + 1 < stage ? 'done' : i + 1 === stage && state !== 'intro' ? 'active' : '';
    });
  }
  let lastHud = '';
  const hudCache = {};
  function setText(el, v) { if (hudCache[el.id] !== v) { hudCache[el.id] = v; el.textContent = v; } }
  function announce(msg) { $('sr-live').textContent = msg; }
  let lastWarn = 999;
  function updateHud() {
    setText(elTimer, fmt(timeLeft));
    const cls = timeLeft < 30 ? 'crit' : timeLeft < 60 ? 'warn' : '';
    if (elTimer.className !== cls) elTimer.className = cls;
    for (const w of [60, 30]) if (lastWarn > w && timeLeft <= w && (state === 'play' || state === 'quiz')) announce(`${w} seconds left`);
    lastWarn = timeLeft;
    const t = currentTarget();
    if (t) {
      const n = world.nodes[t.node];
      const d = Math.hypot(n.x - player.x, n.z - player.z);
      const key = t.id;
      if (key !== lastHud) { elName.textContent = t.name; elHint.textContent = world.places[stage - 1].hint; lastHud = key; }
      setText(elDist, `${Math.round(d / 5) * 5} m · stop ${stage}/4`);
      const rel = angleDiff(player.heading, Math.atan2(n.x - player.x, n.z - player.z));
      const tr = `rotate(${rel.toFixed(2)}rad)`;
      if (hudCache.arrow !== tr) { hudCache.arrow = tr; elArrow.style.transform = tr; }
    } else if (lastHud !== 'none') {
      elName.textContent = 'Solve the first clue'; setText(elDist, 'Place de la Victoire'); elHint.textContent = ''; lastHud = 'none';
    }
  }
  let toastTimer = 0;
  function toast(msg, cls = '') {
    const el = $('toast'); el.textContent = msg; el.className = 'panel show ' + cls;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.className = 'panel ' + cls; }, 1600);
  }

  // ---------------- audio (tiny WebAudio blips) ----------------
  let actx = null;
  function blip(freq, dur = 0.08, type = 'sine', vol = 0.05) {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = type; o.frequency.value = freq; g.gain.value = vol;
      g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
      o.connect(g).connect(actx.destination); o.start(); o.stop(actx.currentTime + dur);
    } catch (e) { /* audio is optional */ }
  }

  // ---------------- overlays ----------------
  function show(id, on) { $(id).classList.toggle('show', on); }
  const route = BW.routeLength(world);
  function buildSpeeds() {
    const wrap = $('speeds'); wrap.innerHTML = '';
    for (const s of SPEEDS) {
      const b = document.createElement('button');
      b.className = 'speed'; b.setAttribute('aria-pressed', String(s === speed));
      b.innerHTML = `<span class="t">${s.label}</span><span class="s">${s.mps} m/s · ${s.note}</span>`;
      b.onclick = () => { speed = s; buildSpeeds(); };
      wrap.appendChild(b);
    }
    $('route-info').textContent = `Shortest route ≈ ${(route.total / 1000).toFixed(1)} km · ~${fmt(route.total / speed.mps)} of pure running`;
  }

  let quizSolved = false;
  function openQuiz(i) {
    state = 'quiz'; quizSolved = false;
    const pl = world.places[i], c = pl.clue;
    $('quiz-stop').textContent = i === 0 ? 'Start · clue 1 of 4' : `Stop ${i} of 4 reached · clue ${i + 1} of 4`;
    $('quiz-title').textContent = pl.name;
    $('quiz-blurb').textContent = pl.blurb;
    $('quiz-q').textContent = c.q;
    const opts = $('quiz-options'); opts.innerHTML = '';
    c.options.forEach((o, k) => {
      const b = document.createElement('button');
      b.innerHTML = `<kbd>${k + 1}</kbd><span></span>`; b.lastChild.textContent = o;
      b.onclick = () => answer(k);
      opts.appendChild(b);
    });
    $('quiz-reveal').classList.remove('show');
    show('quiz', true);
    opts.firstElementChild.focus();
    announce(`${pl.name}. ${c.q}`);
    if (i > 0) blip(660, 0.15, 'triangle'), blip(990, 0.2, 'triangle');
  }
  function answer(k) {
    if (state !== 'quiz' || quizSolved) return;
    const pl = world.places[stage], c = pl.clue;
    const btn = $('quiz-options').children[k];
    if (!btn || btn.disabled) return;
    if (k === c.answer) {
      quizSolved = true; btn.classList.add('right');
      [...$('quiz-options').children].forEach(b => { b.disabled = true; });
      const next = world.places[stage + 1];
      $('quiz-fact').textContent = '✓ ' + c.fact;
      $('quiz-next').textContent = next.name;
      $('quiz-hint').textContent = pl.hint;
      $('quiz-reveal').classList.add('show');
      $('quiz-go').focus();
      blip(880, 0.12, 'triangle'); setTimeout(() => blip(1320, 0.18, 'triangle'), 90);
    } else {
      btn.classList.add('wrong'); btn.disabled = true;
      timeLeft -= PENALTY; wrongCount++;
      toast(`−${PENALTY} s`, 'bad'); blip(160, 0.25, 'sawtooth', 0.04);
    }
  }
  function closeQuiz() {
    if (state !== 'quiz' || !quizSolved) return;
    show('quiz', false);
    stage++; state = 'play';
    updateStops();
    toast(`Go to ${world.places[stage].name}!`, 'ok');
    announce(`Go to ${world.places[stage].name}`);
    document.activeElement && document.activeElement.blur();
  }
  function endGame(won) {
    state = won ? 'won' : 'lost';
    updateStops();
    $('end-label').textContent = won ? 'Escaped!' : 'Time’s up';
    $('end-title').textContent = won ? 'You made it to the Miroir d’eau' : 'The clock beat you';
    $('end-time').textContent = won ? fmt(timeLeft) + ' left' : `${Math.max(0, stage - 1)}/4 stops`;
    $('end-text').textContent = won
      ? `Finished in ${fmt(elapsed)} at ${speed.label.toLowerCase()} pace with ${wrongCount} wrong answer${wrongCount === 1 ? '' : 's'}.${speed.default || speed.mps < 14 ? '' : ' Try a slower pace for a challenge!'}`
      : `Try a faster pace, or take the shortest streets — the minimap (top-right) shows the way.`;
    show('quiz', false); show('end', true);
    $('again-btn').focus();
    if (won) [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => blip(f, 0.2, 'triangle'), i * 120));
    else blip(120, 0.6, 'sawtooth', 0.05);
  }
  function startGame() {
    resetGame();
    show('intro', false); show('end', false); show('pause', false);
    state = 'quiz';
    openQuiz(0);
  }
  function togglePause() {
    if (state === 'play' || state === 'quiz') { prevState = state; state = 'paused'; show('pause', true); $('resume-btn').focus(); }
    else if (state === 'paused') {
      state = prevState; show('pause', false);
      if (state === 'quiz') (quizSolved ? $('quiz-go') : [...$('quiz-options').children].find(b => !b.disabled) || $('quiz-go')).focus();
      else document.activeElement && document.activeElement.blur();
    }
  }
  function toMenu() { state = 'intro'; resetGame(); show('end', false); show('pause', false); show('quiz', false); show('intro', true); buildSpeeds(); }

  $('start-btn').onclick = startGame;
  $('quiz-go').onclick = closeQuiz;
  $('resume-btn').onclick = togglePause;
  $('quit-btn').onclick = startGame;
  $('again-btn').onclick = startGame;
  $('menu-btn').onclick = toMenu;

  // ---------------- input ----------------
  const KEYMAP = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', KeyA: 'left', KeyD: 'right', KeyW: 'up', KeyS: 'down' };
  addEventListener('keydown', (e) => {
    // let focused buttons keep native Enter/Space activation
    if (e.target instanceof HTMLButtonElement && (e.key === 'Enter' || e.code === 'Space')) return;
    const k = KEYMAP[e.code];
    if (state === 'play' && (k || e.code === 'Space')) e.preventDefault();
    if (k) keys[k] = true;
    if (e.code === 'Space' && !e.repeat && state === 'play') jumpQueued = true;
    if (e.repeat) return;
    if (state === 'intro' && e.key === 'Enter') { e.preventDefault(); startGame(); }
    else if (state === 'quiz') {
      if (/^[1-3]$/.test(e.key)) answer(Number(e.key) - 1);
      if (e.key === 'Enter' && quizSolved) { e.preventDefault(); closeQuiz(); }
    } else if ((state === 'won' || state === 'lost') && e.key === 'Enter') { e.preventDefault(); startGame(); }
    if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') togglePause();
    if ((e.key === 'r' || e.key === 'R') && state !== 'intro') startGame();
    if (e.key === '+' || e.key === '=') cam.dist = clamp(cam.dist - 3, 8, 70);
    if (e.key === '-' || e.key === '_') cam.dist = clamp(cam.dist + 3, 8, 70);
  });
  addEventListener('keyup', (e) => { const k = KEYMAP[e.code]; if (k) keys[k] = false; });
  document.addEventListener('visibilitychange', () => { if (document.hidden && (state === 'play' || state === 'quiz')) togglePause(); });
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; if (state === 'play' || state === 'quiz') togglePause(); });
  view.addEventListener('wheel', (e) => { e.preventDefault(); cam.dist = clamp(cam.dist + Math.sign(e.deltaY) * 2, 8, 70); }, { passive: false });
  addEventListener('resize', resize);
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', readPalette);

  // ---------------- main loop ----------------
  let last = performance.now();
  function frame(now) {
    const raw = Math.max(0, (now - last) / 1000); last = now;
    const dt = Math.min(0.05, raw);
    animT += dt;
    if (state === 'play' || state === 'quiz') {
      // the clock uses real elapsed time (capped at 1 s for tab stalls); physics is sub-stepped
      const wall = Math.min(1, raw);
      timeLeft -= wall; elapsed += wall;
      if (timeLeft <= 0) { timeLeft = 0; endGame(false); }
    }
    if (state === 'play') {
      const ev = [], steps = Math.min(6, Math.ceil(Math.min(0.3, raw) / 0.05) || 1), sdt = Math.min(0.3, raw) / steps;
      for (let i = 0; i < steps; i++) ev.push(...BW.stepPlayer(world, player, { left: keys.left, right: keys.right, up: keys.up, down: keys.down, jump: jumpQueued && i === 0 }, sdt, speed.mps));
      jumpQueued = false;
      for (const e of ev) {
        if (e.type === 'jump') blip(520, 0.09, 'square', 0.025);
        if (e.type === 'bump' && animT - lastBump > 1.2) { lastBump = animT; toast('Blocked! Press Space to jump', 'bad'); blip(110, 0.12, 'square', 0.03); }
      }
      const t = currentTarget();
      if (t) {
        const n = world.nodes[t.node];
        if (Math.hypot(n.x - player.x, n.z - player.z) < BW.ARRIVE_R && player.onGround) {
          if (t.final) { stage = world.places.length; endGame(true); } else openQuiz(stage);
        }
      }
    } else if (state === 'intro') {
      player.heading += dt * 0.12; // slow orbit on the title screen
    }
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    render(dt);
    drawMinimap();
    updateHud();
    requestAnimationFrame(frame);
  }

  buildCells();
  readPalette();
  resize();
  resetGame();
  buildSpeeds();
  cam.dist = 20;
  requestAnimationFrame(frame);
  window.__bx = { world, get player() { return player; }, get state() { return state; }, get stage() { return stage; }, get timeLeft() { return timeLeft; } };
})();
