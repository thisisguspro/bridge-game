// ============================================================
// INFECTION (zombie) mode.
// A few players start INFECTED (hunters). When an infected player downs a
// survivor, the survivor CONVERTS to infected and keeps playing as a hunter
// instead of crossing to the energy plane — so the infection spreads. Replaces
// the base win conditions:
//   - Infected win when every survivor has been converted.
//   - Survivors win if they reach the next location (the journey completes) OR
//     at least one survivor is still standing when the match timer ends.
// Uses the existing ROLE.IMPOSTOR as the "infected/hunter" side so all the
// impostor abilities (cable-pull, sabotage, nightvision) come along for free.
// ============================================================

import { ROLE, PLANE, WINNER, OXYGEN } from "../constants.js";

export const InfectionMode = {
  id: "infection",
  label: "Infection",
  usesBaseSimulation: true, // full ship game, just with conversion on down

  // After base role assignment, normalize to the infection setup: a fixed number
  // of starting infected (patient zero[s]); everyone else is a survivor.
  onMatchStart(engine) {
    const ids = [...engine.players.keys()];
    // Starting infected count: host override (impostorCount) if set, else ~1 per 6.
    const cfg = engine.config || {};
    let startInfected = Number.isInteger(cfg.impostorCount) && cfg.impostorCount > 0
      ? cfg.impostorCount
      : Math.max(1, Math.round(ids.length / 6));
    startInfected = Math.min(startInfected, ids.length - 1); // leave >=1 survivor

    // Reassign cleanly: pick the first N (already shuffled at base assignment) as infected.
    const infected = new Set([...engine.players.values()].filter((p) => p.role === ROLE.IMPOSTOR).map((p) => p.id));
    // If base assigned a different count, reconcile to startInfected.
    const all = [...engine.players.values()];
    const desired = new Set(all.slice(0, startInfected).map((p) => p.id));
    for (const p of all) {
      p.role = desired.has(p.id) ? ROLE.IMPOSTOR : ROLE.CREW;
      p.infected = desired.has(p.id);
    }
    engine._log("mode_infection_start", { startInfected, infectedIds: [...desired], private: true });
  },

  // When a survivor is downed by the infection, convert them instead of sending
  // them to the energy plane. Returns true to tell the engine it fully handled it.
  onDown(engine, player, cause) {
    // Only infection-relevant downs convert (cable_pull = caught by a hunter).
    // Other causes (e.g. out_of_air) still convert here, since in infection there
    // is no separate "downed" survivor state — you're either a survivor or turned.
    if (player.role === ROLE.IMPOSTOR) return true; // already infected; nothing to do
    player.role = ROLE.IMPOSTOR;
    player.infected = true;
    player.plane = PLANE.PHYSICAL;      // stays in the match as a hunter
    player.oxygen = OXYGEN.MAX;          // top up; infected don't suffocate
    engine._log("infection_converted", { id: player.id, cause, private: true });
    return true; // engine skips its default plane-cross + its own _checkWin call
  },

  // Replace base win conditions.
  checkWin(engine) {
    const players = [...engine.players.values()];
    const survivors = players.filter((p) => p.role === ROLE.CREW);
    if (survivors.length === 0) {
      return { winner: WINNER.IMPOSTORS, reason: "all_infected" };
    }
    // Survivors reaching the location is handled by the journey in tick() via the
    // engine calling checkWin again; we report the survivor win there too.
    if (engine.distanceReached) {
      return { winner: WINNER.CREW, reason: "survivors_escaped" };
    }
    return null; // keep playing
  },
};
