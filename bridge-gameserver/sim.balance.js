// ============================================================
// BALANCE SIM HARNESS (headless)
// Runs many full matches with simple bot AI and reports aggregate stats:
// win rates (crew vs impostor), match duration distribution, and red flags
// (matches that never end, lopsided win rates, instant blowouts). This turns
// balance from guesswork into measured starting points to refine with real
// playtests. It drives the ENGINE directly (no network) for speed.
//
// Usage: node sim.balance.js [runs] [players] [mapId]
//   node sim.balance.js 300 8 procedural
//   node sim.balance.js 200 14 procedural
// ============================================================

import { GameEngine } from "./src/engine/GameEngine.js";
import { ROLE, PHASE, PLANE, WINNER, PERKS } from "./src/engine/constants.js";

const TICK = 1;                 // seconds per tick
const MAX_SECONDS = 1800;       // 30 min hard cap => "never ends" flag
const DEADLINE_TARGET = [8 * 60, 12 * 60]; // target window (seconds) for match length

// ---- bot AI: pick an action for one player each "decision beat" ----
function botAct(g, p, rng) {
  if (p.plane === "eliminated") return; // fully out
  if (p.plane === PLANE.ENERGY) {
    // On the energy plane: impostors hunt downed crew to ELIMINATE them; everyone
    // else does energy tasks (which still feed the shared power pool).
    if (p.role === ROLE.IMPOSTOR) {
      const prey = [...g.players.values()].find((q) => q.id !== p.id && q.role === ROLE.CREW && q.plane === PLANE.ENERGY && q.room === p.room);
      if (prey && canCable(g, p)) { try { g.detachCable(p.id, prey.id); return; } catch {} }
      // move toward a downed crew member
      const target = [...g.players.values()].find((q) => q.role === ROLE.CREW && q.plane === PLANE.ENERGY);
      if (target) stepToward(g, p, [target.room]); else wander(g, p, rng);
      return;
    }
    doNearbyTask(g, p) || gotoToTask(g, p, rng);
    return;
  }
  const map = g.map;
  const isImp = p.role === ROLE.IMPOSTOR;

  // Refill if low on air and a refill room is reachable.
  if (p.oxygen < 35) { gotoward(g, p, map.refillRooms, rng); tryRefill(g, p); return; }

  if (isImp) {
    // Impostor: occasionally sabotage; hunt a lone crew in the same room to pull.
    if (rng() < 0.04) trySabotage(g, p, rng);
    const prey = sameRoomCrew(g, p);
    if (prey && canCable(g, p)) { try { g.detachCable(p.id, prey.id); return; } catch {} }
    // else wander toward where crew are
    wander(g, p, rng);
    return;
  }

  // Crew: do tasks; the commander manages systems toward the journey.
  if (p.id === g.commanderId) commanderManage(g, p);
  if (!doNearbyTask(g, p)) gotoToTask(g, p, rng);
}

// ---- helpers the bots use ----
function neighbors(g, room) { return g.map.adjacency ? (g.map.adjacency[room] || []) : g.map.rooms; }
function stepToward(g, p, targets) {
  if (!targets || !targets.length) return;
  if (targets.includes(p.room)) return; // already there
  const opts = neighbors(g, p.room);
  // greedy: if a target is adjacent, go; else move to a random neighbor (explore)
  const direct = opts.find((r) => targets.includes(r));
  const dest = direct || opts[Math.floor(Math.random() * opts.length)];
  if (dest) { try { g.move(p.id, dest); } catch {} }
}
function gotoward(g, p, targets, rng) { stepToward(g, p, targets); }
function gotoToTask(g, p, rng) {
  const rooms = [...new Set(p.tasks.filter((t) => !t.done).map((t) => t.room))];
  stepToward(g, p, rooms);
}
function doNearbyTask(g, p) {
  // Two-phase timed tasks: if a task in this room is already started and enough
  // server-time has elapsed, complete it; otherwise start one. The engine's clock
  // (g.now) advances via ticks in the sim loop, so this models a bot "playing"
  // the mini-game for its required duration.
  const here = p.tasks.filter((t) => !t.done && t.room === p.room);
  if (!here.length) return false;
  // try to complete a started+ready task first
  const ready = here.find((t) => t.startedAt != null && (g.now - t.startedAt) >= (t.minSeconds - 1));
  if (ready) { try { g.completeTask(p.id, ready.id); return true; } catch {} }
  // otherwise start one that hasn't been started
  const fresh = here.find((t) => t.startedAt == null);
  if (fresh) { try { g.startTask(p.id, fresh.id); return true; } catch {} }
  return false;
}
function tryRefill(g, p) { try { g.refillOxygen(p.id); } catch {} }
function sameRoomCrew(g, imp) {
  return g._living().find((q) => q.id !== imp.id && q.role === ROLE.CREW && q.room === imp.room &&
    g._living().filter((x) => x.room === imp.room).length <= 2); // prefer near-isolated
}
function canCable(g, imp) { const cd = g.cooldowns[imp.id]; return !cd || g.now >= cd.cable; }
function trySabotage(g, imp, rng) {
  const kinds = ["life_support", "comms_blackout", "lights_out", "attract_attackers", "emp_outage", "reactor_meltdown"];
  const k = kinds[Math.floor(rng() * kinds.length)];
  try { g.triggerSabotage(imp.id, k); } catch {}
}
function wander(g, p, rng) { const opts = neighbors(g, p.room); const d = opts[Math.floor(rng() * opts.length)]; if (d) { try { g.move(p.id, d); } catch {} } }
function commanderManage(g, p) {
  // Pulse strategy: burn engines while hull is healthy; when hull dips, cut
  // engines so shields come back up and let it recover, then burn again.
  try { g.setSystem(p.id, "oxygen", true); } catch {}
  try {
    const hullPct = g.hull / 150;
    if (hullPct < 0.45) { g.setSystem(p.id, "engines", false); g.setSystem(p.id, "shields", true); }
    else if (hullPct > 0.7) { g.setSystem(p.id, "engines", true); }
    // between 45-70%: hold current state (hysteresis avoids flapping)
  } catch {}
}

// ---- run one match, return outcome ----
function runMatch({ players, mapId, seed, perks = true }) {
  const config = { mapId };
  if (mapId === "procedural") config.players = players;
  const g = new GameEngine({ mapId, seed, config });
  for (let i = 0; i < players; i++) g.addPlayer("P" + i, { userId: "u" + i, unlockedPerks: Object.keys(PERKS) });
  // skip draft for speed: start directly (random perks not essential to balance core)
  g.start();
  const rng = (() => { let s = (seed * 2654435761) >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xffffffff; }; })();

  let t = 0;
  while (g.phase !== PHASE.ENDED && t < MAX_SECONDS) {
    // each player takes a beat, then time advances
    for (const p of [...g.players.values()]) botAct(g, p, rng);
    g.tick(TICK);
    t += TICK;
  }
  return { ended: g.phase === PHASE.ENDED, winner: g.winner, reason: g.winReason, seconds: t };
}

// ---- aggregate over many runs ----
function run(runs, players, mapId) {
  const res = { crew: 0, impostors: 0, none: 0, neverEnded: 0, durations: [], reasons: {} };
  for (let i = 0; i < runs; i++) {
    const o = runMatch({ players, mapId, seed: 1000 + i });
    if (!o.ended) { res.neverEnded++; continue; }
    if (o.winner === WINNER.CREW) res.crew++;
    else if (o.winner === WINNER.IMPOSTORS) res.impostors++;
    else res.none++;
    if (o.reason) res.reasons[o.reason] = (res.reasons[o.reason] || 0) + 1;
    res.durations.push(o.seconds);
  }
  return res;
}

function pct(n, d) { return d ? (100 * n / d).toFixed(1) + "%" : "—"; }
function median(a) { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; }
function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }

const runs = Number(process.argv[2] || 200);
const players = Number(process.argv[3] || 8);
const mapId = process.argv[4] || "procedural";

// ---- SWEEP MODE: node sim.balance.js sweep [players] [runsPerCombo] ----
// Tries combinations of the key balance levers and ranks them by closeness to
// the targets (55% crew, 8-12 min). Overrides are injected via engine config
// (host-config knobs) so we don't have to edit constants per combo.
if (process.argv[2] === "sweep") {
  const sweepPlayers = Number(process.argv[3] || 8);
  const perCombo = Number(process.argv[4] || 40);
  runSweep(sweepPlayers, perCombo);
} else {
  mainSingle();
}

function scoreCombo(crewRate, medMin) {
  // Distance from target: crew 0.55, duration midpoint 10 min. Lower is better.
  const crewErr = Math.abs(crewRate - 0.55) * 100;            // in win-rate points
  const durErr = medMin < 8 ? (8 - medMin) * 6 : medMin > 12 ? (medMin - 12) * 6 : 0;
  return crewErr + durErr;
}

function runComboOnce({ players, seed, overrides }) {
  const config = { mapId: "procedural", players, ...overrides };
  const g = new GameEngine({ mapId: "procedural", seed, config });
  for (let i = 0; i < players; i++) g.addPlayer("P" + i, { userId: "u" + i, unlockedPerks: Object.keys(PERKS) });
  g.start();
  const rng = (() => { let s = (seed * 2654435761) >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xffffffff; }; })();
  let t = 0;
  while (g.phase !== PHASE.ENDED && t < MAX_SECONDS) {
    for (const p of [...g.players.values()]) botAct(g, p, rng);
    g.tick(TICK); t += TICK;
  }
  return { ended: g.phase === PHASE.ENDED, winner: g.winner, seconds: t };
}

function runSweep(players, perCombo) {
  // Lever grids (host-config multipliers + journey via journeyDistanceMult if present).
  const cableMults = [0.6, 1.0, 1.4];      // cablePullCooldownMult: shorter=more attrition
  const dmgMults   = [0.6, 1.0, 1.5];      // attackDamageMult: hull pressure
  const journeyMults = [0.5, 0.75, 1.0];   // journeyDistanceMult: match length
  console.log(`\n=== SWEEP: ${players} players, ${perCombo} runs/combo ===`);
  console.log("cableMult dmgMult journeyMult | crew% medMin | score");
  const results = [];
  for (const cable of cableMults) for (const dmg of dmgMults) for (const jm of journeyMults) {
    const overrides = { cablePullCooldownMult: cable, attackDamageMult: dmg, journeyDistanceMult: jm };
    let crew = 0, imp = 0, ended = 0; const durs = [];
    for (let i = 0; i < perCombo; i++) {
      const o = runComboOnce({ players, seed: 5000 + i, overrides });
      if (!o.ended) continue;
      ended++;
      if (o.winner === WINNER.CREW) crew++; else if (o.winner === WINNER.IMPOSTORS) imp++;
      durs.push(o.seconds);
    }
    const crewRate = ended ? crew / ended : 0;
    const medMin = median(durs) / 60;
    const score = scoreCombo(crewRate, medMin);
    results.push({ cable, dmg, jm, crewRate, medMin, score, ended });
    console.log(`  ${cable}      ${dmg}     ${jm}      | ${(crewRate*100).toFixed(0).padStart(3)}%  ${medMin.toFixed(1).padStart(4)} | ${score.toFixed(1)}`);
  }
  results.sort((a, b) => a.score - b.score);
  const best = results[0];
  console.log(`\nBest combo: cableMult=${best.cable}, attackDamageMult=${best.dmg}, journeyDistanceMult=${best.jm}`);
  console.log(`  -> crew ${(best.crewRate*100).toFixed(0)}%, median ${best.medMin.toFixed(1)}m, score ${best.score.toFixed(1)}`);
  console.log("  (apply these as new base defaults, then re-validate)\n");
}

function mainSingle() {
const r = run(runs, players, mapId);
const decided = r.crew + r.impostors + r.none;
const medSec = median(r.durations), meanSec = mean(r.durations);
console.log(`Crew wins:      ${r.crew}  (${pct(r.crew, decided)})`);
console.log(`Impostor wins:  ${r.impostors}  (${pct(r.impostors, decided)})`);
console.log(`Other/none:     ${r.none}`);
console.log(`Never ended:    ${r.neverEnded}  (${pct(r.neverEnded, runs)})`);
console.log(`Match length:   median ${(medSec/60).toFixed(1)}m, mean ${(meanSec/60).toFixed(1)}m`);
const reasonStr = Object.entries(r.reasons || {}).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k} ${v}`).join(", ");
if (reasonStr) console.log(`Win reasons:    ${reasonStr}`);

// ---- red flags vs targets (55% crew, 8-12 min) ----
console.log("\nRed flags:");
const flags = [];
const crewRate = decided ? r.crew / decided : 0;
if (crewRate < 0.45) flags.push(`Crew win rate ${(crewRate*100).toFixed(0)}% is below target (~55%) — impostors too strong.`);
if (crewRate > 0.65) flags.push(`Crew win rate ${(crewRate*100).toFixed(0)}% is above target (~55%) — crew too strong.`);
if (r.neverEnded / runs > 0.05) flags.push(`${pct(r.neverEnded, runs)} of matches never ended — win conditions too slow/unreachable.`);
if (medSec < DEADLINE_TARGET[0]) flags.push(`Median ${(medSec/60).toFixed(1)}m is under the 8m target — matches too fast.`);
if (medSec > DEADLINE_TARGET[1]) flags.push(`Median ${(medSec/60).toFixed(1)}m is over the 12m target — matches too long.`);
if (!flags.length) console.log("  none — within targets 🎯");
else flags.forEach((f) => console.log("  • " + f));
console.log("");
}
