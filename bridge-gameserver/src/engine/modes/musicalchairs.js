// ============================================================
// MUSICAL CHAIRS.
// Rounds alternate between MUSIC (free movement, no safe room yet) and the STOP
// moment. When the music stops, a single random room is announced as SAFE for a
// short grace window; when that window closes, everyone NOT in the safe room is
// out. Repeat with survivors until one remains. Replaces base win conditions.
//
// Phases tracked on the engine: engine.mcPhase = "music" | "grace".
// ============================================================

import { ROLE, PLANE, WINNER } from "../constants.js";

const MUSIC_SECONDS = 10;  // free-movement window before the music stops
const GRACE_SECONDS = 4;   // time to reach the safe room after it's announced

export const MusicalChairsMode = {
  id: "musicalchairs",
  label: "Musical Chairs",

  onMatchStart(engine) {
    for (const p of engine.players.values()) p.role = ROLE.CREW;
    startMusic(engine);
  },

  tick(engine) {
    if (engine.phase !== "active") return;
    if (engine.mcPhase === "music" && engine.now >= engine.mcStopsAt) {
      // Music stops: announce a random safe room and open the grace window.
      const rooms = engine.map.rooms || [engine.map.spawnRoom];
      engine.mcSafeRoom = rooms[Math.floor(engine.rng() * rooms.length)];
      engine.mcPhase = "grace";
      engine.mcResolveAt = engine.now + GRACE_SECONDS;
      engine._log("mc_music_stop", { safeRoom: engine.mcSafeRoom, grace: GRACE_SECONDS });
    } else if (engine.mcPhase === "grace" && engine.now >= engine.mcResolveAt) {
      // Resolve: anyone not in the safe room is out.
      const survivors = [...engine.players.values()].filter((p) => p.plane === PLANE.PHYSICAL);
      for (const p of survivors) {
        if (p.room !== engine.mcSafeRoom) {
          engine._log("mc_eliminated", { id: p.id, wasIn: p.room, safe: engine.mcSafeRoom, private: true });
          engine._down(p.id, "musical_chairs");
        }
      }
      if (engine.phase !== "active") return; // win may have triggered
      startMusic(engine); // next round
    }
  },

  checkWin(engine) {
    const survivors = [...engine.players.values()].filter((p) => p.plane === PLANE.PHYSICAL);
    if (survivors.length <= 1) {
      return { winner: WINNER.CREW, reason: "mc_last_standing", meta: { winnerId: survivors[0]?.id || null } };
    }
    return null;
  },
};

function startMusic(engine) {
  engine.mcPhase = "music";
  engine.mcSafeRoom = null;
  engine.mcStopsAt = engine.now + MUSIC_SECONDS;
  engine._log("mc_music_start", { seconds: MUSIC_SECONDS });
}
