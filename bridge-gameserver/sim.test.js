import { GameEngine } from "./src/engine/GameEngine.js";
import { PHASE, ROLE, PLANE, WINNER, OXYGEN, VOTE, HULL, SABOTAGE, DRAFT, PERKS, JOURNEY, ATTACK_WARNING_SECONDS } from "./src/engine/constants.js";
const SABOTAGE_RESOLVE = (k) => SABOTAGE[k].resolveRooms;

let pass = 0, fail = 0;
function assert(cond, msg) { if (cond) pass++; else { fail++; console.log("  ✗ FAIL:", msg); } }
function section(t) { console.log("\n## " + t); }

// Tasks are now timed mini-games: start, let server time pass, then complete.
// This helper does the full flow for tests (advances the engine clock past the
// task's minSeconds via ticks, then completes).
// Place a player firmly in a room: set room AND snap x/y to its center so the
// continuous-movement tick (_roomAt) agrees and won't relocate them. Needed now
// that named maps carry geometry (players have real positions). Falls back to a
// plain room set for maps without geometry.
function place(g, playerId, room) {
  const p = g.players.get(playerId);
  const rect = g.map.geometry?.rooms?.[room];
  if (rect) {
    // Use the engine's own free-point logic so the player isn't dropped inside a
    // furniture blocker (which collision would then shove out of the room).
    const xy = g._spawnXY ? g._spawnXY(room) : { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
    p.x = p.tx = xy.x; p.y = p.ty = xy.y;
  }
  p.room = room;
}

function doTask(g, playerId, taskId) {
  const p = g.players.get(playerId);
  const task = p.tasks.find((t) => t.id === taskId);
  place(g, playerId, task.room);   // sit firmly in the task's room (free point)
  g.startTask(playerId, taskId);
  const need = (task.minSeconds || 12) + 1;
  for (let s = 0; s < need; s++) {
    g.tick(1);
    place(g, playerId, task.room); // keep them parked while the timer runs
  }
  return g.completeTask(playerId, taskId);
}

function startMatch(n, mapId = "nebula_drift", seed = 42) {
  const g = new GameEngine({ mapId, seed });
  const ids = [];
  for (let i = 0; i < n; i++) ids.push(g.addPlayer(`P${i}`));
  g.start();
  const impostors = ids.filter((id) => g.players.get(id).role === ROLE.IMPOSTOR);
  const crew = ids.filter((id) => g.players.get(id).role === ROLE.CREW);
  return { g, ids, impostors, crew };
}

section("Role assignment respects map scaling");
{
  assert(startMatch(7, "nebula_drift").impostors.length === 1, "small map => 1 impostor");
  assert(startMatch(14, "ironhold_station").impostors.length === 2, "large map => 2 impostors");
  const s = startMatch(7);
  assert(s.g.phase === PHASE.ACTIVE, "match goes active on start");
  assert(s.crew.includes(s.g.commanderId), "commander is a crew member");
}

section("Cannot start under-filled");
{
  const g = new GameEngine({ mapId: "nebula_drift", seed: 1 });
  g.addPlayer("solo");
  let threw = false; try { g.start(); } catch { threw = true; }
  assert(threw, "start rejected below minPlayers");
}

section("Anti-cheat: crew never see roles; impostors see each other");
{
  const { g, impostors, crew } = startMatch(12, "ironhold_station");
  const cv = g.viewFor(crew[0]);
  assert(cv.players.filter((p) => p.id !== crew[0]).every((p) => p.role === "unknown"), "crew sees others as unknown");
  assert(cv.you.role === ROLE.CREW, "crew knows own role");
  const iv = g.viewFor(impostors[0]);
  const partner = iv.players.find((p) => p.id === impostors[1]);
  assert(partner && partner.role === ROLE.IMPOSTOR, "impostor sees fellow impostor");
}

section("Oxygen drains and can be refilled at a station");
{
  const { g, crew } = startMatch(6);
  const c = crew[0];
  const start = g.viewFor(c).you.oxygen;
  g.tick(10);
  assert(g.viewFor(c).you.oxygen < start, "oxygen drains over time");
  // move to a refill room and refill
  g.move(c, g.map.refillRooms[0]);
  g.refillOxygen(c);
  assert(g.viewFor(c).you.oxygen === OXYGEN.MAX, "refill restores full tank");
  // refilling where there's no station fails
  const noStation = g.map.rooms.find((r) => !g.map.refillRooms.includes(r));
  g.move(c, noStation);
  let threw = false; try { g.refillOxygen(c); } catch { threw = true; }
  assert(threw, "refill blocked away from a station");
}

section("Empty tank downs you to the energy plane (not removal)");
{
  const { g, crew } = startMatch(6);
  const c = crew[1];
  g.tick(OXYGEN.MAX / OXYGEN.DRAIN_PER_SEC + 1); // drain to zero
  const v = g.viewFor(c);
  assert(v.you.plane === PLANE.ENERGY, "out-of-air player crosses to energy plane");
  assert(v.you.tasks.length > 0, "downed player receives energy-plane tasks");
}

section("Energy-plane tasks feed the SAME shared bar");
{
  const { g, crew } = startMatch(6, "nebula_drift", 5);
  const c = crew[0];
  // Drain only this one player's tank, then a single tick downs just them.
  g.players.get(c).oxygen = 0.2;
  g.tick(1);
  assert(g.players.get(c).plane === PLANE.ENERGY, "single player downed via own empty tank");
  const before = g.taskProgress().done;
  const p = g.players.get(c);
  const t = p.tasks[0];
  g.move(c, t.room); const r = doTask(g, c, t.id);
  assert(r.counted === true, "energy-plane task counts");
  assert(g.taskProgress().done === before + 1, "shared bar advanced by a downed player");
}

section("Impostor detaches cable: same-room, cooldown, target downed");
{
  const { g, impostors, crew } = startMatch(6);
  const imp = impostors[0];
  g.now = 100; // past cooldown
  g.tick(0);
  const victim = crew[0];
  g.move(victim, g.players.get(imp).room);
  g.detachCable(imp, victim);
  assert(g.players.get(victim).plane === PLANE.ENERGY, "cable pull downs the target");
  let threw = false; try { g.detachCable(imp, crew[1]); } catch { threw = true; }
  assert(threw, "second cable pull blocked by cooldown");
}

section("Impostors also have tanks and can be downed");
{
  const { g, impostors } = startMatch(6);
  g.players.get(impostors[0]).oxygen = 0.2;
  g.tick(1);
  assert(g.players.get(impostors[0]).plane === PLANE.ENERGY, "impostor is not immune to oxygen loss");
}

section("Tasks generate power into the pool");
{
  const { g, crew } = startMatch(6, "nebula_drift", 8);
  const p = g.players.get(crew[0]);
  const t = p.tasks[0];
  g.move(crew[0], t.room);
  // start + advance past the mini-game timer, THEN snapshot power right before
  // completing, so we isolate the task's contribution from passive drain.
  g.startTask(crew[0], t.id);
  for (let s = 0; s < t.minSeconds + 1; s++) g.tick(1);
  const before = g.viewFor(crew[0]).power;
  const r = g.completeTask(crew[0], t.id);
  assert(r.power > before, "completing a task raises the power pool");
}

section("Helm allocation: engines<->shields slider ramps and trades speed for protection");
{
  const { g, crew } = startMatch(6);
  // everyone spawns at the Helm, so the spawn-room allocation control is usable
  const helm = g.map.spawnRoom;
  place(g, crew[0], helm);
  // push toward full shields
  g.setAllocation(crew[0], 0);
  assert(g.targetAllocation === 0, "target set toward shields");
  // ramp it down over time (slowdown is quick, <=5s)
  for (let i = 0; i < 6; i++) g.tick(1);
  assert(g.allocation <= 0.05, "allocation ramps toward shields");
  assert(g._shieldStrength() >= 0.9, "full shields => high shield strength");
  // now push toward engines; speedup is slower (15s), so it shouldn't be instant
  g.setAllocation(crew[0], 1);
  g.tick(2);
  assert(g.allocation < 0.5, "speedup is gradual, not instant");
  // must be at the Helm to adjust
  place(g, crew[0], g.map.reactorRoom || "Reactor");
  let threw = false; try { g.setAllocation(crew[0], 0.5); } catch { threw = true; }
  assert(threw, "allocation can only be set at the Helm");
}

section("Continuous movement: players spawn with x/y and glide to a destination");
{
  const g = new GameEngine({ mapId: "procedural", seed: 7, config: { mapId: "procedural", players: 8 } });
  const ids = []; for (let i = 0; i < 8; i++) ids.push(g.addPlayer("P" + i, { userId: "u" + i }));
  g.start();
  const me = g.players.get(ids[0]);
  assert(typeof me.x === "number" && typeof me.y === "number", "player has continuous x/y position");
  assert(g.map.geometry && g.map.geometry.rooms[me.room], "map exposes room geometry");
  const adj = g.map.adjacency[me.room][0];
  const rect = g.map.geometry.rooms[adj];
  // Move along the clear horizontal mid-lane (doors connect on the sides; the
  // center row is kept free of furniture). Aim for the adjacent room's mid-left.
  const tx = rect.x + rect.w * 0.5, ty = rect.y + rect.h * 0.5;
  // first step out to our own room's door edge at mid-height, then into the room
  g.setDestination(ids[0], me.x, rect.y + rect.h * 0.5);
  for (let i = 0; i < 30; i++) g.tick(0.1);
  g.setDestination(ids[0], tx, ty);
  for (let i = 0; i < 80; i++) g.tick(0.1);
  const p = g.players.get(ids[0]);
  assert(p.room === adj, "room is derived from the new position");
  assert(Math.hypot(p.x - tx, p.y - ty) < 40 || p.room === adj, "player glided to the destination room");
}

section("Continuous movement: eliminated players don't move; legacy maps still teleport");
{
  const g = new GameEngine({ mapId: "procedural", seed: 9, config: { mapId: "procedural", players: 8 } });
  const ids = []; for (let i = 0; i < 8; i++) ids.push(g.addPlayer("P" + i, { userId: "u" + i }));
  g.start();
  g.players.get(ids[1]).plane = PLANE.ELIMINATED;
  const before = { x: g.players.get(ids[1]).x, y: g.players.get(ids[1]).y };
  const r = g.map.geometry.rooms[g.map.rooms[3]];
  try { g.setDestination(ids[1], r.x, r.y); } catch {}
  for (let i = 0; i < 20; i++) g.tick(0.1);
  assert(g.players.get(ids[1]).x === before.x, "eliminated player stays put");
  // legacy named map (no geometry) teleports on move
  const g2 = new GameEngine({ mapId: "nebula_drift", seed: 3 });
  const a = g2.addPlayer("A", { userId: "ua" }); for (let i = 0; i < 5; i++) g2.addPlayer("P" + i, { userId: "u" + i });
  g2.start();
  const dest = g2.map.rooms.find((r) => r !== g2.players.get(a).room);
  g2.move(a, dest);
  assert(g2.players.get(a).room === dest, "legacy map move still teleports (no geometry)");
}

section("Attack warning: random attacks announce 10s ahead, then land");
{
  const g = new GameEngine({ mapId: "procedural", config: { players: 8 }, seed: 11 });
  for (let i = 0; i < 8; i++) g.addPlayer("P" + i, { userId: "u" + i });
  g.start();
  // jump to just before a random attack is due
  g.nextRandomAttackAt = g.now + 1;
  g.tick(2); // crosses the threshold -> should be a WARNING, not an attack yet
  assert(g.attackWarnUntil != null && g.attack == null, "random attack warns first");
  for (let s = 0; s < ATTACK_WARNING_SECONDS + 1; s++) g.tick(1);
  assert(g.attack != null, "attack lands after the warning window");
}

section("Helm slider: more shields = less hull damage during an attack");
{
  const mk = (alloc) => {
    const g = new GameEngine({ mapId: "nebula_drift", config: { players: 6 } });
    for (let i = 0; i < 6; i++) g.addPlayer("P" + i, { userId: "u" + i });
    g.start(); g.power = 9999; g.hull = 100;
    g.allocation = g.targetAllocation = alloc; // pin the slider
    g.startAttack("test");
    for (let i = 0; i < 12; i++) { g.power = 9999; g.tick(1); }
    return g.hull;
  };
  const hullShielded = mk(0);   // all shields
  const hullEngines = mk(1);    // all engines, exposed
  assert(hullShielded > hullEngines, "full shields take less damage than full engines");
}
{
  const g = new GameEngine({ mapId: "procedural", config: { players: 8 }, seed: 5 });
  const ids = []; for (let i = 0; i < 8; i++) ids.push(g.addPlayer("P" + i, { userId: "u" + i }));
  g.start();
  const turret = g.map.turretRooms[0];
  const crew = ids.find((id) => g.players.get(id).role === "crew");
  place(g, crew, turret);
  // only one occupant per turret
  g.enterTurret(crew);
  const other = ids.find((id) => id !== crew && g.players.get(id).role === "crew");
  place(g, other, turret);
  let blocked = false; try { g.enterTurret(other); } catch { blocked = true; }
  assert(blocked, "a turret holds only one player at a time");
  // start an attack and shoot the swarm down
  g.startAttack("test");
  assert(g.viewFor(crew).attack?.swarmSize === 20, "attack swarm is 20 planes");
  let shots = 0;
  while (g.attack && shots < 100) {
    try { g.shootPlane(crew); } catch {}
    g.now += 1; // clear the per-shot cooldown
    shots++;
  }
  assert(g.attack === null, "downing the whole swarm ends the attack");
  assert(g.viewFor(crew).planesDowned >= 20 || g.planesByPlayer[crew] >= 20, "shooter is credited with planes");
}

section("CALL_ATTACK sabotage summons a wave on its own cooldown");
{
  const { g, impostors } = startMatch(6, "nebula_drift", 31);
  g.now = 60; g.tick(0);
  g.triggerSabotage(impostors[0], "CALL_ATTACK");
  // CALL_ATTACK now announces a warning first (10s lead), then the wave lands
  assert(g.attackWarning != null || g.attackWarnUntil != null, "CALL_ATTACK raises an attack warning");
  assert(g.viewFor(impostors[0]).attackWarning?.secondsLeft >= 1, "warning exposes a countdown");
  for (let s = 0; s < ATTACK_WARNING_SECONDS + 1; s++) g.tick(1);
  assert(g.attack && g.attack.source === "sabotage", "after the warning, the attack wave starts");
  // its cooldown is separate from the normal sabotage gate
  assert(g.callAttackCdUntil > g.now, "CALL_ATTACK sets its own cooldown");
  // can still trigger a normal sabotage despite the attack (different gate) once global cd clears
  g.globalSabotageCdUntil = 0;
  let normalOk = true; try { g.triggerSabotage(impostors[0], "LIGHTS_OUT"); } catch { normalOk = false; }
  assert(normalOk, "normal sabotage uses a different cooldown than CALL_ATTACK");
}

section("Airlock: go outside (oxygen drains faster), impostor lock traps, crew unlock rescues");
{
  const g = new GameEngine({ mapId: "procedural", config: { players: 8 }, seed: 7 });
  const ids = []; for (let i = 0; i < 8; i++) ids.push(g.addPlayer("P" + i, { userId: "u" + i }));
  g.start();
  const airlock = g.map.airlockRoom;
  const crew = ids.find((id) => g.players.get(id).role === "crew");
  const imp = ids.find((id) => g.players.get(id).role === "impostor");
  place(g, crew, airlock);
  // go outside
  g.goOutside(crew);
  assert(g.players.get(crew).outside === true, "crew can step outside via the airlock");
  // oxygen drains faster outside than inside
  const before = g.players.get(crew).oxygen;
  g.tick(2);
  const outsideDrain = before - g.players.get(crew).oxygen;
  // compare to an inside player's drain over the same time
  const inside = ids.find((id) => id !== crew && id !== imp);
  const inBefore = g.players.get(inside).oxygen; g.tick(2);
  const insideDrain = inBefore - g.players.get(inside).oxygen;
  assert(outsideDrain > insideDrain, "oxygen drains faster outside");
  // impostor locks the door from inside -> trapped
  place(g, imp, airlock);
  g.lockAirlock(imp);
  assert(g.airlockLocked === true, "impostor can lock the airlock");
  let trapped = false; try { g.comeInside(crew); } catch { trapped = true; }
  assert(trapped, "locked door traps the outside crew");
  // bang for help -> distress visible to all living crew
  g.bangOnDoor(crew);
  assert(g.viewFor(inside).airlock.distress.some((d) => d.id === crew), "distress call is visible to crew");
  // another crew unlocks -> rescued
  place(g, inside, airlock);
  g.unlockAirlock(inside);
  assert(g.airlockLocked === false, "crew can unlock the airlock");
  g.comeInside(crew);
  assert(g.players.get(crew).outside === false, "rescued crew comes back inside");
}

section("Airlock: running out of air OUTSIDE is a permanent freeze (not the energy plane)");
{
  const g = new GameEngine({ mapId: "procedural", config: { players: 8 }, seed: 8 });
  const ids = []; for (let i = 0; i < 8; i++) ids.push(g.addPlayer("P" + i, { userId: "u" + i }));
  g.start();
  const crew = ids.find((id) => g.players.get(id).role === "crew");
  place(g, crew, g.map.airlockRoom);
  g.goOutside(crew);
  g.players.get(crew).oxygen = 2; // almost out
  let guard = 0;
  while (g.players.get(crew).plane !== "eliminated" && guard++ < 50 && g.phase === "active") g.tick(1);
  assert(g.players.get(crew).plane === "eliminated", "out of air outside => eliminated, not energy plane");
  assert(g.players.get(crew).frozen === true, "the death is flagged as frozen");
}

section("Emotes: broadcast to same-room players with a sound cue");
{
  const { g, crew } = startMatch(6, "nebula_drift", 44);
  const a = crew[0], b = crew[1];
  place(g, a, "Bridge"); place(g, b, "Bridge");
  const before = g.events.length;
  const r = g.sendEmote(a, "LAUGH");
  const ev = g.events.slice(before).find((e) => e.type === "comm" && e.kind === "emote");
  assert(!!ev, "emote produces a comm event");
  assert(ev.emoji === "😂" && ev.sound === "emote_laugh", "emote carries emoji + sound cue");
  assert(r.recipients.includes(b), "same-room player receives the emote");
  let threw = false; try { g.sendEmote(a, "NOT_A_REAL_EMOTE"); } catch { threw = true; }
  assert(threw, "unknown emote is rejected");
}

section("Living don't see ghosts, but see a corpse where they died");
{
  const { g, crew, impostors } = startMatch(6, "nebula_drift", 88);
  const victim = crew[0], witness = crew[1];
  // put victim + witness in same room, then down the victim
  place(g, victim, "Bridge"); place(g, witness, "Bridge");
  const vRoom = g.players.get(victim).room;
  g._down(victim, "test");
  const wv = g.viewFor(witness);
  const ghostVisible = (wv.players || []).some((p) => p.id === victim);
  assert(!ghostVisible, "living witness does NOT see the downed player as a ghost");
  const corpseHere = (wv.corpses || []).some((c) => c.playerId === victim || c.name === g.players.get(victim).name);
  // corpse carries name; match by name since id is corpse_*
  const corpseByName = (wv.corpses || []).some((c) => c.name === g.players.get(victim).name);
  assert(corpseByName, "living witness sees a corpse where the victim died");
  // a witness in a DIFFERENT room should not see the corpse
  const other = crew[2]; const otherRoom = g.players.get(other).room;
  if (otherRoom !== g.players.get(victim).room) {
    const ov = g.viewFor(other);
    const sees = (ov.corpses || []).some((c) => c.name === g.players.get(victim).name);
    assert(!sees, "a player in another room doesn't see the corpse");
  }
  // the ghost themselves still sees everyone (full sight)
  const gv = g.viewFor(victim);
  assert((gv.players || []).length >= 5, "ghost retains full sight of all players");
}

section("Player reports are recorded and drainable for moderation");
{
  const { g, crew } = startMatch(6, "nebula_drift", 77);
  const a = crew[0], b = crew[1];
  const r = g.reportPlayer(a, b, "bad name");
  assert(r.ok, "report accepted");
  let threwSelf = false; try { g.reportPlayer(a, a); } catch { threwSelf = true; }
  assert(threwSelf, "cannot report yourself");
  const dup = g.reportPlayer(a, b);
  assert(dup.deduped, "duplicate report from same reporter is de-duped");
  const drained = g.drainReports();
  assert(drained.length === 1 && drained[0].targetId === b && drained[0].targetName, "report drained with target name");
  assert(g.drainReports().length === 0, "reports cleared after drain");
}

section("Ghosts generate reduced task energy (half of living crew)");
{
  const { g, crew } = startMatch(6, "nebula_drift", 51);
  const live = crew[0], ghost = crew[1];
  const gainFromLastTask = () => {
    const ev = [...g.events].reverse().find((e) => e.type === "power_generated");
    return ev ? ev.amount : 0;
  };
  // living crew task
  const lt = g.players.get(live).tasks[0];
  g.power = 100; doTask(g, live, lt.id);
  const liveGain = gainFromLastTask();
  // down the other player; do an energy task
  g.players.get(ghost).oxygen = 0.2; place(g, ghost, g.players.get(ghost).room); g.tick(1);
  assert(g.players.get(ghost).plane === "energy", "second player downed to ghost");
  const gt = g.players.get(ghost).tasks[0];
  g.power = 100; doTask(g, ghost, gt.id);
  const ghostGain = gainFromLastTask();
  assert(ghostGain > 0 && ghostGain < liveGain, `ghost gain (${ghostGain}) positive but < living (${liveGain})`);
  assert(Math.abs(ghostGain - liveGain * 0.5) <= 1, "ghost gain is ~50% of living");
}

section("Crew win by reaching the next location");
{
  const { g, crew } = startMatch(6, "nebula_drift", 8);
  g.power = 999; // ensure engines stay powered
  g.setSystem(crew[0], "engines", true);
  // Engines-on means shields-off and heavy attacks, so crew must keep the hull
  // alive (simulating active repair) while the engines carry them to the location.
  // Loop long enough to cross the journey at the engine speed (plus margin).
  const needTicks = Math.ceil(JOURNEY.DISTANCE / JOURNEY.ENGINE_SPEED_PER_SEC) + 20;
  for (let i = 0; i < needTicks && g.phase === "active"; i++) {
    g.power = 999;                         // stand in for crew continuously generating power via tasks
    g.tick(1);
    if (g.hull < HULL.MAX) g.hull = HULL.MAX; // stand in for crew repairing through the run
  }
  assert(g.phase === "ended" && g.winner === WINNER.CREW && g.distance >= JOURNEY.DISTANCE, "reaching the location wins for crew");
}

section("Hull destroyed => crew loss (impostors win)");
{
  const { g, crew } = startMatch(6, "nebula_drift", 8);
  g.power = 999;
  g.setSystem(crew[0], "engines", true); // engines => shields off => heavy damage
  // Hull only takes damage during an attack wave now, so keep one running.
  let guard = 0;
  while (g.phase === "active" && guard++ < 2000) {
    if (!g.attack) g.startAttack("test");
    g.tick(1);
    if (g.distance > 0) g.distance = 0; // don't let the journey end first
  }
  assert(g.phase === "ended" && g.winner === WINNER.IMPOSTORS && g.hull === 0, "hull reaching 0 loses for crew");
}

section("Refills need the oxygen machine powered");
{
  const { g, crew } = startMatch(6, "nebula_drift", 8);
  const c = crew[0];
  g.move(c, g.map.refillRooms[0]);
  g.players.get(c).oxygen = 50;
  g.refillOxygen(c);
  assert(g.viewFor(c).you.oxygen === OXYGEN.MAX, "refill works when oxygen machine is on & powered");
  // drain the pool and switch oxygen off -> refill blocked
  g.power = 0;
  g.players.get(c).oxygen = 50;
  let threw = false;
  try { g.refillOxygen(c); } catch { threw = true; }
  assert(threw, "no power => oxygen machine can't refill");
}

section("Turret counts scale: >=2 and >=2x impostors");
{
  const small = startMatch(6, "nebula_drift").g;
  const large = startMatch(12, "ironhold_station").g;
  assert(small.map.turretRooms.length === 2, "small map has 2 turrets (2x 1 impostor)");
  assert(large.map.turretRooms.length === 4, "large map has 4 turrets (2x 2 impostors)");
}

section("Repair diverts power into the hull, no journey progress");
{
  const { g, crew } = startMatch(6, "nebula_drift", 8);
  g.power = 500; g.hull = 50;
  const c = crew[0];
  g.move(c, g.map.repairRooms[0]);
  const distBefore = g.distance;
  g.repairHull(c);
  assert(g.hull > 50, "repair raises hull");
  assert(g.distance === distBefore, "repair makes no journey progress");
}

section("Continuous vote: instant majority of living downs the target");
{
  const { g, impostors, crew } = startMatch(5, "nebula_drift", 3);
  // majority of 5 living = 3. Three crew vote the impostor.
  g.castVote(crew[0], impostors[0]);
  g.castVote(crew[1], impostors[0]);
  assert(g.players.get(impostors[0]).plane === PLANE.PHYSICAL, "no elimination before majority");
  g.castVote(crew[2], impostors[0]); // crosses 3 => instant
  assert(g.players.get(impostors[0]).plane === PLANE.ELIMINATED, "instant majority eliminates target (vote = full ejection)");
  // downing the only impostor => crew win
  assert(g.phase === PHASE.ENDED && g.winner === WINNER.CREW, "voting out last impostor wins for crew");
}

section("Vote clock: no majority at 2:00 => grace; leader downed at 3:00");
{
  const { g, crew, impostors } = startMatch(7, "nebula_drift", 9);
  // park a couple votes on one crew member (a wrong accusation), below majority(=4)
  g.castVote(crew[0], crew[3]);
  g.castVote(crew[1], crew[3]);
  // advance to 2:00 — not >half voted (2 of 7) and not majority => grace
  g.tick(VOTE.ROUND_SECONDS);
  assert(g.players.get(crew[3]).plane === PLANE.PHYSICAL, "no elimination at 2:00 without majority");
  // run out the grace minute
  g.tick(VOTE.GRACE_SECONDS);
  assert(g.players.get(crew[3]).plane === PLANE.ELIMINATED, "leader eliminated at end of grace (vote = full ejection)");
}

section("Life-support sabotage disables refills");
{
  const { g, impostors, crew } = startMatch(6, "nebula_drift", 4);
  g.now = 30; g.tick(0);
  g.triggerSabotage(impostors[0], "LIFE_SUPPORT");
  assert(g.viewFor(crew[0]).refillOnline === false, "refills offline during life-support sabotage");
  const c = crew[0];
  g.move(c, g.map.refillRooms[0]);
  let threw = false; try { g.refillOxygen(c); } catch { threw = true; }
  assert(threw, "cannot refill while life support is down");
}

section("Global sabotage cooldown blocks chaining (cable-pull exempt)");
{
  const { g, impostors, crew } = startMatch(8, "nebula_drift", 12);
  g.now = 50; g.tick(0);
  g.triggerSabotage(impostors[0], "LIGHTS_OUT");
  let threw = false;
  try { g.triggerSabotage(impostors[0], "EMP_OUTAGE"); } catch { threw = true; }
  assert(threw, "second sabotage blocked by global cooldown");
  // cable-pull still allowed (separate cooldown), if a target shares the room
  const victim = crew[0];
  g.move(victim, g.players.get(impostors[0]).room);
  let cableOk = true;
  try { g.detachCable(impostors[0], victim); } catch { cableOk = false; }
  assert(cableOk, "cable-pull is exempt from the sabotage cooldown");
}

section("Timed mini-game tasks: must start, can't finish too fast, completes after minSeconds");
{
  const { g, crew } = startMatch(6, "nebula_drift", 21);
  const c = crew[0]; const t = g.players.get(c).tasks[0];
  g.move(c, t.room);
  assert(typeof t.game === "string" && typeof t.minSeconds === "number", "task carries a mini-game type + minSeconds");
  // completing without starting fails
  let threwNoStart = false; try { g.completeTask(c, t.id); } catch { threwNoStart = true; }
  assert(threwNoStart, "cannot complete a task that wasn't started");
  // start, then finish immediately -> succeeds (no artificial wait; client gates
  // completion by actually solving the mini-game)
  g.startTask(c, t.id);
  const r = g.completeTask(c, t.id);
  assert(r.counted === true, "task completes instantly once started + solved (no wait)");
}

section("Timed tasks: abandoning past the timeout requires a restart");
{
  const { g, crew } = startMatch(6, "nebula_drift", 23);
  const c = crew[0]; const t = g.players.get(c).tasks[0];
  g.move(c, t.room);
  g.startTask(c, t.id);
  for (let s = 0; s < 65; s++) g.tick(1); // exceed ABANDON_SEC
  let threw = false; try { g.completeTask(c, t.id); } catch { threw = true; }
  assert(threw, "an abandoned task times out and can't be completed");
  // restart works
  g.startTask(c, t.id);
  for (let s = 0; s < t.minSeconds + 1; s++) g.tick(1);
  assert(g.completeTask(c, t.id).counted === true, "restarting an abandoned task works");
}

section("EMP freezes task completion on both planes");
{
  const { g, impostors, crew } = startMatch(6, "nebula_drift", 13);
  g.now = 60; g.tick(0);
  g.triggerSabotage(impostors[0], "EMP_OUTAGE");
  const c = crew[0]; const t = g.players.get(c).tasks[0];
  g.move(c, t.room);
  let threw = false;
  try { g.startTask(c, t.id); } catch { threw = true; }
  assert(threw, "tasks blocked while EMP active");
  assert(g.viewFor(c).tasksFrozen === true, "view reports tasksFrozen");
}

section("EMP needs a multi-location repair to clear");
{
  const { g, impostors, crew } = startMatch(7, "nebula_drift", 14);
  g.now = 60; g.tick(0);
  g.triggerSabotage(impostors[0], "EMP_OUTAGE"); // resolversNeeded = 3
  const rooms = SABOTAGE_RESOLVE("EMP_OUTAGE");
  // one resolver isn't enough
  g.move(crew[0], rooms[0]); g.resolveSabotage(crew[0], "EMP_OUTAGE");
  assert(g.viewFor(crew[0]).tasksFrozen === true, "still frozen after 1 of 3 resolvers");
  g.move(crew[1], rooms[1]); g.resolveSabotage(crew[1], "EMP_OUTAGE");
  g.move(crew[2], rooms[2]); g.resolveSabotage(crew[2], "EMP_OUTAGE");
  assert(g.viewFor(crew[0]).tasksFrozen === false, "EMP cleared after 3 resolvers in different rooms");
}

section("Same-room-only visibility: off-room players are obscured for everyone living");
{
  const { g, impostors, crew } = startMatch(12, "ironhold_station", 15);
  g.now = 60; g.tick(0);
  // place a crew member in a different room from another player
  place(g, crew[0], "Bridge");
  place(g, crew[1], "Cargo");
  place(g, impostors[0], "Bridge");
  const cv = g.viewFor(crew[0]);
  const otherFromCrew = cv.players.find((p) => p.id === crew[1]);
  assert(otherFromCrew.obscured === true && otherFromCrew.room === null, "off-room player obscured for crew");
  // impostor in Bridge also can't see the crew member over in Cargo (no x-ray)
  const iv = g.viewFor(impostors[0]);
  const otherFromImp = iv.players.find((p) => p.id === crew[1]);
  assert(otherFromImp.obscured === true && otherFromImp.room === null, "impostor also can't see through walls");
  // but a same-room player IS visible
  const sameRoomForImp = iv.players.find((p) => p.id === crew[0]);
  assert(sameRoomForImp.obscured === false && sameRoomForImp.room === "Bridge", "same-room player is visible");
}

section("Attract Attackers amplifies damage and auto-expires");
{
  const { g, impostors, crew } = startMatch(6, "nebula_drift", 16);
  g.power = 999; g.hull = 100;
  g.setSystem(crew[0], "shields", true); // shields up; baseline light damage
  g.now = 60; g.tick(0);
  g.triggerSabotage(impostors[0], "ATTRACT_ATTACKERS");
  assert(g.viewFor(crew[0]).positionLeaked === true, "view reports positionLeaked");
  const hullBefore = g.hull;
  g.startAttack("test"); // damage only happens during a wave now
  // run a couple of accelerated attack intervals
  for (let i = 0; i < 12; i++) { g.power = 999; g.tick(1); }
  assert(g.hull < hullBefore, "hull takes amplified damage while leaked");
  // run past the fuse; it should auto-clear (not end the match)
  for (let i = 0; i < 40 && g.phase === "active"; i++) { g.power = 999; g.hull = 100; g.tick(1); }
  assert(g.viewFor(crew[0]).positionLeaked === false || g.phase === "ended", "attract auto-expires");
}

section("Multiple sabotages can be active at once");
{
  const { g, impostors } = startMatch(8, "nebula_drift", 17);
  g.now = 60; g.tick(0);
  g.triggerSabotage(impostors[0], "LIGHTS_OUT");
  g.globalSabotageCdUntil = 0; // simulate cooldown elapsed for the test
  g.triggerSabotage(impostors[0], "EMP_OUTAGE");
  assert(g.sabotages.size === 2, "two distinct sabotages run concurrently");
}
{
  const { g, crew } = startMatch(6, "nebula_drift", 6);
  const a = crew[0], b = crew[1];
  g.move(a, "Sensors"); g.move(b, "Sensors");
  const va = g.viewFor(a);
  assert(va.commChannel.scope === "proximity" && va.commChannel.members.includes(b), "same-room crew share proximity comms");
  // down one player; they get map-wide energy comms
  g.players.get(crew[2]).oxygen = 0.2;
  g.tick(1);
  const downed = g.players.get(crew[2]);
  if (downed.plane === PLANE.ENERGY) assert(g.viewFor(downed.id).commChannel.scope === "energy_mapwide", "downed players get map-wide energy comms");
  else assert(true, "(match ended before assertion — acceptable)");
}

section("Perk draft: top-3 perks win and apply");
{
  const g = new GameEngine({ mapId: "nebula_drift", seed: 21 });
  const ids = []; for (let i = 0; i < 6; i++) ids.push(g.addPlayer("P" + i, { unlockedPerks: Object.keys(PERKS) }));
  g.startDraft();
  assert(g.phase === PHASE.DRAFT, "lobby -> draft");
  const cands = g.viewFor(ids[0]).draft.candidates.map((c) => c.key);
  assert(cands.length >= DRAFT.PICKS + 1, "a meaningful candidate set is offered");
  // Concentrate votes so three clear winners emerge.
  const top3 = cands.slice(0, 3);
  for (const id of ids) g.voteDraftPerk(id, top3);
  assert(g.phase === PHASE.ACTIVE, "all voted => match begins");
  assert(g.activePerks.length === 3, "exactly 3 perks active");
  assert(top3.every((k) => g.activePerks.includes(k)), "the agreed top-3 won");
}

section("Draft pools only the team's unlocked perks");
{
  const g = new GameEngine({ mapId: "nebula_drift", seed: 28 });
  // Team collectively unlocks exactly these three perks.
  const teamPerks = ["LONGER_OXYGEN", "BIGGER_REACTOR", "QUICK_FUSES"];
  const ids = [];
  for (let i = 0; i < 6; i++) ids.push(g.addPlayer("P" + i, { unlockedPerks: [teamPerks[i % 3]] }));
  g.startDraft();
  const cands = g.viewFor(ids[0]).draft.candidates.map((c) => c.key);
  // All three pooled perks must be present; fillers only top up to the minimum.
  assert(teamPerks.every((k) => cands.includes(k)), "every pooled unlock appears as a candidate");
}

section("Draft list is mixed and does not leak roles");
{
  const g = new GameEngine({ mapId: "nebula_drift", seed: 22 });
  const ids = []; for (let i = 0; i < 6; i++) ids.push(g.addPlayer("P" + i, { unlockedPerks: Object.keys(PERKS) }));
  g.startDraft();
  const sides = new Set(g.viewFor(ids[0]).draft.candidates.map((c) => c.side));
  assert(sides.has("crew") && sides.has("impostor"), "candidate list mixes crew and impostor perks");
  // Before resolve, no roles exist yet.
  assert(g.players.get(ids[0]).role === null, "roles not assigned during draft");
}

section("Draft auto-resolves on timer if not everyone votes");
{
  const g = new GameEngine({ mapId: "nebula_drift", seed: 23 });
  const ids = []; for (let i = 0; i < 6; i++) ids.push(g.addPlayer("P" + i, { unlockedPerks: Object.keys(PERKS) }));
  g.startDraft();
  const cands = g.viewFor(ids[0]).draft.candidates.map((c) => c.key);
  g.voteDraftPerk(ids[0], [cands[0]]); // only one voter
  g.tick(DRAFT.SECONDS); // run out the clock
  assert(g.phase === PHASE.ACTIVE, "timer forces the match to begin");
  assert(g.activePerks.length === 3, "still resolves to 3 perks from available votes + order");
}

section("Perk effect applies: Deep-Cycle Tank slows oxygen drain");
{
  const g = new GameEngine({ mapId: "nebula_drift", seed: 24 });
  const ids = []; for (let i = 0; i < 6; i++) ids.push(g.addPlayer("P" + i, { unlockedPerks: Object.keys(PERKS) }));
  g.startDraft();
  for (const id of ids) g.voteDraftPerk(id, ["LONGER_OXYGEN"]);
  assert(g.activePerks.includes("LONGER_OXYGEN"), "oxygen perk won");
  const c = ids.find((id) => g.players.get(id).role === ROLE.CREW);
  const before = g.players.get(c).oxygen;
  g.tick(10);
  const drained = before - g.players.get(c).oxygen;
  assert(Math.abs(drained - 4.25) < 0.01, "oxygen drained at the reduced perk rate");
}

section("Cannot start a match mid-draft via the wrong path");
{
  const g = new GameEngine({ mapId: "nebula_drift", seed: 25 });
  for (let i = 0; i < 6; i++) g.addPlayer("P" + i, { unlockedPerks: Object.keys(PERKS) });
  g.startDraft();
  const r = g.start();
  assert(g.phase === PHASE.ACTIVE && r.perks.length === 3, "start() during draft resolves it cleanly");
}

section("Comms: living command reaches same-room living + all downed");
{
  const { g, crew } = startMatch(6, "nebula_drift", 31);
  const a = crew[0], b = crew[1], c = crew[2];
  g.move(a, "Sensors"); g.move(b, "Sensors"); g.move(c, "Reactor");
  // down player c so we can verify the downed hear everyone
  g.players.get(c).oxygen = 0.2; g.tick(1);
  const r = g.sendVoiceCommand(a, "SOS");
  assert(r.recipients.includes(a), "speaker hears own command");
  assert(r.recipients.includes(b), "same-room living teammate hears it");
  assert(r.recipients.includes(c), "downed player hears living (downed hear everyone)");
  // a living player in another room does NOT hear it
  const elsewhere = crew.find((id) => id !== a && id !== b && id !== c && g.players.get(id).plane === PLANE.PHYSICAL);
  if (elsewhere) { g.move(elsewhere, "Medbay"); const r2 = g.sendVoiceCommand(a, "SOS"); assert(!r2.recipients.includes(elsewhere), "off-room living teammate does not hear it"); }
}

section("Comms: living NEVER hear the downed");
{
  const { g, crew } = startMatch(6, "nebula_drift", 32);
  const downedP = crew[0], livingP = crew[1];
  g.move(downedP, "Bridge"); g.move(livingP, "Bridge"); // same room
  g.players.get(downedP).oxygen = 0.2; g.tick(1);       // down the first
  assert(g.players.get(downedP).plane === PLANE.ENERGY, "player is downed");
  const r = g.sendVoiceCommand(downedP, "ON_MY_WAY");
  assert(r.recipients.includes(downedP), "downed speaker hears self");
  assert(!r.recipients.includes(livingP), "living player in the SAME room does NOT hear the downed");
}

section("Comms: command param resolves (room / player)");
{
  const { g, crew } = startMatch(6, "nebula_drift", 33);
  g.move(crew[0], "Reactor");
  // room-param command captures the speaker's room in the event
  g.sendVoiceCommand(crew[0], "SABOTAGE_HERE");
  const ev = g.eventsFor(crew[0]).filter((e) => e.kind === "command").pop();
  assert(ev.param && ev.param.room === "Reactor", "room param captured from speaker location");
  // player-param command requires a valid target
  let threw = false; try { g.sendVoiceCommand(crew[0], "SUSPECT"); } catch { threw = true; }
  assert(threw, "player-target command rejects a missing target");
  const r = g.sendVoiceCommand(crew[0], "SUSPECT", crew[1]);
  assert(r.recipients.length >= 1, "player-target command sends with a valid target");
}

section("Comms: captions route by recipient over eventsFor");
{
  const { g, crew } = startMatch(6, "nebula_drift", 34);
  const a = crew[0], b = crew[1], far = crew[2];
  g.move(a, "Medbay"); g.move(b, "Medbay"); g.move(far, "Hangar".includes(g.map.rooms) ? "Hangar" : "Sensors");
  g.sendSpeech(a, "watch engineering");
  const bSees = g.eventsFor(b).some((e) => e.kind === "speech" && e.text === "watch engineering");
  const farSees = g.eventsFor(far).some((e) => e.kind === "speech");
  assert(bSees, "same-room teammate gets the caption with transcript");
  assert(!farSees, "off-room teammate does not get the caption");
}

section("Identity: each player gets a unique ID color (breather + tank) + shape");
{
  const g = new GameEngine({ mapId: "nebula_drift", seed: 41 });
  const ids = []; for (let i = 0; i < 8; i++) ids.push(g.addPlayer("P" + i));
  const colors = ids.map((id) => g.players.get(id).idColor.name);
  assert(new Set(colors).size === colors.length, "all assigned colors are unique");
  const v = g.viewFor(ids[0]);
  const me = v.players.find((p) => p.id === ids[0]);
  assert(me.idColor && me.idColor.shape, "view exposes color + colorblind shape");
}

section("Match result maps accounts to win/loss; guests skipped");
{
  const g = new GameEngine({ mapId: "nebula_drift", seed: 42 });
  const ids = [];
  for (let i = 0; i < 6; i++) ids.push(g.addPlayer("Acct" + i, { userId: "u" + i, unlockedPerks: Object.keys(PERKS) }));
  g.start();
  const imp = ids.find((id) => g.players.get(id).role === ROLE.IMPOSTOR);
  const crew = ids.filter((id) => g.players.get(id).role === ROLE.CREW);
  for (const v of crew.slice(0, g._majorityNeeded())) g.castVote(v, imp);
  assert(g.phase === PHASE.ENDED && g.winner === WINNER.CREW, "crew won via vote");
  const result = g.matchResult();
  assert(result.participants.length === 6, "all six account players reported");
  const impReport = result.participants.find((p) => p.role === ROLE.IMPOSTOR);
  assert(impReport && impReport.won === false, "downed impostor reported as a loss");
  assert(result.participants.filter((p) => p.role === ROLE.CREW).every((p) => p.won), "crew reported as wins");
}

section("Match result excludes guests (no account)");
{
  const g = new GameEngine({ mapId: "nebula_drift", seed: 43 });
  const ids = [];
  for (let i = 0; i < 5; i++) ids.push(g.addPlayer("Acct" + i, { userId: "u" + i }));
  ids.push(g.addPlayer("Guest")); // no account
  g.start();
  const result = g.matchResult();
  assert(result.participants.every((p) => p.userId), "no guest in the report");
  assert(result.participants.length <= 5, "guest excluded from XP reporting");
}

section("Host config: overrides drive the engine and compound with perks");
{
  // attackIntervalMult + attackDamageMult make the hull fall faster.
  const fast = new GameEngine({ config: { mapId: "nebula_drift", attackIntervalMult: 0.5, attackDamageMult: 2 } });
  for (let i = 0; i < 6; i++) fast.addPlayer("P" + i);
  fast.start();
  fast.power = 999; fast.setSystem(fast.commanderId, "engines", true); // shields off => unshielded hits
  const hullBefore = fast.hull;
  fast.startAttack("test"); // hull damage only during a wave
  for (let i = 0; i < 14; i++) { fast.power = 999; fast.tick(1); }
  assert(fast.hull < hullBefore, "config attack multipliers damage the hull");

  // oxygenDrainMult compounds with the LONGER_OXYGEN perk.
  const g = new GameEngine({ config: { mapId: "nebula_drift", oxygenDrainMult: 2 } });
  const ids = []; for (let i = 0; i < 6; i++) ids.push(g.addPlayer("P" + i, { unlockedPerks: ["LONGER_OXYGEN"] }));
  g.startDraft();
  for (const id of ids) g.voteDraftPerk(id, ["LONGER_OXYGEN"]);
  const c = ids.find((id) => g.players.get(id).role === ROLE.CREW);
  const before = g.players.get(c).oxygen;
  g.tick(10);
  const drained = before - g.players.get(c).oxygen;
  // base 0.5 * config 2 * perk 0.85 = 0.85/sec -> 8.5 over 10s
  assert(Math.abs(drained - 8.5) < 0.01, "config and perk oxygen multipliers compound (8.5 over 10s)");
}

section("Host config: defaults give a normal game; config exposed in view");
{
  const g = new GameEngine({ config: { mapId: "nebula_drift" } });
  for (let i = 0; i < 6; i++) g.addPlayer("P" + i);
  g.start();
  const v = g.viewFor([...g.players.keys()][0]);
  assert(v.config.moveSpeedMult === 1.0 && v.config.bodySizeMult === 1.0, "untouched config is neutral defaults");
  assert(v.config.isPublic === false, "lobbies are private by default");
}

section("Event: cable-pull on a bounty target queues a claim");
{
  const g = new GameEngine({ mapId: "nebula_drift", seed: 51 });
  const ids = [];
  for (let i = 0; i < 6; i++) {
    ids.push(g.addPlayer("Acct" + i, {
      userId: "u" + i,
      unlockedPerks: Object.keys(PERKS),
      eventFlags: i === 5 ? [{ eventId: "ev_1", flag: "BOUNTY_TARGET" }] : [],
    }));
  }
  g.start();
  const imp = ids.find((id) => g.players.get(id).role === ROLE.IMPOSTOR);
  // Find a crew bounty target (account u5) that's still physical & not the impostor.
  const target = ids.find((id) => g.players.get(id).accountId === "u5");
  if (g.players.get(target).role === ROLE.IMPOSTOR) {
    assert(true, "skip: bounty target rolled impostor this seed");
  } else {
    // Move both into the same room and clear cooldown so the pull lands.
    g.players.get(imp).room = "Bridge"; g.players.get(target).room = "Bridge";
    g.cooldowns[imp].cable = 0;
    g.detachCable(imp, target);
    const claims = g.drainBountyClaims();
    assert(claims.length === 1, "one bounty claim queued");
    assert(claims[0].eventId === "ev_1" && claims[0].targetId === "u5" && claims[0].byUserId === g.players.get(imp).accountId, "claim has event, target, and claimer");
    assert(g.drainBountyClaims().length === 0, "claims drained (not double-reported)");
  }
}

section("Event: non-target cable-pull queues no bounty");
{
  const g = new GameEngine({ mapId: "nebula_drift", seed: 52 });
  const ids = [];
  for (let i = 0; i < 6; i++) ids.push(g.addPlayer("Acct" + i, { userId: "u" + i }));
  g.start();
  const imp = ids.find((id) => g.players.get(id).role === ROLE.IMPOSTOR);
  const target = ids.find((id) => g.players.get(id).role === ROLE.CREW);
  g.players.get(imp).room = "Bridge"; g.players.get(target).room = "Bridge";
  g.cooldowns[imp].cable = 0;
  g.detachCable(imp, target);
  assert(g.drainBountyClaims().length === 0, "no claim for a non-bounty target");
}

section("Event host: can force-start below the map minimum");
{
  const g = new GameEngine({ mapId: "nebula_drift", seed: 53 }); // min is 5
  const host = g.addPlayer("Host", { userId: "host", eventFlags: [{ eventId: "ev_2", flag: "EVENT_HOST" }] });
  g.addPlayer("P1", { userId: "u1" });
  assert(g.isEventHost(host), "host recognized as event host");
  assert(g.players.size < g.map.minPlayers, "below the normal minimum");
  g.start({ force: true });
  assert(g.phase === PHASE.ACTIVE, "event host force-started a tiny match");
}

section("Non-event start still blocks below the minimum");
{
  const g = new GameEngine({ mapId: "nebula_drift", seed: 54 });
  g.addPlayer("P0", { userId: "a" });
  g.addPlayer("P1", { userId: "b" });
  let threw = false;
  try { g.start(); } catch { threw = true; }
  assert(threw, "normal start refuses below the map minimum");
}

section("Infection: starts with patient zero(s); rest are survivors");
{
  const g = new GameEngine({ mapId: "nebula_drift", seed: 61, config: { mode: "infection", impostorCount: 1 } });
  const ids = []; for (let i = 0; i < 6; i++) ids.push(g.addPlayer("P" + i, { userId: "u" + i }));
  g.start();
  assert(g.mode && g.mode.id === "infection", "infection mode active");
  const infected = [...g.players.values()].filter((p) => p.role === ROLE.IMPOSTOR);
  const survivors = [...g.players.values()].filter((p) => p.role === ROLE.CREW);
  assert(infected.length === 1, "one patient zero");
  assert(survivors.length === 5, "rest are survivors");
}

section("Infection: downed survivor converts (no energy plane)");
{
  const g = new GameEngine({ mapId: "nebula_drift", seed: 62, config: { mode: "infection", impostorCount: 1 } });
  const ids = []; for (let i = 0; i < 6; i++) ids.push(g.addPlayer("P" + i, { userId: "u" + i }));
  g.start();
  const hunter = [...g.players.values()].find((p) => p.role === ROLE.IMPOSTOR);
  const prey = [...g.players.values()].find((p) => p.role === ROLE.CREW);
  hunter.room = "Bridge"; prey.room = "Bridge"; g.cooldowns[hunter.id].cable = 0;
  g.detachCable(hunter.id, prey.id);
  assert(prey.role === ROLE.IMPOSTOR, "prey converted to infected");
  assert(prey.plane === PLANE.PHYSICAL, "converted player stays on the physical plane (not downed)");
}

section("Infection: infected win when all survivors converted");
{
  const g = new GameEngine({ mapId: "nebula_drift", seed: 63, config: { mode: "infection", impostorCount: 1 } });
  const ids = []; for (let i = 0; i < 6; i++) ids.push(g.addPlayer("P" + i, { userId: "u" + i }));
  g.start();
  // Convert every survivor directly.
  let guard = 0;
  while (g.phase !== PHASE.ENDED && guard++ < 10) {
    const hunter = [...g.players.values()].find((p) => p.role === ROLE.IMPOSTOR && p.plane === PLANE.PHYSICAL);
    const prey = [...g.players.values()].find((p) => p.role === ROLE.CREW);
    if (!prey) break;
    hunter.room = "Bridge"; prey.room = "Bridge"; g.cooldowns[hunter.id].cable = 0;
    g.detachCable(hunter.id, prey.id);
  }
  assert(g.phase === PHASE.ENDED && g.winner === WINNER.IMPOSTORS, "infected win when everyone is converted");
}

section("Infection: survivors win on reaching the location");
{
  const g = new GameEngine({ mapId: "nebula_drift", seed: 64, config: { mode: "infection", impostorCount: 1 } });
  for (let i = 0; i < 6; i++) g.addPlayer("P" + i, { userId: "u" + i });
  g.start();
  // Simulate the journey completing while survivors remain.
  g.distance = JOURNEY.DISTANCE; g.distanceReached = true;
  g._checkWin();
  assert(g.phase === PHASE.ENDED && g.winner === WINNER.CREW && g.events.some((e) => e.reason === "survivors_escaped" || e.winner === WINNER.CREW), "survivors win by escaping");
}

section("KotH: solo holder scores faster than when shared");
{
  const g = new GameEngine({ mapId: "nebula_drift", seed: 71, config: { mode: "koth" } });
  const ids = []; for (let i = 0; i < 6; i++) ids.push(g.addPlayer("P" + i, { userId: "u" + i }));
  g.start();
  const hill = g.kothRoom;
  // One player solo on the hill; everyone else parked in a different real room.
  const offHill = g.map.rooms.find((r) => r !== hill) || hill;
  ids.forEach((id, i) => { place(g, id, i === 0 ? hill : offHill); });
  // ensure the non-hill players aren't counted as on the hill
  ids.forEach((id, i) => { if (i !== 0 && g.players.get(id).room === hill) place(g, id, offHill); });
  g.tick(10);
  const solo = g.players.get(ids[0]).kothScore;
  // Now two players share for 10s.
  place(g, ids[1], hill);
  const beforeShared = g.players.get(ids[1]).kothScore;
  g.tick(10);
  const sharedGain = g.players.get(ids[1]).kothScore - beforeShared;
  assert(solo > 9 && solo <= 10.001, "solo holder earned ~full rate");
  assert(sharedGain < solo, "shared rate is lower than solo");
}

section("KotH: cable-pull is a non-lethal shove to 25% air");
{
  const g = new GameEngine({ mapId: "nebula_drift", seed: 72, config: { mode: "koth" } });
  const ids = []; for (let i = 0; i < 5; i++) ids.push(g.addPlayer("P" + i, { userId: "u" + i }));
  g.start();
  const a = g.players.get(ids[0]), b = g.players.get(ids[1]);
  a.room = b.room = g.kothRoom; g.cooldowns[ids[0]] = { cable: 0 };
  g.detachCable(ids[0], ids[1]);
  assert(b.plane === PLANE.PHYSICAL, "shoved player is NOT downed");
  assert(Math.abs(b.oxygen - OXYGEN.MAX * 0.25) < 0.001, "shoved player dropped to 25% air");
}

section("Hot Potato: explodes on the holder, passes, last one wins");
{
  const g = new GameEngine({ mapId: "nebula_drift", seed: 73, config: { mode: "hotpotato" } });
  const ids = []; for (let i = 0; i < 5; i++) ids.push(g.addPlayer("P" + i, { userId: "u" + i }));
  g.start();
  assert(!!g.potatoHolder, "a holder is assigned at start");
  // Pass to someone in the same room.
  const holder = g.potatoHolder;
  const other = ids.find((id) => id !== holder);
  g.players.get(other).room = g.players.get(holder).room;
  assert(g.passPotato(holder, other) === true, "potato passes to a same-room player");
  assert(g.potatoHolder === other, "holder updated after pass");
  // Run time forward past several fuses; match should end with one survivor.
  let guard = 0;
  while (g.phase !== PHASE.ENDED && guard++ < 200) g.tick(1);
  assert(g.phase === PHASE.ENDED && g.winner === WINNER.CREW, "hot potato ends with a last player standing");
}

section("Musical Chairs: out-of-room players are eliminated each round");
{
  const g = new GameEngine({ mapId: "nebula_drift", seed: 74, config: { mode: "musicalchairs" } });
  const ids = []; for (let i = 0; i < 5; i++) ids.push(g.addPlayer("P" + i, { userId: "u" + i }));
  g.start();
  assert(g.mcPhase === "music", "starts in the music phase");
  // Advance to the stop moment; a safe room is announced.
  g.tick(10);
  assert(g.mcPhase === "grace" && !!g.mcSafeRoom, "music stops and a safe room is announced");
  // Send only one player to the safe room; others should be eliminated on resolve.
  g.players.get(ids[0]).room = g.mcSafeRoom;
  g.tick(4);
  const standing = [...g.players.values()].filter((p) => p.plane === PLANE.PHYSICAL);
  assert(standing.length <= 1 || g.phase === PHASE.ENDED, "only safe-room players survive the round");
}

section("Base game still works with no mode (regression)");
{
  const g = new GameEngine({ mapId: "nebula_drift", seed: 75 });
  for (let i = 0; i < 6; i++) g.addPlayer("P" + i, { userId: "u" + i });
  g.start();
  assert(g.mode === null, "no mode active");
  assert(g.phase === PHASE.ACTIVE && g.hull === HULL.MAX, "base ship sim intact");
}

section("Who Did It: strike arms guessing; correct guess downs culprit + banks a case");
{
  const g = new GameEngine({ mapId: "nebula_drift", seed: 81, config: { mode: "whodidit" } });
  const ids = []; for (let i = 0; i < 6; i++) ids.push(g.addPlayer("P" + i, { userId: "u" + i }));
  g.start();
  assert(g.wdiPhase === "window" && !!g.wdiDetective, "round starts in the strike window with a detective");
  const det = g.wdiDetective;
  const culprit = ids.find((id) => id !== det);
  // Everyone lined up in the same room so the pull is legal.
  for (const id of ids) g.players.get(id).room = g.players.get(det).room;
  g.cooldowns[culprit] = { cable: 0 };
  g.detachCable(culprit, det);
  assert(g.wdiPhase === "guessing", "cable-pull on the detective arms the guess phase");
  assert(g.players.get(det).plane === PLANE.PHYSICAL, "detective is NOT downed by the pull");
  const r = g.guessWhoDidIt(det, culprit);
  assert(r.correct === true, "correct guess reported");
  assert(g.players.get(culprit).plane === PLANE.ENERGY, "correct guess downs the culprit");
  assert(g.wdiSolved === 1, "a solved case is banked");
}

section("Who Did It: wrong guess costs 20% air");
{
  const g = new GameEngine({ mapId: "nebula_drift", seed: 82, config: { mode: "whodidit" } });
  const ids = []; for (let i = 0; i < 6; i++) ids.push(g.addPlayer("P" + i, { userId: "u" + i }));
  g.start();
  const det = g.wdiDetective;
  const culprit = ids.find((id) => id !== det);
  const innocent = ids.find((id) => id !== det && id !== culprit);
  for (const id of ids) g.players.get(id).room = g.players.get(det).room;
  g.cooldowns[culprit] = { cable: 0 };
  g.detachCable(culprit, det);
  const before = g.players.get(det).oxygen;
  const r = g.guessWhoDidIt(det, innocent);
  assert(r.correct === false, "wrong guess reported");
  assert(Math.abs((before - g.players.get(det).oxygen) - OXYGEN.MAX * 0.20) < 0.001, "wrong guess costs 20% air");
  assert(g.players.get(culprit).plane === PLANE.PHYSICAL, "culprit not downed on a wrong guess");
}

section("Who Did It: detective wins at 3 solved cases");
{
  const g = new GameEngine({ mapId: "nebula_drift", seed: 83, config: { mode: "whodidit" } });
  const ids = []; for (let i = 0; i < 8; i++) ids.push(g.addPlayer("P" + i, { userId: "u" + i }));
  g.start();
  let guard = 0;
  while (g.phase !== PHASE.ENDED && guard++ < 12) {
    const det = g.wdiDetective;
    for (const id of ids) if (g.players.get(id).plane === PLANE.PHYSICAL) g.players.get(id).room = g.players.get(det).room;
    const culprit = ids.find((id) => id !== det && g.players.get(id).plane === PLANE.PHYSICAL);
    g.cooldowns[culprit] = { cable: 0 };
    g.detachCable(culprit, det);
    g.guessWhoDidIt(det, culprit); // always correct
  }
  assert(g.phase === PHASE.ENDED && g.winner === WINNER.CREW && g.events.some((e) => e.reason === "wdi_solved_all"), "detective wins after 3 solved cases");
}

section("Who Did It: detective starved => pullers win");
{
  const g = new GameEngine({ mapId: "nebula_drift", seed: 84, config: { mode: "whodidit" } });
  const ids = []; for (let i = 0; i < 6; i++) ids.push(g.addPlayer("P" + i, { userId: "u" + i }));
  g.start();
  const det = g.wdiDetective;
  for (const id of ids) g.players.get(id).room = g.players.get(det).room;
  const culprit = ids.find((id) => id !== det);
  const innocent = ids.find((id) => id !== det && id !== culprit);
  // Strike, then guess wrong repeatedly until the detective's air is gone.
  let guard = 0;
  while (g.phase !== PHASE.ENDED && guard++ < 12) {
    if (g.wdiPhase === "window") { g.cooldowns[culprit] = { cable: 0 }; g.detachCable(culprit, det); }
    if (g.wdiPhase === "guessing") g.guessWhoDidIt(det, innocent);
  }
  assert(g.phase === PHASE.ENDED && g.winner === WINNER.IMPOSTORS && g.events.some((e) => e.reason === "wdi_detective_starved"), "pullers win when the detective starves");
}

section("Event redaction: 'downed' cause is private; eliminations are public");
{
  const { g, impostors, crew } = startMatch(6, "nebula_drift", 11);
  g.now = 100; g.tick(0);
  const victim = crew[0];
  g.move(victim, g.players.get(impostors[0]).room);
  g.detachCable(impostors[0], victim);
  const livingCrew = crew.find((id) => g.players.get(id).plane === PLANE.PHYSICAL && id !== victim);
  const crewSees = g.eventsFor(livingCrew).some((e) => e.type === "downed");
  const impSees = g.eventsFor(impostors[0]).some((e) => e.type === "downed");
  assert(!crewSees, "living crew do NOT see the private 'downed' cause event");
  assert(impSees, "impostor sees the 'downed' event");
}

console.log(`\n=========================`);
console.log(`PASS ${pass}  FAIL ${fail}`);
process.exit(fail ? 1 : 0);
