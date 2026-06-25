// ============================================================
// HOT POTATO.
// One player holds the potato — a bomb on a countdown. The holder passes it with
// an action button to another player in the same room. When the timer hits zero,
// the current holder is DOWNED and a fresh potato is handed to a random survivor
// with a new (slightly shorter) timer. Last player standing wins. Replaces base
// win conditions.
// ============================================================

import { ROLE, PLANE, WINNER } from "../constants.js";

const START_FUSE = 20;   // seconds on the first potato
const MIN_FUSE = 8;      // floor as it speeds up
const FUSE_STEP = 2;     // shave per round

export const HotPotatoMode = {
  id: "hotpotato",
  label: "Hot Potato",

  onMatchStart(engine) {
    for (const p of engine.players.values()) p.role = ROLE.CREW;
    const ids = [...engine.players.keys()];
    engine.potatoFuseLen = START_FUSE;
    engine.potatoHolder = ids[Math.floor(engine.rng() * ids.length)];
    engine.potatoExplodesAt = engine.now + engine.potatoFuseLen;
    engine._log("potato_spawn", { holder: engine.potatoHolder, fuse: engine.potatoFuseLen });
  },

  // Pass the potato to a player in the same room (called by the engine's
  // pass_potato action). Returns true on a successful pass.
  onPass(engine, fromId, toId) {
    if (engine.potatoHolder !== fromId) throw new Error("You don't have the potato.");
    const from = engine.players.get(fromId), to = engine.players.get(toId);
    if (!to || to.plane !== PLANE.PHYSICAL) throw new Error("Can't pass to them.");
    if (to.room !== from.room) throw new Error("They're not in your room.");
    engine.potatoHolder = toId;
    engine._log("potato_pass", { from: fromId, to: toId });
    return true;
  },

  tick(engine) {
    if (engine.phase !== "active" || !engine.potatoHolder) return;
    if (engine.now >= engine.potatoExplodesAt) {
      const victim = engine.potatoHolder;
      engine._log("potato_explode", { victim });
      engine._down(victim, "potato"); // base down (energy plane); win check follows
      // Hand a fresh, faster potato to a random remaining survivor.
      const survivors = [...engine.players.values()].filter((p) => p.plane === PLANE.PHYSICAL);
      if (survivors.length > 1) {
        engine.potatoFuseLen = Math.max(MIN_FUSE, engine.potatoFuseLen - FUSE_STEP);
        engine.potatoHolder = survivors[Math.floor(engine.rng() * survivors.length)].id;
        engine.potatoExplodesAt = engine.now + engine.potatoFuseLen;
        engine._log("potato_spawn", { holder: engine.potatoHolder, fuse: engine.potatoFuseLen });
      } else {
        engine.potatoHolder = null;
      }
    }
  },

  checkWin(engine) {
    const survivors = [...engine.players.values()].filter((p) => p.plane === PLANE.PHYSICAL);
    if (survivors.length <= 1) {
      return { winner: WINNER.CREW, reason: "potato_last_standing", meta: { winnerId: survivors[0]?.id || null } };
    }
    return null;
  },
};
