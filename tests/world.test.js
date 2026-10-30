'use strict';
const test = require('node:test');
const assert = require('node:assert');
const BW = require('../js/world.js');

const world = BW.createWorld(42);
const QUIZ_SECONDS = 8; // time a player typically spends reading + answering each clue

function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

// Autopilot that uses the same keyboard-style inputs as a human (turn / forward / jump).
function runBot(speed, dt = 1 / 60) {
  const p = BW.createPlayer(world);
  let t = 0, jumps = 0, bumps = 0;
  for (let i = 0; i < world.places.length - 1; i++) {
    t += QUIZ_SECONDS;
    const { path } = BW.shortestPath(world, world.places[i].node, world.places[i + 1].node);
    for (let w = 1; w < path.length; w++) {
      const n = world.nodes[path[w]];
      const last = w === path.length - 1;
      const reach = last ? BW.ARRIVE_R - 2 : 5;
      let guard = 0;
      while (Math.hypot(n.x - p.x, n.z - p.z) > reach) {
        if (++guard > 60 * 120) throw new Error(`bot stuck near ${path[w]} at ${p.x.toFixed(1)},${p.z.toFixed(1)}`);
        const want = Math.atan2(n.x - p.x, n.z - p.z);
        const d = angleDiff(p.heading, want);
        const fx = Math.sin(p.heading), fz = Math.cos(p.heading);
        let jump = false;
        for (const o of world.obstacles) {
          const ahead = (o.x - p.x) * fx + (o.z - p.z) * fz;
          const lat = Math.abs((o.x - p.x) * -fz + (o.z - p.z) * fx);
          if (ahead > 0 && ahead < speed * 0.32 + 1.2 && lat < o.half + 1) jump = true;
        }
        const ev = BW.stepPlayer(world, p, {
          left: d < -0.04, right: d > 0.04, up: Math.abs(d) < 0.9, down: false, jump,
        }, dt, speed);
        for (const e of ev) { if (e.type === 'jump') jumps++; if (e.type === 'bump') bumps++; }
        t += dt;
      }
    }
  }
  return { t, jumps, bumps };
}

test('all four places are connected by streets', () => {
  const r = BW.routeLength(world);
  for (const leg of r.legs) assert.ok(Number.isFinite(leg.length) && leg.length > 0);
  console.log('route legs (m):', r.legs.map(l => Math.round(l.length)).join(' + '), '=', Math.round(r.total));
});

test('every place node and the spawn point are walkable', () => {
  for (const pl of world.places) assert.ok(world.isWalkable(world.nodes[pl.node].x, world.nodes[pl.node].z), pl.name);
  const p = BW.createPlayer(world);
  assert.ok(world.isWalkable(p.x, p.z));
});

test('buildings never cover streets', () => {
  for (const b of world.buildings) {
    for (const [x, z] of [[(b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2], [b.x0, b.z0], [b.x1, b.z1]]) {
      assert.ok(!world.inStreet(x, z), `building at ${x},${z}`);
    }
  }
  assert.ok(world.buildings.length > 300, `only ${world.buildings.length} buildings`);
});

test('obstacles exist, span the street and cannot be walked around', () => {
  assert.ok(world.obstacles.length >= 20, `${world.obstacles.length} obstacles`);
  const o = world.obstacles[0];
  const p = { x: o.x - o.dx * 3, z: o.z - o.dz * 3, y: 0, vy: 0, heading: Math.atan2(o.dx, o.dz), onGround: true };
  for (let i = 0; i < 120; i++) BW.stepPlayer(world, p, { up: true }, 1 / 60, 10);
  const along = (p.x - o.x) * o.dx + (p.z - o.z) * o.dz;
  assert.ok(along < 0, 'player passed through obstacle without jumping');
  // …but can jump over it
  BW.stepPlayer(world, p, { jump: true }, 1 / 60, 10);
  for (let i = 0; i < 120; i++) BW.stepPlayer(world, p, { up: true }, 1 / 60, 10);
  const along2 = (p.x - o.x) * o.dx + (p.z - o.z) * o.dz;
  assert.ok(along2 > 1, 'jump did not clear obstacle');
});

test('player cannot leave the streets', () => {
  const p = BW.createPlayer(world);
  p.heading = Math.PI / 2 + 0.4;
  for (let i = 0; i < 60 * 30; i++) {
    BW.stepPlayer(world, p, { up: true, right: i % 200 < 20 }, 1 / 60, 12);
    assert.ok(world.isWalkable(p.x, p.z));
  }
});

test('feasibility per walking speed (5:00 limit)', () => {
  const rows = [];
  for (const s of BW.SPEEDS) {
    const r = runBot(s.mps);
    rows.push({ speed: `${s.label} ${s.mps} m/s`, seconds: Math.round(r.t), margin: Math.round(BW.TIME_LIMIT - r.t), jumps: r.jumps, bumps: r.bumps });
  }
  console.table(rows);
  // Every speed must be beatable; default and faster must leave comfortable slack for a human.
  BW.SPEEDS.forEach((s, i) => {
    assert.ok(rows[i].margin > 20, `${rows[i].speed} infeasible: ${rows[i].margin}s margin`);
    if (s.mps >= BW.SPEEDS.find(x => x.default).mps) assert.ok(rows[i].margin >= 70, `${rows[i].speed} too tight`);
  });
});
