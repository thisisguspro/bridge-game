// ============================================================
// WHO DID IT?  — a deduction / reflex mode.
// Each round a random DETECTIVE is chosen. A window opens during which any other
// player (the CULPRIT) may pull the detective's cable. That pull doesn't down the
// detective — it triggers the GUESS phase: the detective names who did it.
//   - WRONG guess  -> detective loses a fixed % of air (others can mill around to
//                     muddy who moved).
//   - RIGHT guess  -> the culprit is instantly downed and the detective banks a
//                     solved case.
// Detective banks 3 solved cases  -> detective (and surviving sleuths) WIN.
// Detective's air hits 0           -> the pullers WIN.
// A fresh random detective is drawn each round from the remaining players.
//
// Phases on the engine: engine.wdiPhase = "window" | "guessing".
// ============================================================

import { ROLE, PLANE, WINNER, OXYGEN } from "../constants.js";

const WINDOW_SECONDS = 12;          // time for a culprit to strike each round
const WRONG_AIR_COST = OXYGEN.MAX * 0.20; // each wrong guess
const CASES_TO_WIN = 3;             // solved cases for the detective to win

export const WhoDidItMode = {
  id: "whodidit",
  label: "Who Did It?",

  onMatchStart(engine) {
    for (const p of engine.players.values()) { p.role = ROLE.CREW; }
    engine.wdiSolved = 0;
    newRound(engine);
  },

  // Cable-pull is intercepted: only a non-detective may strike, only during the
  // window. It arms the guess phase and records the (hidden) culprit. Returns
  // true so the engine skips its lethal down path.
  onShove(engine, target, byId) {
    // The engine calls onShove(engine, target) for KotH; here we also need the
    // actor. detachCable passes the actor via engine._lastShover (set below).
    const culpritId = byId || engine._lastShover;
    if (engine.wdiPhase !== "window") throw new Error("It's not the moment to strike.");
    if (target.id !== engine.wdiDetective) throw new Error("You can only pull the detective's cable.");
    if (culpritId === engine.wdiDetective) throw new Error("The detective can't strike themselves.");
    engine.wdiCulprit = culpritId;
    engine.wdiPhase = "guessing";
    engine._log("wdi_struck", { detective: engine.wdiDetective, private: true }); // culprit hidden
    return true;
  },

  // The detective's guess (new `guess` action -> engine.guessWhoDidIt).
  onGuess(engine, detectiveId, suspectId) {
    if (engine.wdiPhase !== "guessing") throw new Error("No case to solve right now.");
    if (detectiveId !== engine.wdiDetective) throw new Error("Only the detective guesses.");
    const det = engine.players.get(detectiveId);
    if (suspectId === engine.wdiCulprit) {
      // Correct: down the culprit, bank a case.
      engine._down(engine.wdiCulprit, "caught");
      engine.wdiSolved += 1;
      engine._log("wdi_correct", { detective: detectiveId, culprit: engine.wdiCulprit, solved: engine.wdiSolved });
      if (engine.phase !== "active") return { correct: true }; // win may have fired
      newRound(engine);
      return { correct: true, solved: engine.wdiSolved };
    }
    // Wrong: detective bleeds air. Out of air => pullers win (checkWin handles it).
    det.oxygen = Math.max(0, det.oxygen - WRONG_AIR_COST);
    engine._log("wdi_wrong", { detective: detectiveId, guessed: suspectId, oxygen: Math.round(det.oxygen), private: true });
    if (det.oxygen <= 0) engine._checkWin();
    return { correct: false, oxygen: det.oxygen };
  },

  tick(engine) {
    if (engine.phase !== "active") return;
    // If the strike window elapses with no culprit, start a fresh round.
    if (engine.wdiPhase === "window" && engine.now >= engine.wdiWindowEndsAt) {
      engine._log("wdi_no_strike", { detective: engine.wdiDetective });
      newRound(engine);
    }
  },

  checkWin(engine) {
    // Detective solved enough cases.
    if ((engine.wdiSolved || 0) >= CASES_TO_WIN) {
      return { winner: WINNER.CREW, reason: "wdi_solved_all", meta: { detective: engine.wdiDetective } };
    }
    // Detective ran out of air -> the pullers win.
    const det = engine.players.get(engine.wdiDetective);
    if (det && det.oxygen <= 0) {
      return { winner: WINNER.IMPOSTORS, reason: "wdi_detective_starved" };
    }
    // Not enough players left to keep playing -> whoever's ahead by survival.
    const standing = [...engine.players.values()].filter((p) => p.plane === PLANE.PHYSICAL);
    if (standing.length <= 1) {
      return { winner: WINNER.IMPOSTORS, reason: "wdi_no_suspects" };
    }
    return null;
  },
};

// Pick a fresh random detective from the standing players; reset the strike window.
function newRound(engine) {
  const standing = [...engine.players.values()].filter((p) => p.plane === PLANE.PHYSICAL);
  if (standing.length <= 1) { engine._checkWin(); return; }
  const det = standing[Math.floor(engine.rng() * standing.length)];
  engine.wdiDetective = det.id;
  engine.wdiCulprit = null;
  engine.wdiPhase = "window";
  engine.wdiWindowEndsAt = engine.now + WINDOW_SECONDS;
  // Top the detective's air a touch so a fresh round is survivable, but never above max.
  engine._log("wdi_round", { detective: det.id, window: WINDOW_SECONDS, solved: engine.wdiSolved || 0 });
}
