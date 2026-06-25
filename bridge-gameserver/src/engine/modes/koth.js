// ============================================================
// KING OF THE HILL.
// One room is the "hill". Players standing in it accrue score each tick: being
// ALONE earns the full rate; when several share it, the rate is SPLIT among them
// (so holding it solo is best, but a lone king is easy to contest). First to the
// score threshold wins. Cable-pull is repurposed as a non-lethal shove: it drops
// the target to 25% air, forcing them to leave and refill — a way to clear the
// hill without killing. A player only goes down if they let air hit zero.
// Replaces base win conditions.
// ============================================================

import { ROLE, PLANE, WINNER, OXYGEN } from "../constants.js";

const SCORE_PER_SEC = 1;     // full rate when alone on the hill
const SCORE_TO_WIN = 100;    // first to this wins
const SHOVE_OXYGEN = OXYGEN.MAX * 0.25; // cable-pull knocks target down to 25%

export const KingOfTheHillMode = {
  id: "koth",
  label: "King of the Hill",

  onMatchStart(engine) {
    // Everyone is a plain contender; no impostors. Pick the hill room.
    for (const p of engine.players.values()) { p.role = ROLE.CREW; p.kothScore = 0; }
    const rooms = engine.map.rooms || [];
    engine.kothRoom = rooms[Math.floor(engine.rng() * rooms.length)] || engine.map.spawnRoom;
    engine.kothWin = SCORE_TO_WIN;
    engine._log("koth_hill", { room: engine.kothRoom, target: SCORE_TO_WIN });
  },

  // Cable-pull becomes a non-lethal shove (handled here so the engine's lethal
  // down path is bypassed). Returning true tells the engine we fully handled it.
  onShove(engine, target) {
    target.oxygen = Math.min(target.oxygen, SHOVE_OXYGEN);
    engine._log("koth_shove", { id: target.id, oxygen: target.oxygen, private: true });
    return true;
  },

  tick(engine, dt) {
    // Tally who's on the hill (still on the physical plane).
    const onHill = [...engine.players.values()].filter((p) => p.plane === PLANE.PHYSICAL && p.room === engine.kothRoom);
    if (onHill.length > 0) {
      const rate = (SCORE_PER_SEC * dt) / onHill.length; // shared splits the tick
      for (const p of onHill) {
        p.kothScore = (p.kothScore || 0) + (onHill.length === 1 ? SCORE_PER_SEC * dt : rate);
      }
    }
  },

  checkWin(engine) {
    // A leader reaching the threshold wins.
    let best = null;
    for (const p of engine.players.values()) if (!best || (p.kothScore || 0) > (best.kothScore || 0)) best = p;
    if (best && (best.kothScore || 0) >= (engine.kothWin || SCORE_TO_WIN)) {
      return { winner: WINNER.CREW, reason: "koth_reached", meta: { winnerId: best.id, score: Math.round(best.kothScore) } };
    }
    // If only one contender remains standing (others all suffocated), they win.
    const standing = [...engine.players.values()].filter((p) => p.plane === PLANE.PHYSICAL);
    if (standing.length === 1) return { winner: WINNER.CREW, reason: "koth_last_standing", meta: { winnerId: standing[0].id } };
    return null;
  },
};
