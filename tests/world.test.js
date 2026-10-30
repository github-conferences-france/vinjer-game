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
function runBot(speed, dt = 1 / 60, sprint = false) {
  const p = BW.createPlayer(world);
  let t = 0, jumps = 0, bumps = 0, hits = 0;
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
        BW.updateTrams(world, t);
        // steer through the free half of any roadworks ahead
        let tx = n.x, tz = n.z;
        for (const h of world.hazards) {
          const toN = Math.hypot(n.x - p.x, n.z - p.z);
          const ahead = (h.lineX - p.x) * Math.sin(p.heading) + (h.lineZ - p.z) * Math.cos(p.heading);
          if (ahead > -1 && ahead < 35 && Math.hypot(h.lineX - p.x, h.lineZ - p.z) < Math.min(36, toN)) {
            const along = (p.x - h.lineX) * h.dx + (p.z - h.lineZ) * h.dz;
            const dirSign = Math.sign((n.x - h.lineX) * h.dx + (n.z - h.lineZ) * h.dz) || 1;
            const k = along * dirSign + 6; // aim a little past the block, on the gap line
            tx = h.lineX + h.dx * dirSign * Math.max(k, 6) + -h.dz * h.gapLat;
            tz = h.lineZ + h.dz * dirSign * Math.max(k, 6) + h.dx * h.gapLat;
            break;
          }
        }
        const want = Math.atan2(tx - p.x, tz - p.z);
        const d = angleDiff(p.heading, want);
        const fx = Math.sin(p.heading), fz = Math.cos(p.heading);
        let jump = false;
        for (const o of world.obstacles) {
          const ahead = (o.x - p.x) * fx + (o.z - p.z) * fz;
          const lat = Math.abs((o.x - p.x) * -fz + (o.z - p.z) * fx);
          if (ahead > 0 && ahead < speed * 0.32 + 1.2 && lat < o.half + 1) jump = true;
        }
        const ev = BW.stepPlayer(world, p, {
          left: d < -0.04, right: d > 0.04, up: Math.abs(d) < 0.9, down: false, jump, sprint,
        }, dt, speed);
        for (const e of ev) { if (e.type === 'jump') jumps++; if (e.type === 'bump') bumps++; if (e.type === 'stumble') hits++; }
        t += dt;
      }
    }
  }
  return { t, jumps, bumps, hits };
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
    rows.push({ speed: `${s.label} ${s.mps} m/s`, seconds: Math.round(r.t), margin: Math.round(BW.TIME_LIMIT - r.t), jumps: r.jumps, bumps: r.bumps, stumbles: r.hits });
  }
  console.table(rows);
  // Every speed must be beatable; default and faster must leave comfortable slack for a human.
  BW.SPEEDS.forEach((s, i) => {
    assert.ok(rows[i].margin > 20, `${rows[i].speed} infeasible: ${rows[i].margin}s margin`);
    if (s.mps >= BW.SPEEDS.find(x => x.default).mps) assert.ok(rows[i].margin >= 70, `${rows[i].speed} too tight`);
  });
});

test('roadworks cannot be jumped and leave a gap to walk through', () => {
  assert.ok(world.hazards.length >= 8, `${world.hazards.length} roadworks`);
  for (const h of world.hazards) {
    assert.ok(h.h > 1.6, 'roadworks must be taller than a jump');
    const gx = h.lineX + -h.dz * h.gapLat, gz = h.lineZ + h.dx * h.gapLat;
    assert.ok(world.isWalkable(gx, gz) && !BW.hazardAt(world, gx, gz), 'gap blocked');
  }
  const h = world.hazards[0];
  const run = (sprint) => {
    const p = { ...BW.createPlayer(world), x: h.x - h.dx * 5, z: h.z - h.dz * 5, heading: Math.atan2(h.dx, h.dz) };
    let stumbled = false, hit = false;
    for (let i = 0; i < 120; i++) {
      const ev = BW.stepPlayer(world, p, { up: true, sprint, jump: i % 30 === 0 }, 1 / 60, 14);
      if (ev.some(e => e.type === 'stumble')) stumbled = true;
      if (ev.some(e => e.type === 'hit')) hit = true;
    }
    const along = (p.x - h.x) * h.dx + (p.z - h.z) * h.dz;
    const lat = Math.abs((p.x - h.x) * -h.dz + (p.z - h.z) * h.dx);
    assert.ok(along < 0 || lat > h.hw, 'went through roadworks');
    return { stumbled, hit };
  };
  const walk = run(false), sprint = run(true);
  assert.ok(walk.hit && !walk.stumbled, 'walking into roadworks blocks without stumbling');
  assert.ok(sprint.stumbled, 'sprinting into roadworks should stumble the player');
});

test('trams move along their line and shove the player out of the way', () => {
  assert.ok(world.trams.length >= 2);
  const tr = world.trams[0];
  BW.updateTrams(world, 0); const a = [tr.x, tr.z];
  BW.updateTrams(world, 2); const b = [tr.x, tr.z];
  assert.ok(Math.abs(Math.hypot(b[0] - a[0], b[1] - a[1]) - tr.speed * 2) < 1, 'tram speed');
  assert.ok(world.isWalkable(tr.x, tr.z));
  const p = { ...BW.createPlayer(world), x: tr.x, z: tr.z };
  const ev = BW.stepPlayer(world, p, {}, 1 / 60, 14);
  assert.ok(ev.some(e => e.type === 'hit'), 'tram hit');
  assert.ok(!BW.hazardAt(world, p.x, p.z) && world.isWalkable(p.x, p.z), 'player pushed clear onto the street');
  assert.ok(p.stumble > 0);
});

test('sprint is faster, stumbling is slower', () => {
  const run = (input, pre) => {
    const p = BW.createPlayer(world); Object.assign(p, pre);
    const z0 = p.z;
    for (let i = 0; i < 30; i++) BW.stepPlayer(world, p, { up: true, ...input }, 1 / 60, 10);
    return p.z - z0;
  };
  const walk = run({}), sprint = run({ sprint: true }), stumbled = run({ sprint: true }, { stumble: 5 });
  assert.ok(Math.abs(sprint / walk - BW.SPRINT_MULT) < 0.05, `sprint ratio ${sprint / walk}`);
  assert.ok(Math.abs(stumbled / walk - BW.STUMBLE_MULT) < 0.05, `stumble ratio ${stumbled / walk}`);
});

test('sprinting into a barrier causes a stumble', () => {
  const o = world.obstacles[0];
  const p = { ...BW.createPlayer(world), x: o.x - o.dx * 3, z: o.z - o.dz * 3, heading: Math.atan2(o.dx, o.dz) };
  let st = false;
  for (let i = 0; i < 60; i++) if (BW.stepPlayer(world, p, { up: true, sprint: true }, 1 / 60, 14).some(e => e.type === 'stumble' && e.why === 'barrier')) st = true;
  assert.ok(st);
});

test('sprinting bot is faster than walking bot at default pace', () => {
  const def = BW.SPEEDS.find(s => s.default).mps;
  const walk = runBot(def), sprint = runBot(def, 1 / 60, true);
  console.log(`default pace: walk ${Math.round(walk.t)}s, sprint ${Math.round(sprint.t)}s (${sprint.hits} stumbles)`);
  assert.ok(sprint.t < walk.t);
});
