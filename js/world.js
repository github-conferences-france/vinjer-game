/* Bordeaux Escape — world data + physics (no DOM; testable with Node). */
(function (root) {
  'use strict';

  // Local metric frame around the old town: x = east, z = north (metres).
  // Coordinates approximate real positions (lat/lon projected, simplified).
  const HW = 6; // street half-width
  const PLAYER_R = 0.45;
  const GRAVITY = 20;
  const JUMP_V = 7.2; // peak ≈ 1.3 m
  const TURN_RATE = 2.6; // rad/s
  const TIME_LIMIT = 300; // seconds
  const ARRIVE_R = 14;
  const SPRINT_MULT = 1.5; // hold Shift
  const STUMBLE_TIME = 2; // seconds slowed after hitting something
  const STUMBLE_MULT = 0.5;
  const TRAM_LINES = [ // real Bordeaux tram corridors (lines A and B/C)
    { street: "Cours d'Alsace-Lorraine", count: 1, speed: 8 },
    { street: 'Quai Richelieu', count: 3, speed: 9 },
  ];

  const NODES = {
    V: [8, -674], // Place de la Victoire
    A: [-20, -150], B: [-45, 90], C: [-65, 250], D: [-85, 400], E: [-110, 545],
    PC: [-150, 605], // Place de la Comédie (Grand Théâtre)
    GC: [126, -150], // Grosse Cloche (on Cours Victor Hugo)
    H: [260, -160], W1: [-260, -130], W0: [-220, -420],
    PB: [-330, 90], // Place Pey-Berland
    P2: [-250, 90], P3: [-245, 250], P4: [-240, 400], P5: [-235, 545],
    K: [120, 80], L: [260, 75], M2: [120, 250], M3: [130, 400], N2: [255, 250], N3: [250, 400],
    R1: [100, 550],
    S1: [250, -640],
    Q0: [470, -700], Q1: [440, -170], Q2: [420, 70], Q3: [390, 250], Q4: [360, 400],
    MI: [345, 470], // Miroir d'eau (quay, facing Place de la Bourse)
    Q5: [325, 560], Q6: [260, 750], Q7: [170, 950],
    T1: [-130, 760], QC: [0, 840], // Esplanade des Quinconces
  };

  const STREETS = [
    { name: 'Rue Sainte-Catherine', path: ['V', 'A', 'B', 'C', 'D', 'E', 'PC'] },
    { name: 'Cours Victor Hugo', path: ['W1', 'A', 'GC', 'H', 'Q1'] },
    { name: 'Cours Aristide-Briand', path: ['V', 'W0', 'W1'] },
    { name: 'Cours de la Marne', path: ['V', 'S1', 'Q0'] },
    { name: "Cours d'Alsace-Lorraine", path: ['PB', 'P2', 'B', 'K', 'L', 'Q2'] },
    { name: 'Rue Saint-James', path: ['GC', 'K', 'M2', 'M3', 'R1'] },
    { name: 'Rue Vital-Carles', path: ['W1', 'P2', 'P3', 'P4', 'P5'] },
    { name: "Cours de l'Intendance", path: ['P5', 'E'] },
    { name: 'Rue du Loup', path: ['P3', 'C', 'M2', 'N2', 'Q3'] },
    { name: 'Rue Saint-Rémi', path: ['P4', 'D', 'M3', 'N3', 'Q4'] },
    { name: 'Rue des Piliers-de-Tutelle', path: ['H', 'L', 'N2', 'N3'] },
    { name: 'Cours du Chapeau-Rouge', path: ['E', 'R1', 'Q5'] },
    { name: 'Quai Richelieu', path: ['Q0', 'Q1', 'Q2', 'Q3', 'Q4', 'MI', 'Q5', 'Q6', 'Q7'] },
    { name: 'Allées de Tourny', path: ['PC', 'T1', 'QC', 'Q6'] },
  ];

  const PLAZAS = [
    { node: 'V', r: 34 }, { node: 'PB', r: 34 }, { node: 'PC', r: 28 },
    { node: 'MI', r: 30 }, { node: 'QC', r: 70 }, { x: 290, z: 470, r: 33 }, // Place de la Bourse
  ];

  const QUAY = ['Q0', 'Q1', 'Q2', 'Q3', 'Q4', 'MI', 'Q5', 'Q6', 'Q7'];

  const PLACES = [
    {
      id: 'victoire', photo: { src: 'assets/places/victoire.jpg', credit: 'Porte d’Aquitaine, Place de la Victoire — Fran Roy, CC BY-SA 4.0', url: 'https://commons.wikimedia.org/wiki/File:Porte_d%27Aquitaine_et_rue_Sainte-Catherine_au_fond.jpg' }, node: 'V', name: 'Place de la Victoire',
      blurb: 'Start line, by the Porte d’Aquitaine.',
      clue: {
        q: 'Warm-up! What is Bordeaux’s iconic little pastry — caramelised crust, custardy heart, scented with rum and vanilla?',
        options: ['Canelé', 'Macaron', 'Kouign-amann'], answer: 0,
        fact: 'Legend says nuns baked canelés with egg yolks left over from clarifying wine with egg whites.',
      },
      hint: 'Head north on Rue Sainte-Catherine, then east on Cours Victor Hugo to the medieval gate with a giant bell.',
    },
    {
      id: 'cloche', photo: { src: 'assets/places/cloche.jpg', credit: 'La Grosse Cloche — Grand Parc Bordeaux, CC BY 2.0', url: 'https://commons.wikimedia.org/wiki/File:Bordeaux_-_La_Grosse_Cloche-cr.jpg' }, node: 'GC', name: 'La Grosse Cloche',
      blurb: '15th-century belfry gate of the old town hall.',
      clue: {
        q: 'This bell once announced the start of the grape harvest. Which river makes Bordeaux the “Port of the Moon”?',
        options: ['Dordogne', 'Garonne', 'Loire'], answer: 1,
        fact: 'The river’s crescent-shaped bend gave the city its nickname, Port de la Lune.',
      },
      hint: 'Go north up Rue Saint-James, then west along Cours d’Alsace-Lorraine to the cathedral and its detached bell tower.',
    },
    {
      id: 'cathedrale', photo: { src: 'assets/places/cathedrale.jpg', credit: 'Cathédrale Saint-André — Chabe01, CC BY-SA 4.0', url: 'https://commons.wikimedia.org/wiki/File:Cath%C3%A9drale_St_Andr%C3%A9_Bordeaux_3.jpg' }, node: 'PB', name: 'Cathédrale Saint-André',
      blurb: 'Gothic cathedral beside the Tour Pey-Berland.',
      clue: {
        q: 'In 1137 a future queen of France — and later of England — married here. Who?',
        options: ['Marie-Antoinette', 'Joan of Arc', 'Eleanor of Aquitaine'], answer: 2,
        fact: 'Eleanor married the future Louis VII here, aged about 13.',
      },
      hint: 'Head north up Rue Vital-Carles, then east along Cours de l’Intendance to Place de la Comédie.',
    },
    {
      id: 'theatre', photo: { src: 'assets/places/theatre.jpg', credit: 'Grand Théâtre — Monster1000, CC BY-SA 3.0', url: 'https://commons.wikimedia.org/wiki/File:GrandTheatreBordeaux2.jpg' }, node: 'PC', name: 'Grand Théâtre',
      blurb: 'Neoclassical opera house (1780).',
      clue: {
        q: 'Count them! How many Corinthian columns line the Grand Théâtre’s portico?',
        options: ['12', '8', '20'], answer: 0,
        fact: 'Twelve statues — nine Muses and three goddesses — stand on top of them.',
      },
      hint: 'Final run: east down Cours du Chapeau-Rouge to the river, then south to the Miroir d’eau.',
    },
    {
      id: 'miroir', photo: { src: 'assets/places/miroir.jpg', credit: 'Miroir d’eau — Olivier Aumage, CC BY-SA 2.5', url: 'https://commons.wikimedia.org/wiki/File:Bordeaux_Miroir_001.jpg' }, node: 'MI', name: 'Miroir d’eau',
      blurb: 'The world’s largest reflecting pool, facing Place de la Bourse.',
      final: true,
    },
  ];

  // ---------- geometry helpers ----------
  function distToSeg(px, pz, ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az;
    const L2 = dx * dx + dz * dz;
    let t = L2 ? ((px - ax) * dx + (pz - az) * dz) / L2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = ax + dx * t - px, qz = az + dz * t - pz;
    return Math.sqrt(qx * qx + qz * qz);
  }

  function segIntersectsRect(ax, az, bx, bz, r) {
    let t0 = 0, t1 = 1;
    const dx = bx - ax, dz = bz - az;
    const p = [-dx, dx, -dz, dz];
    const q = [ax - r.x0, r.x1 - ax, az - r.z0, r.z1 - az];
    for (let i = 0; i < 4; i++) {
      if (p[i] === 0) { if (q[i] < 0) return false; continue; }
      const t = q[i] / p[i];
      if (p[i] < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
      else { if (t < t0) return false; if (t < t1) t1 = t; }
    }
    return true;
  }

  function pointRectDist(px, pz, r) {
    const dx = Math.max(r.x0 - px, 0, px - r.x1);
    const dz = Math.max(r.z0 - pz, 0, pz - r.z1);
    return Math.sqrt(dx * dx + dz * dz);
  }

  function rectSegDist(r, s) {
    if (segIntersectsRect(s.ax, s.az, s.bx, s.bz, r)) return 0;
    return Math.min(
      distToSeg(r.x0, r.z0, s.ax, s.az, s.bx, s.bz), distToSeg(r.x1, r.z0, s.ax, s.az, s.bx, s.bz),
      distToSeg(r.x0, r.z1, s.ax, s.az, s.bx, s.bz), distToSeg(r.x1, r.z1, s.ax, s.az, s.bx, s.bz),
      pointRectDist(s.ax, s.az, r), pointRectDist(s.bx, s.bz, r));
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- world construction ----------
  function createWorld(seed) {
    const rng = mulberry32(seed == null ? 1337 : seed);
    const nodes = {};
    for (const k in NODES) nodes[k] = { id: k, x: NODES[k][0], z: NODES[k][1] };

    const segs = [];
    const adj = {};
    for (const k in nodes) adj[k] = [];
    for (const st of STREETS) {
      for (let i = 0; i < st.path.length - 1; i++) {
        const a = nodes[st.path[i]], b = nodes[st.path[i + 1]];
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        const s = { a: a.id, b: b.id, ax: a.x, az: a.z, bx: b.x, bz: b.z, len, street: st.name,
          dx: (b.x - a.x) / len, dz: (b.z - a.z) / len };
        s.minx = Math.min(a.x, b.x) - HW; s.maxx = Math.max(a.x, b.x) + HW;
        s.minz = Math.min(a.z, b.z) - HW; s.maxz = Math.max(a.z, b.z) + HW;
        segs.push(s);
        adj[a.id].push({ to: b.id, len });
        adj[b.id].push({ to: a.id, len });
      }
    }

    const plazas = PLAZAS.map(p => p.node ? { x: nodes[p.node].x, z: nodes[p.node].z, r: p.r } : { x: p.x, z: p.z, r: p.r });
    const quay = QUAY.map(k => nodes[k]);

    function quayX(z) {
      if (z <= quay[0].z) return quay[0].x;
      for (let i = 0; i < quay.length - 1; i++) {
        const a = quay[i], b = quay[i + 1];
        if (z >= a.z && z <= b.z) return a.x + (b.x - a.x) * (z - a.z) / (b.z - a.z);
      }
      return quay[quay.length - 1].x;
    }

    const RIVER_OFF = HW + 10;
    const river = [];
    river.push([quay[0].x + RIVER_OFF, -1400]);
    for (const q of quay) river.push([q.x + RIVER_OFF, q.z]);
    river.push([quay[quay.length - 1].x + RIVER_OFF - 60, 1500]);
    river.push([1600, 1500]);
    river.push([1600, -1400]);

    function inStreet(x, z) {
      for (const s of segs) {
        if (x < s.minx || x > s.maxx || z < s.minz || z > s.maxz) continue;
        if (distToSeg(x, z, s.ax, s.az, s.bx, s.bz) <= HW) return s;
      }
      return null;
    }
    function inPlaza(x, z) {
      for (const p of plazas) if ((x - p.x) ** 2 + (z - p.z) ** 2 <= p.r * p.r) return p;
      return null;
    }
    function isWalkable(x, z) { return !!(inStreet(x, z) || inPlaza(x, z)); }

    function nearestSeg(x, z) {
      let best = null, bd = Infinity;
      for (const s of segs) {
        const d = distToSeg(x, z, s.ax, s.az, s.bx, s.bz);
        if (d < bd) { bd = d; best = s; }
      }
      return best;
    }

    const landmarkRects = [
      { x0: -12, x1: 28, z0: -735, z1: -712 }, // Porte d'Aquitaine
      { x0: 100, x1: 152, z0: -142, z1: -126 }, // Grosse Cloche
      { x0: -490, x1: -372, z0: 102, z1: 140 }, // Cathedral
      { x0: -340, x1: -320, z0: 30, z1: 50 }, // Tour Pey-Berland
      { x0: -120, x1: -30, z0: 572, z1: 640 }, // Grand Théâtre
      { x0: 215, x1: 320, z0: 413, z1: 527 }, // Bourse (U)
      { x0: -10, x1: 10, z0: 830, z1: 850 }, // Monument aux Girondins
    ];

    const buildings = [];
    const BX0 = -720, BX1 = 560, BZ0 = -860, BZ1 = 1060, STEP = 30;
    const MARGIN = HW + 2.5;
    function rectOK(r) {
      const cz = (r.z0 + r.z1) / 2;
      if (r.x1 > quayX(cz) - 2) return false;
      for (const s of segs) {
        if (r.x1 < s.minx - MARGIN || r.x0 > s.maxx + MARGIN || r.z1 < s.minz - MARGIN || r.z0 > s.maxz + MARGIN) continue;
        if (rectSegDist(r, s) < MARGIN) return false;
      }
      for (const p of plazas) if (pointRectDist(p.x, p.z, r) < p.r + 3) return false;
      for (const l of landmarkRects) {
        if (r.x1 > l.x0 - 3 && r.x0 < l.x1 + 3 && r.z1 > l.z0 - 3 && r.z0 < l.z1 + 3) return false;
      }
      return true;
    }
    for (let gx = BX0; gx < BX1; gx += STEP) {
      for (let gz = BZ0; gz < BZ1; gz += STEP) {
        for (const size of [STEP - 3, 18, 11]) {
          const jx = (rng() - 0.5) * 3, jz = (rng() - 0.5) * 3;
          const w = size * (0.85 + rng() * 0.15), d = size * (0.85 + rng() * 0.15);
          const cx = gx + STEP / 2 + jx, cz = gz + STEP / 2 + jz;
          const r = { x0: cx - w / 2, x1: cx + w / 2, z0: cz - d / 2, z1: cz + d / 2 };
          if (rectOK(r)) {
            const far = Math.hypot(cx, cz - 100) > 900;
            r.h = (far ? 8 : 10) + rng() * (far ? 10 : 14) + (rng() < 0.06 ? 10 : 0);
            r.tint = rng();
            buildings.push(r);
            break;
          }
        }
      }
    }

    // Obstacles: barriers spanning the full street width, away from junctions/plazas.
    const obstacles = [];
    const placeNodes = PLACES.map(p => p.node);
    const tramStreets = new Set(TRAM_LINES.map(l => l.street));
    for (const s of segs) {
      if (tramStreets.has(s.street)) continue;
      const usable = s.len - 2 * 26;
      if (usable < 20) continue;
      const count = Math.max(1, Math.floor(usable / 75));
      for (let i = 0; i < count; i++) {
        if (rng() < 0.3) continue;
        const t = 26 + (usable / count) * (i + 0.25 + rng() * 0.5);
        const x = s.ax + s.dx * t, z = s.az + s.dz * t;
        let clash = false;
        for (const o of segs) {
          if (o === s) continue;
          if (distToSeg(x, z, o.ax, o.az, o.bx, o.bz) < HW * 2 + 4) { clash = true; break; }
        }
        if (!clash) for (const p of plazas) if (Math.hypot(x - p.x, z - p.z) < p.r + HW + 4) { clash = true; break; }
        if (!clash) for (const k of placeNodes) if (Math.hypot(x - nodes[k].x, z - nodes[k].z) < 40) { clash = true; break; }
        if (clash) continue;
        const kind = rng() < 0.5 ? 'barrier' : 'crates';
        obstacles.push({ x, z, dx: s.dx, dz: s.dz, half: HW, thick: kind === 'barrier' ? 0.7 : 1.1,
          h: kind === 'barrier' ? 0.9 : 1.0, kind });
      }
    }

    // Roadworks: tall (unjumpable) blocks covering one half of the street — steer around them.
    const hazards = [];
    const WORKS_W = HW + 1; // covers the kerb side and 1 m past the centreline
    for (const s of segs) {
      if (tramStreets.has(s.street)) continue;
      const usable = s.len - 2 * 30;
      if (usable < 30) continue;
      const count = Math.max(1, Math.floor(usable / 130));
      for (let i = 0; i < count; i++) {
        if (rng() < 0.35) continue;
        const t = 30 + (usable / count) * (i + 0.2 + rng() * 0.6);
        const cx = s.ax + s.dx * t, cz = s.az + s.dz * t;
        let clash = false;
        for (const o of segs) {
          if (o === s) continue;
          if (distToSeg(cx, cz, o.ax, o.az, o.bx, o.bz) < HW * 2 + 6) { clash = true; break; }
        }
        if (!clash) for (const p of plazas) if (Math.hypot(cx - p.x, cz - p.z) < p.r + HW + 8) { clash = true; break; }
        if (!clash) for (const k of placeNodes) if (Math.hypot(cx - nodes[k].x, cz - nodes[k].z) < 45) { clash = true; break; }
        if (!clash) for (const o of obstacles) if (Math.hypot(cx - o.x, cz - o.z) < 22) { clash = true; break; }
        if (clash) continue;
        const side = rng() < 0.5 ? -1 : 1;
        const latC = side * (HW - WORKS_W / 2); // lateral centre of the block
        hazards.push({ kind: 'works', x: cx + -s.dz * latC, z: cz + s.dx * latC, dx: s.dx, dz: s.dz,
          hl: 2, hw: WORKS_W / 2, h: 2.4, lineX: cx, lineZ: cz, gapLat: -side * (WORKS_W - HW + (HW - (WORKS_W - HW)) / 2) });
      }
    }

    // Trams ping-pong along real tram streets, driving on the right-hand lane.
    const trams = [];
    for (const line of TRAM_LINES) {
      const st = STREETS.find(x => x.name === line.street);
      const pts = st.path.map(k => nodes[k]);
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
      const len = cum[cum.length - 1];
      for (let i = 0; i < line.count; i++) {
        trams.push({ kind: 'tram', pts, cum, len, speed: line.speed, phase: (i + 0.3) / line.count * 2 * (len - 80),
          hl: 13, hw: 1.3, h: 3.4, lane: 2.9, x: pts[0].x, z: pts[0].z, dx: 1, dz: 0 });
      }
    }

    return {
      HW, nodes, segs, adj, plazas, river, quay, quayX, buildings, obstacles, landmarkRects, hazards, trams,
      places: PLACES, streets: STREETS,
      inStreet, inPlaza, isWalkable, nearestSeg,
      bounds: { x0: -720, x1: 620, z0: -860, z1: 1060 },
    };
  }

  // ---------- path finding ----------
  function shortestPath(world, from, to) {
    const dist = {}, prev = {}, done = {};
    for (const k in world.nodes) dist[k] = Infinity;
    dist[from] = 0;
    for (;;) {
      let u = null, best = Infinity;
      for (const k in dist) if (!done[k] && dist[k] < best) { best = dist[k]; u = k; }
      if (u === null || u === to) break;
      done[u] = true;
      for (const e of world.adj[u]) {
        const nd = dist[u] + e.len;
        if (nd < dist[e.to]) { dist[e.to] = nd; prev[e.to] = u; }
      }
    }
    const path = [];
    for (let k = to; k; k = prev[k]) { path.unshift(k); if (k === from) break; }
    return { length: dist[to], path };
  }

  function routeLength(world) {
    let total = 0;
    const legs = [];
    for (let i = 0; i < world.places.length - 1; i++) {
      const r = shortestPath(world, world.places[i].node, world.places[i + 1].node);
      legs.push(r); total += r.length;
    }
    return { total, legs };
  }

  // ---------- player physics ----------
  function createPlayer(world) {
    const v = world.nodes.V;
    return { x: v.x, z: v.z - 10, y: 0, vy: 0, heading: 0, onGround: true, moving: false, sprinting: false, stumble: 0 };
  }

  function obstacleLocal(o, x, z) {
    const rx = x - o.x, rz = z - o.z;
    return { along: rx * o.dx + rz * o.dz, lat: rx * -o.dz + rz * o.dx };
  }

  // Move trams to their position at time t (seconds since start).
  function updateTrams(world, t) {
    for (const tr of world.trams) {
      const span = tr.len - 80, period = 2 * span;
      let u = (tr.phase + t * tr.speed) % period;
      const back = u > span;
      const d = 40 + (back ? period - u : u);
      let i = 1;
      while (i < tr.cum.length - 1 && tr.cum[i] < d) i++;
      const a = tr.pts[i - 1], b = tr.pts[i], sl = tr.cum[i] - tr.cum[i - 1];
      const k = (d - tr.cum[i - 1]) / sl;
      const fdx = (b.x - a.x) / sl, fdz = (b.z - a.z) / sl;
      // right-hand lane relative to travel direction (x = east, z = north → right = (dz, -dx)),
      // eased to the centreline near each terminus so the lane swap at turnaround is continuous
      const ramp = Math.min(1, Math.min(d - 40, tr.len - 40 - d) / 15);
      const off = (back ? -1 : 1) * tr.lane * ramp;
      tr.x = a.x + (b.x - a.x) * k + fdz * off;
      tr.z = a.z + (b.z - a.z) * k - fdx * off;
      tr.dx = back ? -fdx : fdx; tr.dz = back ? -fdz : fdz;
    }
  }
  function boxLocal(o, x, z) {
    const rx = x - o.x, rz = z - o.z;
    return { along: rx * o.dx + rz * o.dz, lat: rx * -o.dz + rz * o.dx };
  }
  function inBox(o, x, z, pad) {
    if (Math.abs(x - o.x) > o.hl + 4 || Math.abs(z - o.z) > o.hl + 4) return false;
    const l = boxLocal(o, x, z);
    return Math.abs(l.along) < o.hl + pad && Math.abs(l.lat) < o.hw + pad;
  }
  function hazardAt(world, x, z) {
    for (const h of world.hazards) if (inBox(h, x, z, PLAYER_R)) return h;
    for (const h of world.trams) if (inBox(h, x, z, PLAYER_R)) return h;
    return null;
  }

  function groundHeight(world, x, z) {
    let g = 0;
    for (const o of world.obstacles) {
      if (Math.abs(x - o.x) > 10 || Math.abs(z - o.z) > 10) continue;
      const l = obstacleLocal(o, x, z);
      if (Math.abs(l.along) < o.thick / 2 + 0.15 && Math.abs(l.lat) < o.half + 0.15) g = Math.max(g, o.h);
    }
    return g;
  }

  function blockedByObstacle(world, p, nx, nz) {
    for (const o of world.obstacles) {
      if (Math.abs(nx - o.x) > 10 || Math.abs(nz - o.z) > 10) continue;
      const ln = obstacleLocal(o, nx, nz);
      if (Math.abs(ln.along) < o.thick / 2 + PLAYER_R && Math.abs(ln.lat) < o.half + PLAYER_R) {
        if (p.y >= o.h - 0.05) continue;
        const lo = obstacleLocal(o, p.x, p.z);
        if (Math.abs(ln.along) < Math.abs(lo.along)) return o; // moving deeper → blocked
      }
    }
    return null;
  }

  // input: {left,right,up,down,jump,sprint}; jump is edge-triggered by the caller.
  function stepPlayer(world, p, input, dt, speed) {
    const events = [];
    if (p.stumble > 0) p.stumble = Math.max(0, p.stumble - dt);
    const stumble = (why, by) => {
      if (!(p.stumble > 0)) events.push({ type: 'stumble', why, by });
      p.stumble = STUMBLE_TIME;
    };
    p.sprinting = !!(input.sprint && input.up && !input.down && !(p.stumble > 0));
    speed *= p.stumble > 0 ? STUMBLE_MULT : p.sprinting ? SPRINT_MULT : 1;
    if (input.left) p.heading -= TURN_RATE * dt;
    if (input.right) p.heading += TURN_RATE * dt;
    const dir = (input.up ? 1 : 0) - (input.down ? 0.6 : 0);
    p.moving = false;
    if (dir !== 0) {
      const step = speed * dir * dt;
      const fx = Math.sin(p.heading), fz = Math.cos(p.heading);
      const cands = [[p.x + fx * step, p.z + fz * step]];
      // Slide along the nearest street when pushing into a façade.
      const s = world.nearestSeg(p.x, p.z);
      if (s) {
        const d = fx * s.dx + fz * s.dz;
        if (Math.abs(d) > 0.15) {
          const sl = step * d;
          const t = (p.x - s.ax) * s.dx + (p.z - s.az) * s.dz;
          const cx = s.ax + s.dx * t, cz = s.az + s.dz * t;
          cands.push([p.x + s.dx * sl + (cx - p.x) * 0.08, p.z + s.dz * sl + (cz - p.z) * 0.08]);
        }
      }
      cands.push([p.x + fx * step, p.z], [p.x, p.z + fz * step]);
      for (let ci = 0; ci < cands.length; ci++) {
        const [nx, nz] = cands[ci];
        if (!world.isWalkable(nx, nz)) continue;
        const hz = hazardAt(world, nx, nz);
        if (hz && !hazardAt(world, p.x, p.z)) {
          if (ci === 0) { events.push({ type: 'hit', hazard: hz }); if (p.sprinting || hz.kind === 'tram') stumble(hz.kind, hz); }
          continue; // try sliding past it
        }
        const ob = blockedByObstacle(world, p, nx, nz);
        if (ob) {
          events.push({ type: 'bump', obstacle: ob });
          if (p.sprinting && !input.jump) stumble('barrier', ob);
          break;
        }
        p.x = nx; p.z = nz; p.moving = true;
        break;
      }
    }
    // A tram driving into the player shoves them sideways out of its path.
    for (const tr of world.trams) {
      if (!inBox(tr, p.x, p.z, PLAYER_R)) continue;
      const l = boxLocal(tr, p.x, p.z);
      const off = tr.hw + PLAYER_R + 0.15;
      for (const side of [Math.sign(l.lat) || 1, -(Math.sign(l.lat) || 1)]) {
        const nx = tr.x + tr.dx * l.along + -tr.dz * side * off, nz = tr.z + tr.dz * l.along + tr.dx * side * off;
        if (world.isWalkable(nx, nz)) { p.x = nx; p.z = nz; break; }
      }
      events.push({ type: 'hit', hazard: tr });
      stumble('tram', tr);
    }
    const g = groundHeight(world, p.x, p.z);
    if (input.jump && p.onGround) { p.vy = JUMP_V; p.onGround = false; events.push({ type: 'jump' }); }
    p.vy -= GRAVITY * dt;
    p.y += p.vy * dt;
    if (p.y <= g) {
      if (!p.onGround && p.vy < -1) events.push({ type: 'land' });
      p.y = g; p.vy = 0; p.onGround = true;
    } else if (p.y > g + 0.02) {
      p.onGround = false;
    }
    return events;
  }

  const api = {
    HW, PLAYER_R, TIME_LIMIT, ARRIVE_R, TURN_RATE, JUMP_V, GRAVITY, SPRINT_MULT, STUMBLE_TIME, STUMBLE_MULT,
    createWorld, shortestPath, routeLength, createPlayer, stepPlayer, updateTrams, hazardAt, distToSeg, obstacleLocal,
    SPEEDS: [
      { id: 'stroll', label: 'Stroll', mps: 11, note: 'Hard' },
      { id: 'jog', label: 'Jog', mps: 14, note: 'Normal', default: true },
      { id: 'run', label: 'Run', mps: 17, note: 'Relaxed' },
    ],
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BordeauxWorld = api;
})(typeof window !== 'undefined' ? window : globalThis);
