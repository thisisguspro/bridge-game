// BRIDGE v2 ship generator — implements the design spec:
//
//  • Helm is the spawn room at one END of a central corridor spine; it has a
//    SINGLE entrance (a dead-end). The Reactor sits at the FAR end, also a single
//    entrance dead-end. These two anchors are fixed every match.
//  • Between them runs a spine of Corridor segments. The other rooms hang off the
//    corridors, each with TWO entrances (a corridor link on each side) so they're
//    pass-through, never dead-ends (Helm/Reactor are the only dead-ends).
//  • Room count ramps with player count but is always >= 4 functional rooms.
//  • Turrets always number >= 2x the impostor count; only one player may occupy a
//    turret at a time (enforced in the engine, not here).
//  • Every match includes an Airlock (the outside/tether mechanic lives there).
//
// Output matches the shape the engine + renderer already consume (rooms,
// adjacency, geometry {worldW,worldH,rooms:{x,y,w,h},corridors}, role room lists,
// spawnRoom, turretRooms, etc.) plus new fields: deadEndRooms, airlockRoom,
// entrances (per-room entrance sides for rendering doors).

import { makeRng } from "./rng.js";

const ROOM_SIZE = 460;   // fills the view at the current zoom; big enough that the sprite reads small, not a barren void
const CORRIDOR_LEN = 90;  // short gaps so rooms sit close with fat, easy-to-walk connections

// Functional room types that can appear in the random middle. Helm/Reactor/Airlock
// are placed specially, so they're not in this pool. roles drive refill/repair.
const FUNCTION_ROOMS = [
  { type: "Engineering", roles: ["refill", "repair"], weight: 3 },
  { type: "Sensors",     roles: [],                   weight: 2 },
  { type: "Medbay",      roles: ["refill"],           weight: 3 },
  { type: "Cargo",       roles: ["repair"],           weight: 2 },
  { type: "Hangar",      roles: ["refill"],           weight: 1 },
  { type: "Comms Array", roles: [],                   weight: 1 },
  { type: "Labs",        roles: [],                   weight: 2 },
  { type: "Galley",      roles: ["refill"],           weight: 2 },
  { type: "Storage",     roles: [],                   weight: 2 },
];

function impostorsFor(players) { return players <= 6 ? 1 : players <= 13 ? 2 : 3; }

// How many functional (middle) rooms for a given player count: ramps up, min 4.
function functionalCountFor(players) {
  return Math.max(4, Math.round(players * 0.7));
}

function weightedPick(rng, pool) {
  const total = pool.reduce((a, r) => a + r.weight, 0);
  let roll = rng() * total;
  for (const r of pool) { roll -= r.weight; if (roll <= 0) return r; }
  return pool[pool.length - 1];
}

export function generateShip({ players = 8, seed = null, id = null, name = null } = {}) {
  const rng = makeRng(seed);
  const impostors = impostorsFor(players);
  const turretCount = Math.max(2, impostors * 2);     // >= 2x impostors
  const funcCount = functionalCountFor(players);

  // ----- pick the functional rooms (no repeats until pool exhausted) -----
  const pool = FUNCTION_ROOMS.map((r) => ({ ...r }));
  const chosen = [];
  const counts = {};
  for (let i = 0; i < funcCount; i++) {
    const pick = weightedPick(rng, pool);
    counts[pick.type] = (counts[pick.type] || 0) + 1;
    const nm = counts[pick.type] === 1 ? pick.type : `${pick.type} ${counts[pick.type]}`;
    chosen.push({ ...pick, name: nm });
  }

  // ----- assemble the ordered list of ALL rooms along/around the spine -----
  // The spine is a line of corridor nodes. Helm caps one end, Reactor the other.
  // Functional rooms + turrets + the airlock attach to corridor nodes as
  // two-entrance pass-throughs (modeled as their own nodes linked to two corridor
  // segments where possible, or one corridor + a sibling room).
  const spawn = "Helm";
  const reactor = "Reactor";
  const airlock = "Airlock";

  // attachable rooms = functional + turrets + airlock
  const turretNames = [];
  for (let i = 0; i < turretCount; i++) turretNames.push(turretCount === 1 ? "Turret" : `Turret ${i + 1}`);
  const attach = [
    ...chosen.map((c) => ({ name: c.name, roles: c.roles, kind: "function" })),
    ...turretNames.map((n) => ({ name: n, roles: [], kind: "turret" })),
    { name: airlock, roles: [], kind: "airlock" },
  ];
  // shuffle attach order so the ship differs each match
  for (let i = attach.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [attach[i], attach[j]] = [attach[j], attach[i]]; }

  // ----- build adjacency (two-row ladder; no separate corridor-node rooms) -----
  // Layout: Reactor (left cap) — [col0 top/bottom] — [col1 t/b] — ... — Helm (right cap).
  // We link: reactor->leftmost column rooms, helm->rightmost column rooms, each
  // room to its horizontal neighbor in the same row, and top<->bottom within a column.
  const adj = {};
  const allRooms = [spawn, ...attach.map((a) => a.name), reactor];
  for (const r of allRooms) adj[r] = [];
  const link = (a, b) => { if (a && b && a !== b && !adj[a].includes(b)) { adj[a].push(b); adj[b].push(a); } };

  const middle = attach.map((a) => a.name);
  const cols = Math.max(1, Math.ceil(middle.length / 2));
  // grid[row][col] = room name
  const grid = [[], []];
  middle.forEach((name, i) => { const row = i < cols ? 0 : 1; grid[row][i % cols] = name; });

  for (let c = 0; c < cols; c++) {
    const top = grid[0][c], bot = grid[1][c];
    // vertical link within a column (the ladder rungs)
    if (top && bot) link(top, bot);
    // horizontal links along each row
    if (c > 0) { link(grid[0][c - 1], grid[0][c]); link(grid[1][c - 1], grid[1][c]); }
  }
  // end-caps connect to the nearest column (both rows)
  link(reactor, grid[0][0]); link(reactor, grid[1][0]);
  link(spawn, grid[0][cols - 1]); link(spawn, grid[1][cols - 1]);

  const corridors = []; // no node-rooms anymore; corridors are derived from adj pairs
  const entrances = {};
  for (const r of allRooms) entrances[r] = [...adj[r]];

  // ----- role room lists -----
  const refillRooms = attach.filter((a) => a.roles.includes("refill")).map((a) => a.name);
  const repairRooms = [reactor, ...attach.filter((a) => a.roles.includes("repair")).map((a) => a.name)];
  // guarantee at least 2 of each
  const funcNames = attach.filter((a) => a.kind === "function").map((a) => a.name);
  let fi = 0;
  while (refillRooms.length < 2 && fi < funcNames.length) { if (!refillRooms.includes(funcNames[fi])) refillRooms.push(funcNames[fi]); fi++; }
  fi = 0;
  while (repairRooms.length < 2 && fi < funcNames.length) { if (!repairRooms.includes(funcNames[fi])) repairRooms.push(funcNames[fi]); fi++; }

  // ----- geometry: lay the spine horizontally, attached rooms above/below -----
  const geometry = layoutShip(spawn, corridors, attach, reactor, adj);

  return {
    id: id || `ship_${players}p_${seed ?? "rand"}`,
    name: name || `Star Vessel (${players}p)`,
    tier: players <= 10 ? "small" : "large",
    procedural: true,
    minPlayers: Math.max(4, Math.min(5, players)),
    maxPlayers: players,
    impostors,
    rooms: allRooms,
    adjacency: adj,
    geometry,
    refillRooms,
    repairRooms,
    turretRooms: turretNames,
    deadEndRooms: [spawn, reactor],   // single-entrance anchors
    airlockRoom: airlock,
    entrances,                        // per-room door neighbors (for rendering)
    spawnRoom: spawn,
    reactorRoom: reactor,
    tasksPerRoom: players <= 10 ? 2 : 3,
    sabotageCooldownSeconds: 25,
    cablePullCooldownSeconds: 40,
    hullMax: 150,
  };
}

// Place rooms to match the intended ship shape (per design sketch):
//   - Reactor is a big end-cap on the far LEFT, vertically centered.
//   - Helm is a big end-cap on the far RIGHT, vertically centered.
//   - All functional rooms sit BETWEEN them in two rows (top + bottom),
//     spread across evenly-spaced columns — like a ladder.
//   - Corridors are thin connectors (drawn as bands), not rooms.
// Returns {worldW, worldH, rooms:{name:{x,y,w,h}}, corridors:[[a,b]]}.
function layoutShip(spawn, corridors, attach, reactor, adj) {
  const rects = {};
  const colGap = ROOM_SIZE + CORRIDOR_LEN;   // horizontal spacing between columns
  const rowGap = ROOM_SIZE + CORRIDOR_LEN;   // vertical gap between the two rows

  // The functional rooms are everything except the two end-caps. (Corridor nodes
  // from the old scheme are treated as functional cells too, so the count works.)
  const middle = attach.map((r) => r.name);
  const cols = Math.max(1, Math.ceil(middle.length / 2));
  const topY = -rowGap / 2 - ROOM_SIZE / 2;  // top row center band
  const botY = rowGap / 2 + ROOM_SIZE / 2;

  // columns x-positions start after the reactor end-cap
  const firstColX = colGap;
  // place middle rooms: fill top row left->right, then bottom row
  middle.forEach((name, i) => {
    const col = i % cols;
    const row = i < cols ? 0 : 1; // first `cols` go top, rest bottom
    rects[name] = { x: firstColX + col * colGap, y: row === 0 ? topY : botY };
  });

  // end-caps, vertically centered on the ladder
  const lastColX = firstColX + (cols - 1) * colGap;
  rects[reactor] = { x: 0, y: 0 - ROOM_SIZE / 2 + 0 };          // far left, centered
  rects[spawn]   = { x: lastColX + colGap, y: 0 - ROOM_SIZE / 2 }; // far right (Helm)

  // normalize to positive coords with a margin
  const margin = ROOM_SIZE * 0.6;
  const xs = Object.values(rects).map((r) => r.x), ys = Object.values(rects).map((r) => r.y);
  const minX = Math.min(...xs), minY = Math.min(...ys), maxX = Math.max(...xs), maxY = Math.max(...ys);
  const out = {};
  for (const [k, r] of Object.entries(rects)) {
    out[k] = { x: r.x - minX + margin, y: r.y - minY + margin, w: ROOM_SIZE, h: ROOM_SIZE };
  }
  const worldW = (maxX - minX) + margin * 2 + ROOM_SIZE;
  const worldH = (maxY - minY) + margin * 2 + ROOM_SIZE;

  // corridors list = unique adjacency pairs (client draws halls between doors)
  const seen = new Set(), corr = [];
  for (const a of Object.keys(adj)) for (const b of adj[a]) {
    if (!out[a] || !out[b]) continue;
    const key = [a, b].sort().join("|"); if (seen.has(key)) continue; seen.add(key); corr.push([a, b]);
  }
  return { worldW, worldH, rooms: out, corridors: corr };
}
