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

const ROOM_SIZE = 720;   // large rooms so the (fixed-size) character sprite reads as small inside
const CORRIDOR_LEN = 360;

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

  // number of corridor segments: roughly half the attached rooms (two rooms per
  // corridor node, one on each side), min 2 so the spine has length.
  const corridorCount = Math.max(2, Math.ceil(attach.length / 2));
  const corridors = [];
  for (let i = 0; i < corridorCount; i++) corridors.push(`Corridor ${i + 1}`);

  // ----- build adjacency -----
  const adj = {};
  const allRooms = [spawn, ...corridors, ...attach.map((a) => a.name), reactor];
  for (const r of allRooms) adj[r] = [];
  const link = (a, b) => { if (a !== b && !adj[a].includes(b)) { adj[a].push(b); adj[b].push(a); } };

  // spine: Helm - C1 - C2 - ... - Cn - Reactor  (Helm & Reactor single-entrance)
  link(spawn, corridors[0]);
  for (let i = 0; i < corridors.length - 1; i++) link(corridors[i], corridors[i + 1]);
  link(corridors[corridors.length - 1], reactor);

  // attach rooms to corridor nodes; give each TWO entrances by linking it to two
  // adjacent corridor nodes when possible (pass-through), else to one corridor +
  // the next attached sibling so it still has two doors.
  const entrances = {}; // room -> array of neighbor room names that are its doors
  attach.forEach((room, idx) => {
    const cIdx = idx % corridors.length;
    const cA = corridors[cIdx];
    const cB = corridors[(cIdx + 1) % corridors.length];
    link(room.name, cA);
    if (cB !== cA) link(room.name, cB);
    entrances[room.name] = [...adj[room.name]];
  });
  entrances[spawn] = [...adj[spawn]];        // single entrance
  entrances[reactor] = [...adj[reactor]];    // single entrance

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

// Place rooms on a world grid. Spine runs left->right (Helm at far left, Reactor
// far right). Corridor nodes sit on the centerline; attached rooms alternate
// above/below their corridor. Returns {worldW, worldH, rooms:{name:{x,y,w,h}}, corridors:[[a,b]]}.
function layoutShip(spawn, corridors, attach, reactor, adj) {
  const rects = {};
  const gapX = ROOM_SIZE + CORRIDOR_LEN;
  const centerY = 0;
  let x = 0;
  // Helm at left
  rects[spawn] = { x, y: centerY };
  x += gapX;
  // corridor nodes along the centerline
  corridors.forEach((c) => { rects[c] = { x, y: centerY }; x += gapX; });
  // Reactor at the far right end
  rects[reactor] = { x, y: centerY };

  // attached rooms: above/below the corridor they're linked to
  const sideCounter = {};
  attach.forEach((room) => {
    // find a corridor neighbor to anchor under
    const corr = (adj[room.name] || []).find((n) => n.startsWith("Corridor")) || corridors[0];
    const base = rects[corr] || { x: gapX, y: centerY };
    const n = (sideCounter[corr] = (sideCounter[corr] || 0) + 1);
    const above = n % 2 === 1;
    const tier = Math.ceil(n / 2);
    rects[room.name] = { x: base.x, y: centerY + (above ? -1 : 1) * tier * (ROOM_SIZE + CORRIDOR_LEN) };
  });

  // normalize to positive coords with a margin
  const margin = ROOM_SIZE;
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
    const key = [a, b].sort().join("|"); if (seen.has(key)) continue; seen.add(key); corr.push([a, b]);
  }
  return { worldW, worldH, rooms: out, corridors: corr };
}
