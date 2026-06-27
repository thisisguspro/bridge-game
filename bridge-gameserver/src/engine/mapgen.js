// ============================================================
// MODULAR MAP GENERATOR (v0.2 — DONUT LAYOUT)
// The ship is a circular ring of corridor segments forming a continuous hallway.
// Fixed rooms (Helm, Reactor, Airlock/Space) occupy known positions on the ring.
// Functional rooms branch off the ring on either side, each connecting at 2
// points so there are always 2 ways in/out. Turrets sit on the outer perimeter.
//
// Layout rules enforced:
//   - Guaranteed connectivity: every room reachable (ring is a cycle).
//   - No single-exit rooms: branching rooms connect at 2 ring nodes.
//   - Donut topology: a central corridor ring with branches — creates natural
//     chokepoints and patrol loops.
//   - Distance constraints: refill rooms spread out; turrets on perimeter.
//   - Scaling: room count, turrets, and refills scale with player count.
// ============================================================

import { makeRng } from "./rng.js";

// ---- Room library: each entry is a TYPE with roles it can fill. ----
// `kind`: hub (corridor/connective), function (tasks + a system role), utility.
// `roles`: which special functions this room can serve (refill/turret/repair).
const ROOM_LIBRARY = [
  { type: "Helm",         kind: "hub",      roles: [],                     weight: 0, fixed: true },
  { type: "Corridor",     kind: "hub",      roles: [],                     weight: 3 },
  { type: "Junction",     kind: "hub",      roles: [],                     weight: 2 },
  { type: "Engineering",  kind: "function", roles: ["refill", "repair"],   weight: 2 },
  { type: "Reactor",      kind: "function", roles: ["repair"],             weight: 2, fixed: true },
  { type: "Sensors",      kind: "function", roles: [],                     weight: 2 },
  { type: "Medbay",       kind: "function", roles: ["refill"],             weight: 2 },
  { type: "Cargo",        kind: "function", roles: ["repair"],             weight: 1 },
  { type: "Hangar",       kind: "function", roles: ["refill"],             weight: 1 },
  { type: "Comms Array",  kind: "function", roles: [],                     weight: 1 },
  { type: "Labs",         kind: "function", roles: [],                     weight: 1 },
  { type: "Galley",       kind: "function", roles: ["refill"],             weight: 1 },
  { type: "Storage",      kind: "function", roles: [],                     weight: 1 },
  { type: "Airlock",      kind: "function", roles: [],                     weight: 0, fixed: true },
  { type: "Space",        kind: "function", roles: [],                     weight: 0, fixed: true },
];

// Scale targets by player count. Returns the shape of the map to build.
function sizeFor(players) {
  const impostors = players <= 10 ? 1 : 2;
  const crew = players - impostors;
  const totalRandomRooms = (impostors + 1) + Math.floor(crew / 2);
  
  // At least 2 turrets, or 2x impostor count
  const turrets = Math.max(2, impostors * 2);
  // The rest of the random rooms are functional task rooms
  const functional = Math.max(0, totalRandomRooms - turrets);

  const refills = Math.max(1, Math.round(functional / 3));
  const repairs = Math.max(1, Math.round(functional / 4));
  return { players, impostors, functional, turrets, refills, repairs };
}

// Pick N function-room types by weight without repeating until the library is
// exhausted (then it allows repeats with a numeric suffix for variety).
// Excludes fixed rooms (Reactor, Airlock, Space) since they're placed separately.
function pickFunctionRooms(rng, n) {
  const pool = ROOM_LIBRARY.filter((r) => r.kind === "function" && !r.fixed);
  const chosen = [];
  const counts = {};
  for (let i = 0; i < n; i++) {
    const total = pool.reduce((a, r) => a + r.weight, 0);
    let roll = rng() * total, pick = pool[0];
    for (const r of pool) { roll -= r.weight; if (roll <= 0) { pick = r; break; } }
    counts[pick.type] = (counts[pick.type] || 0) + 1;
    const name = counts[pick.type] === 1 ? pick.type : `${pick.type} ${counts[pick.type]}`;
    chosen.push({ ...pick, name });
  }
  return chosen;
}

// Build the donut-shaped connection graph:
// 1) Place N corridor nodes in a ring (sequential loop: 1->2->...->N->1).
// 2) Place Helm at the top (node 0) and Reactor at the bottom (node N/2).
// 3) Place Airlock on the ring; Space connects only to Airlock.
// 4) Branch functional rooms off the ring, each connecting to 2 adjacent nodes.
// 5) Turrets hang off the outer perimeter.
function buildGraph(rng, size, functions, turretNames) {
  const adj = {};
  const link = (a, b) => { (adj[a] ||= new Set()).add(b); (adj[b] ||= new Set()).add(a); };

  const spawn = "Helm";
  const reactor = "Reactor";

  // Combine functional rooms, turrets, and Airlock
  const pathRooms = [...functions.map((f) => f.name), ...turretNames, "Airlock"];
  
  // Shuffle them using rng
  for (let i = pathRooms.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pathRooms[i], pathRooms[j]] = [pathRooms[j], pathRooms[i]];
  }

  // Split path rooms into top and bottom chains
  const topPath = [];
  const bottomPath = [];
  pathRooms.forEach((r, i) => {
    if (i % 2 === 0) topPath.push(r);
    else bottomPath.push(r);
  });

  // Initialize adjacency maps
  const allRooms = [spawn, reactor, "Space", ...pathRooms];
  for (const r of allRooms) adj[r] = new Set();

  if (topPath.length > 0) {
    link(reactor, topPath[0]);
    for (let i = 0; i < topPath.length - 1; i++) {
      link(topPath[i], topPath[i + 1]);
    }
    link(topPath[topPath.length - 1], spawn);
  } else {
    link(reactor, spawn);
  }

  if (bottomPath.length > 0) {
    link(reactor, bottomPath[0]);
    for (let i = 0; i < bottomPath.length - 1; i++) {
      link(bottomPath[i], bottomPath[i + 1]);
    }
    link(bottomPath[bottomPath.length - 1], spawn);
  } else {
    link(reactor, spawn);
  }

  // Space connects only to Airlock
  link("Airlock", "Space");

  // Convert sets to arrays
  const out = {};
  for (const r of allRooms) out[r] = [...(adj[r] || [])];
  
  return { adjacency: out, rooms: allRooms, topPath, bottomPath };
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

  const spawn = "Helm";
  const functions = pickFunctionRooms(rng, size.functional);
  const turretNames = ["Turret Alpha", "Turret Beta", "Turret Gamma", "Turret Delta", "Turret Epsilon", "Turret Zeta"];
  const turrets = [];
  for (let i = 0; i < size.turrets; i++) turrets.push(turretNames[i] || `Turret ${i + 1}`);

  let graph = buildGraph(rng, size, functions, turrets);
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
    const picks = []; const step = Math.max(1, Math.floor(candidates.length / count));
    for (let i = 0; i < candidates.length && picks.length < count; i += step) picks.push(candidates[i]);
    for (const c of candidates) if (picks.length < count && !picks.includes(c)) picks.push(c);
    return picks;
  };
  const refillRooms = spread(byRole("refill"), size.refills);
  const repairRooms = spread(byRole("repair"), size.repairs);
  // Fallback: ensure at least 2 of each even if the library draw was unlucky.
  while (refillRooms.length < 2 && functions[refillRooms.length]) refillRooms.push(functions[refillRooms.length].name);
  while (repairRooms.length < 2 && functions[repairRooms.length]) repairRooms.push(functions[repairRooms.length].name);

  // ---- spatial layout: dual-path geometry ----
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

// Build geometry: places rooms cleanly in two horizontal paths between Reactor (left) and Helm (right)
const ROOM_SIZE = 1200;       // world units per room box
const CENTER = { x: 8000, y: 8000 };
const H_STEP = 1800;          // horizontal spacing between room centers (was 2400)
const V_OFFSET = 1200;        // vertical offset of paths from center line (was 1800)

export function buildGeometry(rooms, adjacency, spawn) {
  const reactor = "Reactor";
  const helm = "Helm";

  // Trace the paths from Reactor to Helm
  const reactorNeighbors = (adjacency[reactor] || []);
  const paths = [];
  const visited = new Set([reactor, helm, "Space"]);

  for (const startRoom of reactorNeighbors) {
    if (visited.has(startRoom)) continue;
    const path = [];
    let curr = startRoom;
    while (curr && !visited.has(curr)) {
      path.push(curr);
      visited.add(curr);
      const neighbors = (adjacency[curr] || []).filter(n => !visited.has(n));
      curr = neighbors[0] || null;
    }
    paths.push(path);
  }

  const topPath = paths[0] || [];
  const bottomPath = paths[1] || [];
  const numCols = Math.max(topPath.length, bottomPath.length);

  const placed = {};

  // Place Reactor at the far left
  placed[reactor] = {
    x: Math.round(CENTER.x - (numCols / 2 + 1.0) * H_STEP),
    y: CENTER.y,
  };

  // Place Helm at the far right
  placed[helm] = {
    x: Math.round(CENTER.x + (numCols / 2 + 1.0) * H_STEP),
    y: CENTER.y,
  };

  // Place topPath rooms horizontally
  topPath.forEach((r, i) => {
    const colOffset = (numCols - topPath.length) / 2;
    placed[r] = {
      x: Math.round(CENTER.x - (numCols / 2 - (i + colOffset) - 0.5) * H_STEP),
      y: CENTER.y - V_OFFSET,
    };
  });

  // Place bottomPath rooms horizontally
  bottomPath.forEach((r, i) => {
    const colOffset = (numCols - bottomPath.length) / 2;
    placed[r] = {
      x: Math.round(CENTER.x - (numCols / 2 - (i + colOffset) - 0.5) * H_STEP),
      y: CENTER.y + V_OFFSET,
    };
  });

  // Place Space directly touching Airlock (no gap/corridor)
  if (rooms.includes("Space")) {
    const airlockPos = placed["Airlock"];
    if (airlockPos) {
      const isTop = topPath.includes("Airlock");
      placed["Space"] = {
        x: airlockPos.x - 600,
        y: isTop ? airlockPos.y - 2400 : airlockPos.y + 1200,
      };
    } else {
      placed["Space"] = { x: CENTER.x - 600, y: CENTER.y - 2400 };
    }
  }

  // Guarantee placement for any stray rooms
  for (const r of rooms) {
    if (!placed[r]) {
      placed[r] = { x: CENTER.x, y: CENTER.y };
    }
  }

  // --- Normalize coordinates ---
  const xs = Object.values(placed).map((p) => p.x);
  const ys = Object.values(placed).map((p) => p.y);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const maxX = Math.max(...xs), maxY = Math.max(...ys);
  const margin = ROOM_SIZE;

  const roomRects = {};
  for (const r of rooms) {
    const p = placed[r];
    const rSize = r === "Space" ? 2400 : ROOM_SIZE;
    roomRects[r] = {
      x: p.x - minX + margin,
      y: p.y - minY + margin,
      w: rSize,
      h: rSize,
    };
  }

  const worldW = (maxX - minX) + margin * 2 + ROOM_SIZE;
  const worldH = (maxY - minY) + margin * 2 + ROOM_SIZE;

  // Corridors = unique adjacency pairs
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
