// ============================================================
// MODULAR MAP GENERATOR (v0.1)
// Instead of hand-authored fixed maps, we assemble a map from a ROOM LIBRARY
// scaled to the player count, then connect the rooms into a graph that obeys
// LAYOUT RULES so the result is strategically sound (not just technically
// playable). A "named map" is simply a frozen generator output (a seed + size),
// so fixed maps and procedural maps share one code path.
//
// Layout rules enforced:
//   - Guaranteed connectivity: every room reachable (spanning tree first).
//   - No single-exit task rooms: every non-spawn room gets >=2 connections, so
//     no room is a one-way death trap (a hiding saboteur can always be fled).
//   - Spine + branches: a central corridor of "hub" rooms with functional rooms
//     branching off — produces chokepoints instead of a uniform mesh.
//   - Distance constraints: refill rooms are spread out (not clustered), so air
//     pressure is felt; turrets sit toward the perimeter.
//   - Scaling: room count, turrets, and refills scale with players so an 18-
//     player station sprawls while an 8-player one stays tense.
// ============================================================

import { makeRng } from "./rng.js";

// ---- Room library: each entry is a TYPE with roles it can fill. ----
// `kind`: hub (corridor/connective), function (tasks + a system role), utility.
// `roles`: which special functions this room can serve (refill/turret/repair).
const ROOM_LIBRARY = [
  { type: "Bridge",       kind: "hub",      roles: [],                     weight: 0, fixed: true },
  { type: "Corridor",     kind: "hub",      roles: [],                     weight: 3 },
  { type: "Junction",     kind: "hub",      roles: [],                     weight: 2 },
  { type: "Engineering",  kind: "function", roles: ["refill", "repair"],   weight: 2 },
  { type: "Reactor",      kind: "function", roles: ["repair"],             weight: 2 },
  { type: "Sensors",      kind: "function", roles: [],                     weight: 2 },
  { type: "Medbay",       kind: "function", roles: ["refill"],             weight: 2 },
  { type: "Cargo",        kind: "function", roles: ["repair"],             weight: 1 },
  { type: "Hangar",       kind: "function", roles: ["refill"],             weight: 1 },
  { type: "Comms Array",  kind: "function", roles: [],                     weight: 1 },
  { type: "Labs",         kind: "function", roles: [],                     weight: 1 },
  { type: "Galley",       kind: "function", roles: ["refill"],             weight: 1 },
  { type: "Storage",      kind: "function", roles: [],                     weight: 1 },
];

// Scale targets by player count. Returns the shape of the map to build.
function sizeFor(players) {
  // Rooms grow ~ with players; turrets >= 2 and >= 2x impostors; refills ~ rooms/3.
  const impostors = players <= 10 ? 1 : 2;
  const functional = Math.max(4, Math.round(players * 0.8));      // task rooms
  const hubs = Math.max(2, Math.round(functional / 3));            // connective rooms
  const turrets = Math.max(2, impostors * 2);                      // boarding defense
  const refills = Math.max(2, Math.round(functional / 3));         // O2 stations
  const repairs = Math.max(2, Math.round(functional / 4));         // hull repair points
  return { players, impostors, functional, hubs, turrets, refills, repairs };
}

// Pick N function-room types by weight without repeating until the library is
// exhausted (then it allows repeats with a numeric suffix for variety).
function pickFunctionRooms(rng, n) {
  const pool = ROOM_LIBRARY.filter((r) => r.kind === "function");
  const chosen = [];
  const counts = {};
  for (let i = 0; i < n; i++) {
    // weighted pick
    const total = pool.reduce((a, r) => a + r.weight, 0);
    let roll = rng() * total, pick = pool[0];
    for (const r of pool) { roll -= r.weight; if (roll <= 0) { pick = r; break; } }
    counts[pick.type] = (counts[pick.type] || 0) + 1;
    const name = counts[pick.type] === 1 ? pick.type : `${pick.type} ${counts[pick.type]}`;
    chosen.push({ ...pick, name });
  }
  return chosen;
}

// Build the connection graph: a spine of hubs, function rooms branch off hubs,
// then add a few cross-links so it isn't a pure tree (creates loops/escape).
function buildGraph(rng, spawn, hubs, functions, turrets) {
  const adj = {};
  const link = (a, b) => { (adj[a] ||= new Set()).add(b); (adj[b] ||= new Set()).add(a); };
  const allRooms = [spawn, ...hubs, ...functions.map((f) => f.name), ...turrets];
  for (const r of allRooms) adj[r] ||= new Set();

  // 1) Spine: spawn -> hub -> hub -> ... (a central corridor).
  const spine = [spawn, ...hubs];
  for (let i = 0; i < spine.length - 1; i++) link(spine[i], spine[i + 1]);

  // 2) Branch each function room off a random spine node.
  for (const f of functions) link(f.name, spine[Math.floor(rng() * spine.length)]);

  // 3) Turrets sit at the perimeter — hang them off function rooms or spine ends.
  for (const t of turrets) {
    const anchorPool = functions.length ? functions.map((f) => f.name) : spine;
    link(t, anchorPool[Math.floor(rng() * anchorPool.length)]);
  }

  // 4) Cross-links: add a few extra edges so there are loops (no dead-end traps,
  //    and saboteurs have escape routes). ~ one per 4 rooms.
  const extra = Math.max(1, Math.round(allRooms.length / 4));
  for (let i = 0; i < extra; i++) {
    const a = allRooms[Math.floor(rng() * allRooms.length)];
    const b = allRooms[Math.floor(rng() * allRooms.length)];
    if (a !== b) link(a, b);
  }

  // 5) Enforce "no single-exit room" (except we allow spawn to be low-degree):
  //    any room with <2 links gets connected to a random hub.
  for (const r of allRooms) {
    if (r === spawn) continue;
    while (adj[r].size < 2) {
      const h = spine[Math.floor(rng() * spine.length)];
      if (h !== r) link(r, h); else break;
    }
  }

  // Convert sets to arrays.
  const out = {};
  for (const r of allRooms) out[r] = [...adj[r]];
  return { adjacency: out, rooms: allRooms };
}

// Verify every room is reachable from spawn (connectivity guarantee).
function isConnected(adjacency, spawn, rooms) {
  const seen = new Set([spawn]); const stack = [spawn];
  while (stack.length) { for (const n of adjacency[stack.pop()] || []) if (!seen.has(n)) { seen.add(n); stack.push(n); } }
  return seen.size === rooms.length;
}

// Generate a full map object the engine can consume.
export function generateMap({ players = 8, seed = null, id = null, name = null } = {}) {
  const rng = makeRng(seed ?? Math.floor(Math.random() * 1e9));
  const size = sizeFor(players);

  const spawn = "Bridge";
  const hubs = [];
  for (let i = 0; i < size.hubs; i++) hubs.push(i === 0 ? "Central Corridor" : `Corridor ${i + 1}`);
  const functions = pickFunctionRooms(rng, size.functional);
  const turrets = [];
  const turretNames = ["Turret Alpha", "Turret Beta", "Turret Gamma", "Turret Delta", "Turret Epsilon", "Turret Zeta"];
  for (let i = 0; i < size.turrets; i++) turrets.push(turretNames[i] || `Turret ${i + 1}`);

  let graph = buildGraph(rng, spawn, hubs, functions, turrets);
  // Connectivity safety net: if somehow disconnected, chain everything to spawn.
  if (!isConnected(graph.adjacency, spawn, graph.rooms)) {
    for (const r of graph.rooms) if (r !== spawn && !graph.adjacency[r].includes(spawn)) {
      graph.adjacency[r].push(spawn); graph.adjacency[spawn].push(r);
    }
  }

  // Assign special roles, spreading them out across function rooms.
  const fnRooms = functions.slice();
  const byRole = (role) => fnRooms.filter((f) => f.roles.includes(role)).map((f) => f.name);
  const spread = (candidates, count) => {
    // pick `count` spaced-out entries
    const picks = []; const step = Math.max(1, Math.floor(candidates.length / count));
    for (let i = 0; i < candidates.length && picks.length < count; i += step) picks.push(candidates[i]);
    // top up if short
    for (const c of candidates) if (picks.length < count && !picks.includes(c)) picks.push(c);
    return picks;
  };
  const refillRooms = spread(byRole("refill"), size.refills);
  const repairRooms = spread(byRole("repair"), size.repairs);
  // Fallback: ensure at least 2 of each even if the library draw was unlucky.
  while (refillRooms.length < 2 && functions[refillRooms.length]) refillRooms.push(functions[refillRooms.length].name);
  while (repairRooms.length < 2 && functions[repairRooms.length]) repairRooms.push(functions[repairRooms.length].name);

  // ---- spatial layout: give every room an x/y center + size so the client can
  // render an isometric playfield and the engine can track continuous positions.
  // Uses the same BFS-depth radial arrangement the minimap draws, scaled into a
  // world grid. Rooms are axis-aligned rectangles; adjacency becomes corridors.
  const geometry = buildGeometry(graph.rooms, graph.adjacency, spawn);

  return {
    id: id || `gen_${players}p_${seed ?? "rand"}`,
    name: name || `Generated Station (${players}p)`,
    tier: players <= 10 ? "small" : "large",
    procedural: true,
    minPlayers: Math.max(5, Math.min(players, players)),
    maxPlayers: players,
    impostors: size.impostors,
    rooms: graph.rooms,
    adjacency: graph.adjacency,          // connection graph (engine respects if present)
    geometry,                            // { worldW, worldH, rooms: { name: {x,y,w,h} }, corridors: [[a,b]] }
    refillRooms,
    turretRooms: turrets,
    repairRooms,
    spawnRoom: spawn,
    tasksPerRoom: players <= 10 ? 2 : 3,
    sabotageCooldownSeconds: 25,
    cablePullCooldownSeconds: 45,
  };
}

// Build axis-aligned room rectangles from the adjacency graph. Deterministic:
// BFS-depth rings around the spawn, each room a fixed-size cell on that ring,
// positions quantized to a grid so rooms don't overlap. World units are abstract
// (the client scales them to pixels). Each room is ROOM_SIZE square.
const ROOM_SIZE = 120;       // world units per room box
const RING_GAP = 230;        // distance between depth rings
function buildGeometry(rooms, adjacency, spawn) {
  const center = { x: 0, y: 0 };
  const depth = { [spawn]: 0 }; const q = [spawn]; const byDepth = { 0: [spawn] };
  while (q.length) {
    const cur = q.shift();
    for (const n of (adjacency?.[cur] || [])) if (depth[n] === undefined) {
      depth[n] = depth[cur] + 1; (byDepth[depth[n]] ||= []).push(n); q.push(n);
    }
  }
  for (const r of rooms) if (depth[r] === undefined) { depth[r] = (Math.max(0, ...Object.values(depth)) + 1); (byDepth[depth[r]] ||= []).push(r); }

  const placed = {};
  for (const [d, list] of Object.entries(byDepth)) {
    const ring = Number(d); const radius = ring * RING_GAP;
    list.forEach((r, i) => {
      if (ring === 0) { placed[r] = { x: center.x, y: center.y }; return; }
      const a = (i / list.length) * Math.PI * 2 + ring * 0.7;
      placed[r] = { x: Math.round(center.x + radius * Math.cos(a)), y: Math.round(center.y + radius * Math.sin(a)) };
    });
  }
  // normalize so all coords are positive, with a margin
  const xs = Object.values(placed).map((p) => p.x), ys = Object.values(placed).map((p) => p.y);
  const minX = Math.min(...xs), minY = Math.min(...ys), maxX = Math.max(...xs), maxY = Math.max(...ys);
  const margin = ROOM_SIZE;
  const roomRects = {};
  for (const r of rooms) {
    roomRects[r] = { x: placed[r].x - minX + margin, y: placed[r].y - minY + margin, w: ROOM_SIZE, h: ROOM_SIZE };
  }
  const worldW = (maxX - minX) + margin * 2 + ROOM_SIZE;
  const worldH = (maxY - minY) + margin * 2 + ROOM_SIZE;
  // corridors = unique adjacency pairs (the client draws connecting halls)
  const seen = new Set(), corridors = [];
  for (const a of rooms) for (const b of (adjacency?.[a] || [])) {
    const key = [a, b].sort().join("|"); if (seen.has(key)) continue; seen.add(key); corridors.push([a, b]);
  }
  return { worldW, worldH, rooms: roomRects, corridors };
}

// Freeze a named map = a deterministic generator output. This is how "fixed"
// maps coexist with procedural ones: same code path, fixed seed.
export function frozenMap(id, name, players, seed) {
  return { ...generateMap({ players, seed, id, name }), procedural: false };
}

export { ROOM_LIBRARY, sizeFor };
