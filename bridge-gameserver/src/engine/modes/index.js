// ============================================================
// Pluggable game modes (v0.1).
// A mode is a small object of OPTIONAL lifecycle hooks the engine calls. A mode
// may REPLACE base win conditions (return a result from checkWin) or override
// what happens when a player is downed. If a hook is absent, the engine's base
// behavior runs. Modes are selected ONLY via an event (the event names a `mode`,
// and an event-host starts the match); unknown/empty mode => standard rules.
//
// Hook contract (all optional):
//   id, label
//   onMatchStart(engine)            -> after roles assigned; set up mode state
//   onDown(engine, player, cause)   -> return true if the mode FULLY handled the
//                                      down (engine then skips its default plane
//                                      cross + base win check); false/undefined
//                                      => engine does its normal _down handling
//   checkWin(engine)                -> return { winner, reason } to END the match,
//                                      or null to fall through to base rules
//   tick(engine, dt)                -> per-tick mode logic (optional)
// ============================================================

import { InfectionMode } from "./infection.js";
import { KingOfTheHillMode } from "./koth.js";
import { HotPotatoMode } from "./hotpotato.js";
import { MusicalChairsMode } from "./musicalchairs.js";
import { WhoDidItMode } from "./whodidit.js";

// Registry of available modes by id.
export const GAME_MODES = {
  [InfectionMode.id]: InfectionMode,
  [KingOfTheHillMode.id]: KingOfTheHillMode,
  [HotPotatoMode.id]: HotPotatoMode,
  [MusicalChairsMode.id]: MusicalChairsMode,
  [WhoDidItMode.id]: WhoDidItMode,
};

export function getMode(id) {
  return id && GAME_MODES[id] ? GAME_MODES[id] : null;
}
