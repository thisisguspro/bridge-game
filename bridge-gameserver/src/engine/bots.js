// Bot brain for LIVE matches. Adapted from the balance sim's botAct, but driven
// against a running GameEngine where movement is continuous (x/y) rather than
// room-teleport — so bots steer with setDestination toward room centers.
//
// Three difficulty tiers tune the knobs. Higher tiers react more often, sabotage
// more, hunt more decisively, and "play" mini-games closer to their minimum time.
import { ROLE, PLANE, SABOTAGE } from "./constants.js";

export const BOT_TIERS = {
  recruit: { label: "Recruit", actEverySec: 1.4, sabotageChance: 0.015, huntRadiusRooms: 0, taskSlackSec: 4, voteChance: 0.0 },
  pilot:   { label: "Pilot",   actEverySec: 0.9, sabotageChance: 0.04,  huntRadiusRooms: 1, taskSlackSec: 2, voteChance: 0.15 },
  ace:     { label: "Ace",     actEverySec: 0.5, sabotageChance: 0.08,  huntRadiusRooms: 2, taskSlackSec: 0.5, voteChance: 0.35 },
};

const SAB_KINDS = ["LIFE_SUPPORT", "COMMS_BLACKOUT", "LIGHTS_OUT", "ATTRACT_ATTACKERS", "EMP_OUTAGE", "REACTOR_MELTDOWN"];

// Per-bot scratch state (last action time, current vote) keyed by playerId.
// The driver owns a Map of these; we keep the brain stateless otherwise.
export function newBotState() { return { nextActAt: 0, votedFor: null }; }

// Center of a room in world units (continuous movement target).
function roomCenter(engine, room) {
  const r = engine.map.geometry?.rooms?.[room];
  if (!r) return null;
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}
function steerTo(engine, p, room) {
  const c = roomCenter(engine, room);
  if (c) { try { engine.setDestination(p.id, c.x, c.y); } catch {} }
}
function neighbors(engine, room) { return engine.map.adjacency ? (engine.map.adjacency[room] || engine.map.rooms) : engine.map.rooms; }
function stepToward(engine, p, targets) {
  if (!targets || !targets.length) return;
  if (targets.includes(p.room)) return;
  const opts = neighbors(engine, p.room);
  const direct = opts.find((r) => targets.includes(r));
  const dest = direct || opts[Math.floor(Math.random() * opts.length)];
  if (dest) steerTo(engine, p, dest);
}
function wander(engine, p) { const opts = neighbors(engine, p.room); const d = opts[Math.floor(Math.random() * opts.length)]; if (d) steerTo(engine, p, d); }
function canCable(engine, imp) { const cd = engine.cooldowns[imp.id]; return !cd || engine.now >= cd.cable; }
function sameRoomCrew(engine, imp) {
  const living = engine._living();
  return living.find((q) => q.id !== imp.id && q.role === ROLE.CREW && q.room === imp.room &&
    living.filter((x) => x.room === imp.room).length <= 2);
}

// Two-phase timed task: start one in the room, then complete after minSeconds
// (minus the tier's slack — Aces finish near-optimally, Recruits dawdle).
function doNearbyTask(engine, p, tier) {
  const here = p.tasks.filter((t) => !t.done && t.room === p.room);
  if (!here.length) return false;
  const ready = here.find((t) => t.startedAt != null && (engine.now - t.startedAt) >= (t.minSeconds - 1));
  if (ready) { try { engine.completeTask(p.id, ready.id); return true; } catch {} }
  const fresh = here.find((t) => t.startedAt == null);
  if (fresh) { try { engine.startTask(p.id, fresh.id); return true; } catch {} }
  return false;
}
function gotoToTask(engine, p) {
  const rooms = [...new Set(p.tasks.filter((t) => !t.done).map((t) => t.room))];
  stepToward(engine, p, rooms);
}
function commanderManage(engine, p) {
  try { engine.setSystem(p.id, "oxygen", true); } catch {}
  try {
    const hullPct = engine.hull / (engine.map.hullMax || 150);
    const helm = engine.map.spawnRoom || "Helm";
    const underThreat = engine.attack || engine.attackWarnUntil != null || hullPct < 0.45;
    // Decide a target allocation: shields-heavy under threat / low hull, else cruise.
    const want = underThreat ? 0.15 : (hullPct > 0.7 ? 0.85 : 0.5);
    // Only the Helm can set it, so a bot that wants to change it heads there first.
    if (p.room === helm) { engine.setAllocation(p.id, want); }
    else if (underThreat) { stepToward(engine, p, [helm]); }
  } catch {}
}
function trySabotage(engine, imp) {
  const k = SAB_KINDS[Math.floor(Math.random() * SAB_KINDS.length)];
  try { engine.triggerSabotage(imp.id, k); } catch {}
}
// Crew bots help resolve an active sabotage if they're standing on a fix point.
function tryResolve(engine, p) {
  for (const s of engine.sabotages.values()) {
    if (s.resolveRooms.includes(p.room)) { try { engine.resolveSabotage(p.id, s.kind); return true; } catch {} }
  }
  return false;
}

// One bot decision. Called by the driver at the bot's cadence.
export function botStep(engine, p, tier, state) {
  if (p.plane === PLANE.ELIMINATED) return;
  const T = BOT_TIERS[tier] || BOT_TIERS.pilot;

  // ENERGY plane: impostors hunt downed crew to eliminate; others do energy tasks.
  if (p.plane === PLANE.ENERGY) {
    if (p.role === ROLE.IMPOSTOR) {
      const downedCrew = [...engine.players.values()].filter((q) => q.id !== p.id && q.role === ROLE.CREW && q.plane === PLANE.ENERGY);
      const here = downedCrew.find((q) => q.room === p.room);
      if (here && canCable(engine, p)) { try { engine.detachCable(p.id, here.id); return; } catch {} }
      if (downedCrew[0]) stepToward(engine, p, [downedCrew[0].room]); else wander(engine, p);
      return;
    }
    if (!doNearbyTask(engine, p, tier)) gotoToTask(engine, p);
    return;
  }

  const isImp = p.role === ROLE.IMPOSTOR;
  // refill if low on air
  if (p.oxygen < 35) { stepToward(engine, p, engine.map.refillRooms); try { engine.refillOxygen(p.id); } catch {} return; }

  if (isImp) {
    if (Math.random() < T.sabotageChance) trySabotage(engine, p);
    const prey = sameRoomCrew(engine, p);
    if (prey && canCable(engine, p)) { try { engine.detachCable(p.id, prey.id); return; } catch {} }
    // higher tiers actively close on isolated crew; recruits mostly wander
    if (T.huntRadiusRooms > 0) {
      const target = engine._living().find((q) => q.role === ROLE.CREW &&
        engine._living().filter((x) => x.room === q.room).length <= 2);
      if (target) { stepToward(engine, p, [target.room]); return; }
    }
    wander(engine, p);
    return;
  }

  // CREW: resolve sabotage if standing on it, manage systems if commander, else task.
  if (tryResolve(engine, p)) return;
  if (p.id === engine.commanderId) commanderManage(engine, p);
  if (!doNearbyTask(engine, p, tier)) gotoToTask(engine, p);
}
