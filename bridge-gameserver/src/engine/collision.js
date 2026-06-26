// Furniture / obstacle collision.
//
// The actual furniture is painted into each room's art, so we can't trace it
// pixel-perfectly (and the art will change). Instead we hand-author approximate
// rectangular BLOCKERS per room TYPE, expressed as fractions of the room box
// (0..1 in x/y/w/h). They're placed to roughly match the reference art's big
// obstacles (console banks, tables, reactor core, locker rows, beds, crates).
// This is the standard way 2D games do collision: invisible designer rects, not
// sprite tracing. Tune these by eye against the art; they don't need to be exact.
//
// A player is modeled as a small circle (PLAYER_RADIUS, in world units). Movement
// is resolved by trying the full step, then axis-separated steps (so you slide
// along walls instead of sticking).

export const PLAYER_RADIUS = 9;

// Each entry: array of { x, y, w, h } in 0..1 room-fraction coordinates.
// Keep a clear walking lane (rooms are pass-throughs with doors on two sides),
// so blockers hug the edges/center but never seal the room.
const BLOCKERS_BY_TYPE = {
  // Helm: console bank across the front under the viewscreen + slim side consoles.
  // Kept clear through the middle/bottom so players can reach the single door.
  Helm: [
    { x: 0.28, y: 0.08, w: 0.44, h: 0.12 }, // main console under viewscreen (top)
    { x: 0.06, y: 0.22, w: 0.10, h: 0.20 }, // left console (upper)
    { x: 0.84, y: 0.22, w: 0.10, h: 0.20 }, // right console (upper)
  ],
  // Reactor: glowing core in the middle — a solid round-ish block (boxed).
  Reactor: [
    { x: 0.34, y: 0.34, w: 0.32, h: 0.32 }, // core
  ],
  // Engineering: machine bank + pipes along the right and a central workbench.
  Engineering: [
    { x: 0.40, y: 0.34, w: 0.26, h: 0.22 }, // workbench
    { x: 0.78, y: 0.20, w: 0.16, h: 0.55 }, // pipe/machine wall (right)
  ],
  // Sensors: round dish console — shifted UP so the mid-lane (doorway height) is clear.
  Sensors: [
    { x: 0.34, y: 0.10, w: 0.32, h: 0.30 }, // radar dish console (upper)
  ],
  // Medbay: scanning beds in the four quadrants (mid-lane between them stays clear).
  Medbay: [
    { x: 0.10, y: 0.12, w: 0.24, h: 0.14 }, { x: 0.66, y: 0.12, w: 0.24, h: 0.14 },
    { x: 0.10, y: 0.74, w: 0.24, h: 0.14 }, { x: 0.66, y: 0.74, w: 0.24, h: 0.14 },
  ],
  // Cargo: crates kept out of the central horizontal lane.
  Cargo: [
    { x: 0.10, y: 0.10, w: 0.16, h: 0.16 }, { x: 0.74, y: 0.10, w: 0.16, h: 0.16 },
    { x: 0.42, y: 0.08, w: 0.16, h: 0.16 }, { x: 0.12, y: 0.72, w: 0.16, h: 0.16 },
    { x: 0.72, y: 0.72, w: 0.16, h: 0.16 }, { x: 0.42, y: 0.72, w: 0.16, h: 0.16 },
  ],
  // Hangar: mostly open landing pad — light blockers at the corners.
  Hangar: [
    { x: 0.06, y: 0.06, w: 0.14, h: 0.14 }, { x: 0.80, y: 0.06, w: 0.14, h: 0.14 },
  ],
  // Comms Array: holo + transmitter banks, shifted up off the mid-lane.
  "Comms Array": [
    { x: 0.38, y: 0.10, w: 0.24, h: 0.16 }, // holo globe
    { x: 0.12, y: 0.12, w: 0.14, h: 0.22 }, { x: 0.74, y: 0.12, w: 0.14, h: 0.22 },
  ],
  // Labs: benches along top edge, keeping the mid-lane clear.
  Labs: [
    { x: 0.06, y: 0.10, w: 0.30, h: 0.22 }, // left bench (upper)
    { x: 0.62, y: 0.10, w: 0.30, h: 0.22 }, // right equipment (upper)
  ],
  // Galley: tables kept above/below the central aisle.
  Galley: [
    { x: 0.50, y: 0.12, w: 0.16, h: 0.16 }, { x: 0.74, y: 0.12, w: 0.16, h: 0.16 },
    { x: 0.50, y: 0.72, w: 0.16, h: 0.16 }, { x: 0.74, y: 0.72, w: 0.16, h: 0.16 },
    { x: 0.10, y: 0.10, w: 0.22, h: 0.14 }, // counter (top-left)
  ],
  // Storage: locker rows along top and bottom; center aisle clear (mid-lane open).
  Storage: [
    { x: 0.10, y: 0.08, w: 0.80, h: 0.16 }, // top locker row
    { x: 0.10, y: 0.76, w: 0.80, h: 0.16 }, // bottom locker row
  ],
  // Airlock: door mechanisms top corners; lower/center lane to the hatch clear.
  Airlock: [
    { x: 0.08, y: 0.10, w: 0.18, h: 0.26 }, // left door mechanism (upper)
    { x: 0.74, y: 0.10, w: 0.18, h: 0.26 }, // right door mechanism (upper)
  ],
  // Turret: the gun chair + console block, shifted up off the entry lane.
  Turret: [
    { x: 0.34, y: 0.10, w: 0.32, h: 0.28 }, // turret console + seat (upper)
  ],
};

// Strip any trailing " 2"/" 3" suffix the generator adds to duplicate rooms.
function baseType(roomName) {
  return roomName.replace(/\s+\d+$/, "");
}

// Return world-space blocker rects for a given room name, using its room box.
export function blockersForRoom(roomName, roomRect) {
  const fracs = BLOCKERS_BY_TYPE[baseType(roomName)] || [];
  return fracs.map((f) => ({
    x: roomRect.x + f.x * roomRect.w,
    y: roomRect.y + f.y * roomRect.h,
    w: f.w * roomRect.w,
    h: f.h * roomRect.h,
  }));
}

// Does a circle at (cx,cy) r overlap an axis-aligned rect?
function circleHitsRect(cx, cy, r, rect) {
  const nx = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
  const ny = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
  const dx = cx - nx, dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}

// True if a player-circle at (x,y) collides with any blocker in `rects`.
export function blocked(x, y, rects, r = PLAYER_RADIUS) {
  for (const rect of rects) if (circleHitsRect(x, y, r, rect)) return true;
  return false;
}

// Resolve a move from (x,y) to (nx,ny) against blockers: try full move, then
// slide on each axis independently so the player grazes obstacles smoothly.
// Returns the allowed { x, y }.
export function resolveMove(x, y, nx, ny, rects, r = PLAYER_RADIUS) {
  if (!rects.length || !blocked(nx, ny, rects, r)) return { x: nx, y: ny };
  // try horizontal-only, then vertical-only
  const hx = !blocked(nx, y, rects, r) ? nx : x;
  const vy = !blocked(hx, ny, rects, r) ? ny : y;
  return { x: hx, y: vy };
}

// Find a standable point near (x,y) that isn't inside a blocker — used for spawn
// and room-center targeting so players never start/teleport stuck in furniture.
// Spirals outward in a few rings; falls back to the original point if all blocked.
export function nearestFree(x, y, rects, r = PLAYER_RADIUS) {
  if (!rects.length || !blocked(x, y, rects, r)) return { x, y };
  const step = r * 1.5;
  for (let ring = 1; ring <= 8; ring++) {
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * Math.PI * 2;
      const px = x + Math.cos(ang) * step * ring;
      const py = y + Math.sin(ang) * step * ring;
      if (!blocked(px, py, rects, r)) return { x: px, y: py };
    }
  }
  return { x, y };
}
