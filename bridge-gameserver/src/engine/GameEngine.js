// ============================================================
// Authoritative Game Engine v0.2 — pure logic, no networking.
// Holds the FULL truth of a match. Players never receive this object;
// they get redacted views via viewFor(playerId). Role identity and the
// energy-plane channel never leak to players who shouldn't see them.
//
// v0.2 mechanics (the "breather / energy-plane" model):
//  - Every player wears an O2 tank that drains over time; refill at stations.
//  - Empty tank, a cable-pull by an impostor, or a passed vote => DOWNED:
//    the player crosses to the ENERGY PLANE (a mirror map) instead of being
//    removed. There they get energy-themed tasks that feed the SAME shared bar.
//  - Sabotaging Life Support disables all refill stations (the core crisis).
//  - Voting is CONTINUOUS on a 2-min clock (no meeting phase). Majority of
//    living players unplugs a tank -> "Player eliminated."
//  - Comms: physical players talk to others IN THE SAME ROOM; downed players
//    share one map-wide energy channel.
//
// BALANCE NOTE: a downed impostor's energy-plane tasks also feed the crew's
// shared bar (per design). That means downing an impostor helps the crew —
// intentional for now; flagged here so we can revisit if it feels off.
// ============================================================

import {
  PHASE, ROLE, PLANE, WINNER, SYSTEMS, REACTOR_CAPACITY,
  OXYGEN, VOTE, SABOTAGE, MAPS, ROOM_TASKS, ENERGY_TASKS,
  MINIGAMES, TASK, PHYSICAL_GAMES, ENERGY_GAMES,
  POWER, JOURNEY, MOVE, HULL, ATTRACT, GLOBAL_SABOTAGE_COOLDOWN_SEC,
  DRAFT, PERKS, VOICE_COMMANDS, ID_COLORS, MATCH_CONFIG_DEFAULTS,
} from "./constants.js";
import { getMode } from "./modes/index.js";

let seq = 1;
const newId = (p) => `${p}_${seq++}`;

import { makeRng, shuffle } from "./rng.js";
import { generateMap, buildGeometry } from "./mapgen.js";

export class GameEngine {
  constructor({ mapId = "procedural", seed = null, config = {}, map = null } = {}) {
    // Resolve host config over defaults. mapId in config wins if provided.
    this.config = { ...MATCH_CONFIG_DEFAULTS, ...config };
    const resolvedMapId = config.mapId || mapId;
    // Map resolution order: an explicit map object > a "procedural:N" request >
    // a named map in the MAPS table (named maps are themselves frozen generated
    // layouts). "procedural" with no size generates from the config's player hint.
    let resolved = map;
    if (!resolved && typeof resolvedMapId === "string" && resolvedMapId.startsWith("procedural")) {
      const players = Number(resolvedMapId.split(":")[1]) || config.players || 8;
      resolved = generateMap({ players, seed });
    }
    if (!resolved) resolved = MAPS[resolvedMapId];
    if (!resolved) throw new Error(`Unknown map: ${resolvedMapId}`);
    
    // Auto-generate geometry for legacy maps that don't have it, so IsoStage renders
    if (!resolved.geometry) {
      // Need a deep clone to avoid mutating the shared MAPS constant across instances
      resolved = JSON.parse(JSON.stringify(resolved));
      resolved.geometry = buildGeometry(resolved.rooms, resolved.adjacency, resolved.spawnRoom);
    }
    
    this.config.mapId = resolved.id || resolvedMapId;
    this.map = resolved;
    this.mode = getMode(this.config.mode); // active game mode (null = base rules)
    this.distanceReached = false;          // set by tick() when the journey completes
    this.rng = makeRng(seed);
    this.phase = PHASE.LOBBY;
    this.players = new Map();
    this.energy = Object.fromEntries(SYSTEMS.map((s) => [s, 0]));
    this.commanderId = null;
    this.sabotages = new Map(); // kind -> { kind,label,resolveRooms,resolversNeeded,resolvedBy,expiresAt,flags }
    this.globalSabotageCdUntil = 0; // shared cooldown gate for triggering ANY sabotage
    this.winner = WINNER.NONE;
    this.events = [];
    this.now = 0;
    this.cooldowns = {};
    // continuous vote state
    this.voteRoundStartedAt = 0;
    this.votes = new Map(); // voterId -> targetId
    // ---- v0.3 power economy / combat / journey ----
    this.power = POWER.START;     // running power pool; tasks add, systems drain
    this.hull = HULL.MAX;         // 0 => crew loss
    this.distance = 0;            // toward JOURNEY.DISTANCE => crew win
    this.lastAttackAt = 0;        // attack-wave cadence
    // Crew route power between shields and engines using a 5-level slider (0=100% Shield, 5=100% Engine)
    this.systems = { engineLevel: 0 };
    this.airlockLocked = false;     // true when airlock sabotage is active
    this.airlockBanging = new Set(); // playerIds banging on the airlock door
    this.globalAttack = null;        // { startedAt, shipsTotal: 10, shipsDestroyed: 0, shipsEscaped: 0, difficulty: 1 }
    this.globalAttackCdUntil = 30;   // cooldown before next attack can start (first attack waits 30s)
    this.helmMomentum = { target: 0, current: 0 }; // for gradual speed changes
    // ---- v0.4 perk draft ----
    this.draft = null;          // { candidates:[keys], votes:Map(voterId->Set(keys)), startedAt }
    this.activePerks = [];      // resolved perk keys in effect this match
    this._perkEffects = {};     // merged effect magnitudes (computed at draft resolve)
  }

  _log(type, data = {}) { this.events.push({ t: this.now, type, ...data }); }

  // ---------- lobby ----------
  // account (optional): { userId, loadout, unlockedPerks } from the backend.
  // Guests (no account) get defaults and contribute no perks to the pool.
  addPlayer(name, account = null) {
    if (this.phase !== PHASE.LOBBY) throw new Error("Match already started.");
    if (this.players.size >= this.map.maxPlayers) throw new Error("Match is full.");
    const id = newId("p");
    this.players.set(id, {
      id, name,
      accountId: account?.userId || null,
      isBot: !!account?.isBot,                    // server-driven bot player
      botTier: account?.botTier || null,
      loadout: account?.loadout || {},          // equipped cosmetics (what others see)
      unlockedPerks: account?.unlockedPerks || [], // pooled into the draft
      eventFlags: account?.eventFlags || [],     // active-event roles (bounty target / event host)
      idColor: this._assignIdColor(),  // forced per-match identity color (on breather + O2 tank)
      role: null,
      plane: PLANE.PHYSICAL,
      oxygen: OXYGEN.MAX,
      room: this.map.spawnRoom,
      // continuous position (world units). Spawn at the room's center if the map
      // has geometry; movement updates x/y each tick toward (tx,ty).
      ...this._spawnXY(this.map.spawnRoom),
      tasks: [],
      connected: true,
    });
    this._log("player_joined", { id, name });
    return id;
  }

  // Center of a room in world units (or null coords if the map has no geometry).
  _spawnXY(room) {
    const r = this.map.geometry?.rooms?.[room];
    if (!r) return { x: null, y: null, tx: null, ty: null };
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2 + 150; // offset below center furniture
    return { x: cx, y: cy, tx: cx, ty: cy };
  }

  // Which room contains a world point (or null). Used to derive room from x/y.
  _roomAt(x, y) {
    const g = this.map.geometry; if (!g) return null;
    for (const [name, r] of Object.entries(g.rooms)) {
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return name;
    }
    return null;
  }

  // Pick an unused identification color (with a colorblind shape) for this player.
  _assignIdColor() {
    const used = new Set([...this.players.values()].map((p) => p.idColor?.name));
    const free = ID_COLORS.find((c) => !used.has(c.name)) || ID_COLORS[this.players.size % ID_COLORS.length];
    return free;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    if (this.phase === PHASE.LOBBY) this.players.delete(id);
    else p.connected = false;
    this._log("player_left", { id });
  }

  // ---------- perk draft (before roles are revealed) ----------
  // Move lobby -> draft and present a MIXED candidate list of crew+impostor perks.
  startDraft({ force = false } = {}) {
    if (this.phase !== PHASE.LOBBY) throw new Error("Draft can only start from the lobby.");
    if (!force && this.players.size < this.map.minPlayers) throw new Error(`Need at least ${this.map.minPlayers} players.`);
    // Candidate pool = the UNION of every player's unlocked perks (pooled team
    // unlocks). Still a mixed crew/impostor list, so it can't leak roles. If the
    // pool is too small (e.g. all guests, low levels), top it up from the full
    // catalogue so there's always something meaningful to vote on.
    const pooled = new Set();
    for (const p of this.players.values()) for (const k of (p.unlockedPerks || [])) if (PERKS[k]) pooled.add(k);
    let candidates = shuffle([...pooled], this.rng);
    if (candidates.length < DRAFT.PICKS + 1) {
      const filler = shuffle(Object.keys(PERKS).filter((k) => !pooled.has(k)), this.rng);
      candidates = candidates.concat(filler).slice(0, Math.max(DRAFT.PICKS + 2, candidates.length));
    }
    this.draft = { candidates, votes: new Map(), startedAt: this.now };
    this.phase = PHASE.DRAFT;
    this._log("draft_started", { candidates, picks: DRAFT.PICKS, seconds: DRAFT.SECONDS });
  }

  // A player votes for a set of perks (up to PICKS). You vote perks directly.
  voteDraftPerk(playerId, perkKeys) {
    if (this.phase !== PHASE.DRAFT) throw new Error("No draft in progress.");
    const p = this._player(playerId);
    const keys = (Array.isArray(perkKeys) ? perkKeys : [perkKeys]).filter((k) => this.draft.candidates.includes(k));
    if (keys.length === 0) throw new Error("Pick at least one valid perk.");
    if (keys.length > DRAFT.PICKS) throw new Error(`Pick at most ${DRAFT.PICKS} perks.`);
    this.draft.votes.set(playerId, new Set(keys));
    this._log("draft_vote", { by: playerId, count: keys.length });
    // If everyone present has voted, resolve immediately.
    if (this.draft.votes.size >= this.players.size) this.resolveDraft();
  }

  _tallyDraft() {
    const counts = {};
    for (const set of this.draft.votes.values()) for (const k of set) counts[k] = (counts[k] || 0) + 1;
    // Deterministic tie-break by candidate order so resolution is stable.
    return this.draft.candidates
      .map((k) => ({ k, n: counts[k] || 0 }))
      .sort((a, b) => b.n - a.n || this.draft.candidates.indexOf(a.k) - this.draft.candidates.indexOf(b.k));
  }

  // Resolve the draft: top PICKS perks win, then proceed to role assignment.
  resolveDraft() {
    if (this.phase !== PHASE.DRAFT) throw new Error("No draft to resolve.");
    const ranked = this._tallyDraft();
    this.activePerks = ranked.slice(0, DRAFT.PICKS).map((r) => r.k);
    this._computePerkEffects();
    this._log("draft_resolved", { perks: this.activePerks });
    this.draft = null;
    return this._beginMatch();
  }

  // Merge the magnitudes of all active perks into a single effects object.
  _computePerkEffects() {
    const e = {};
    for (const key of this.activePerks) {
      const perk = PERKS[key]; if (!perk) continue;
      for (const [k, v] of Object.entries(perk.effect)) {
        if (k.endsWith("Mult")) e[k] = (e[k] ?? 1) * v;   // multipliers compound
        else e[k] = (e[k] ?? 0) + v;                      // bonuses add
      }
    }
    this._perkEffects = e;
    // Apply one-time start-of-match bonuses now.
    if (e.powerMaxMult) this._powerMax = POWER.MAX * e.powerMaxMult;
    if (e.hullBonus) this.hull = Math.min((HULL.MAX + e.hullBonus), this.hull + e.hullBonus);
  }
  // Perk-aware AND config-aware getters. Host config multipliers compound with
  // perk multipliers (both apply), so a custom lobby + drafted perks stack.
  _eff(key, base) {
    const e = this._perkEffects;
    const c = this.config;
    switch (key) {
      case "powerMax": return this._powerMax ?? POWER.MAX;
      case "oxygenDrain": return OXYGEN.DRAIN_PER_SEC * (e.oxygenDrainMult ?? 1) * (c.oxygenDrainMult ?? 1);
      case "taskPower": return Math.round(POWER.PER_TASK * (e.taskPowerMult ?? 1) * (c.taskPowerMult ?? 1));
      case "moveSpeedMult": return (e.moveSpeedMult ?? 1) * (c.moveSpeedMult ?? 1); // informational (client movement)
      case "sabCooldown": return (this.map.globalSabotageCooldownSeconds || GLOBAL_SABOTAGE_COOLDOWN_SEC) * (e.sabCooldownMult ?? 1) * (c.sabotageCooldownMult ?? 1);
      case "cableCooldown": return this.map.cablePullCooldownSeconds * (e.cableCooldownMult ?? 1) * (c.cablePullCooldownMult ?? 1);
      case "sabFuseMult": return e.sabFuseMult ?? 1;
      case "attackInterval": return HULL.ATTACK_INTERVAL_SEC * (c.attackIntervalMult ?? 1);
      case "attackDamageMult": return c.attackDamageMult ?? 1;
      default: return base;
    }
  }

  // ---------- start: secret role assignment ----------
  // Public entry: if a draft hasn't run, start() runs the match directly (back-
  // compat for tests and quick matches). Normally startDraft()->resolveDraft().
  start({ force = false } = {}) {
    if (this.phase === PHASE.DRAFT) return this.resolveDraft();
    if (this.phase !== PHASE.LOBBY) throw new Error("Already started.");
    return this._beginMatch({ force });
  }

  _beginMatch({ force = false } = {}) {
    const ids = [...this.players.keys()];
    if (!force && ids.length < this.map.minPlayers) {
      throw new Error(`Need at least ${this.map.minPlayers} players.`);
    }
    if (ids.length < 2) throw new Error("Need at least 2 players.");
    // Impostor count: host override if set, else map default. Clamp to a sane
    // floor/ceiling (>=1, and leave at least one crew member).
    let impostorCount = this.map.impostors;
    if (Number.isInteger(this.config.impostorCount) && this.config.impostorCount > 0) {
      impostorCount = Math.min(this.config.impostorCount, ids.length - 1);
    }
    const order = shuffle(ids, this.rng);
    const impostors = new Set(order.slice(0, impostorCount));

    for (const id of ids) {
      const p = this.players.get(id);
      p.role = impostors.has(id) ? ROLE.IMPOSTOR : ROLE.CREW;
      p.tasks = this._assignTasks(ROOM_TASKS);
      if (impostors.has(id)) this.cooldowns[id] = { cable: this.now + 30 };
    }
    const crewIds = ids.filter((id) => this.players.get(id).role === ROLE.CREW);
    this.commanderId = shuffle(crewIds, this.rng)[0];

    this.phase = PHASE.ACTIVE;
    this.voteRoundStartedAt = this.now;
    this.globalSabotageCdUntil = this.now + 30;
    this._log("match_started", { playerCount: ids.length, impostorCount, commanderId: this.commanderId, perks: this.activePerks });

    // Hand off to the active mode (if any) to set up its own roles/state. The mode
    // may REPLACE the impostor/crew split (e.g. Infection's patient-zero setup).
    if (this.mode?.onMatchStart) {
      this.mode.onMatchStart(this);
      // Ensure every infected/hunter has a cable cooldown entry.
      for (const p of this.players.values()) {
        if (p.role === ROLE.IMPOSTOR && !this.cooldowns[p.id]) this.cooldowns[p.id] = { cable: this.now + 30 };
      }
    }
    return { impostorCount, perks: this.activePerks, mode: this.mode?.id || null };
  }


  _assignTasks(templateSet) {
    const energy = templateSet === ENERGY_TASKS;
    const gamePool = energy ? ENERGY_GAMES : PHYSICAL_GAMES;
    const validRooms = this.map.rooms.filter(r => 
      r !== "Space" && 
      (templateSet[r] || templateSet[r.replace(/\s+\d+$/, "")])
    );
    const chosenRooms = shuffle(validRooms, this.rng).slice(0, Math.min(2, validRooms.length));
    const tasks = [];
    for (const room of chosenRooms) {
      const baseType = room.replace(/\s+\d+$/, "");
      const template = templateSet[room] || templateSet[baseType] || ["Run a system diagnostic", "Recalibrate instruments"];
      const name = template[Math.floor(this.rng() * template.length)];
      const game = gamePool[Math.floor(this.rng() * gamePool.length)];
      tasks.push({
        id: newId("task"), room, name, done: false,
        game, minSeconds: MINIGAMES[game].minSeconds,
        startedAt: null,
      });
    }
    return tasks;
  }

  // ---------- helpers ----------
  _requireActive() { if (this.phase !== PHASE.ACTIVE) throw new Error("Not in active play."); }
  _player(id) { const p = this.players.get(id); if (!p) throw new Error("No such player."); return p; }
  _living() { return [...this.players.values()].filter((p) => p.plane === PLANE.PHYSICAL); }
  _livingImpostors() { return this._living().filter((p) => p.role === ROLE.IMPOSTOR); }
  _livingCrew() { return this._living().filter((p) => p.role === ROLE.CREW); }
  // "In play" = not fully eliminated (physical OR energy plane). Parity is judged
  // on these: a downed crew member is still in the match (energy plane) and only
  // leaves the count when ELIMINATED via an energy-plane cable-pull.
  _inPlay() { return [...this.players.values()].filter((p) => p.plane !== PLANE.ELIMINATED); }
  _inPlayImpostors() { return this._inPlay().filter((p) => p.role === ROLE.IMPOSTOR); }
  _inPlayCrew() { return this._inPlay().filter((p) => p.role === ROLE.CREW); }
  // ---- active-sabotage effect accessors (any matching active sabotage flips these) ----
  _anySab(flag) { for (const s of this.sabotages.values()) if (SABOTAGE[s.kind]?.[flag]) return true; return false; }
  _refillDisabled() { return this._anySab("disablesRefill"); }
  _tasksFrozen() { return this._anySab("freezesTasks"); }       // EMP
  _lightsOut() { return this._anySab("lightsOut"); }            // Lights Out
  _attractActive() { return this._anySab("attractsAttackers"); } // Position Leaked
  // The oxygen machine (refill stations) only works if the power pool isn't empty AND life support isn't sabotaged.
  _oxygenOnline() { return this.power > 0 && !this._refillDisabled(); }
  // Shields are considered "up" if they have any power routed to them (momentum < 5)
  _shieldsUp() { return Math.floor(this.helmMomentum.current) < 5; }

  // ---------- comms: voice commands, speech, and captions ----------
  // Who hears a given speaker? Routing rules:
  //  - A LIVING speaker is heard by living players in the same room, PLUS all
  //    downed players (the downed hear everyone).
  //  - A DOWNED speaker is heard only by other downed players (living never hear
  //    the downed).
  // Returns an array of recipient playerIds (always includes the speaker, so
  // their own client can show what they said).
  _commRecipients(speaker) {
    const out = new Set([speaker.id]);
    if (speaker.plane === PLANE.PHYSICAL) {
      for (const p of this.players.values()) {
        if (p.id === speaker.id) continue;
        if (p.plane === PLANE.PHYSICAL && p.room === speaker.room) out.add(p.id); // same-room living
        if (p.plane === PLANE.ENERGY) out.add(p.id);                              // downed hear everyone
      }
    } else {
      for (const p of this.players.values()) {
        if (p.id === speaker.id) continue;
        if (p.plane === PLANE.ENERGY) out.add(p.id);                              // downed-only channel
      }
    }
    return [...out];
  }

  // Send a canned voice command. Language-agnostic: we emit the command KEY plus
  // resolved params; the client localizes it. Also serves as the accessibility
  // caption (text shown to the same recipients).
  sendVoiceCommand(playerId, commandKey, targetId = null) {
    this._requireActive();
    const p = this._player(playerId);
    const cmd = VOICE_COMMANDS[commandKey];
    if (!cmd) throw new Error("Unknown voice command.");
    // Resolve the command's param into concrete data for localization.
    let param = null;
    if (cmd.param === "room") param = { room: p.room };
    else if (cmd.param === "player") {
      if (!targetId || !this.players.has(targetId)) throw new Error("That command needs a valid target player.");
      param = { targetId, targetName: this.players.get(targetId).name };
    }
    const recipients = this._commRecipients(p);
    this._log("comm", {
      kind: "command",
      from: playerId, fromName: p.name, fromPlane: p.plane,
      command: cmd.key, param, emoji: cmd.emoji,
      recipients,            // net layer delivers only to these sockets
      caption: true,         // every comm doubles as an accessibility caption
      private: true,         // not a public event; routed per-recipient
    });
    return { recipients };
  }

  // Free-form "speech" hook. The engine does NOT carry audio; this records that
  // a player spoke (e.g. when proximity voice is active) so a caption can be
  // shown to whoever would have heard it. `text` is optional (present when the
  // client supplies a speech-to-text transcript for accessibility).
  sendSpeech(playerId, text = null) {
    this._requireActive();
    const p = this._player(playerId);
    const recipients = this._commRecipients(p);
    this._log("comm", {
      kind: "speech",
      from: playerId, fromName: p.name, fromPlane: p.plane,
      text: text ? String(text).slice(0, 240) : null, // transcript if provided
      recipients, caption: true, private: true,
    });
    return { recipients };
  }

  // ---------- movement ----------
  // Room-based move. With geometry, this sets the destination to the room's
  // center and the player glides there over ticks (real-time). Without geometry
  // (legacy named maps / tests), it teleports as before so existing behavior and
  // all room-based logic keep working unchanged.
  move(playerId, room) {
    this._requireActive();
    const p = this._player(playerId);
    if (!this.map.rooms.includes(room)) throw new Error("No such room.");
    if (this.map.adjacency && p.room !== room) {
      const links = this.map.adjacency[p.room] || [];
      if (!links.includes(room)) throw new Error("That room isn't adjacent.");
    }
    const g = this.map.geometry?.rooms?.[room];
    if (g) {
      // glide to the room center
      p.tx = g.x + g.w / 2; p.ty = g.y + g.h / 2;
    } else {
      p.room = room; // teleport (legacy/no-geometry)
    }
    this._log("move", { id: playerId, room, plane: p.plane });
  }

  // Continuous real-time control: head toward a world point. Clamped to the
  // world bounds. The integrator in tick() moves the player and updates `room`.
  setDestination(playerId, x, y) {
    this._requireActive();
    const p = this._player(playerId);
    if (p.plane === PLANE.ELIMINATED) return;
    const g = this.map.geometry;
    if (!g) throw new Error("This map has no spatial movement.");
    p.tx = Math.max(0, Math.min(g.worldW, x));
    p.ty = Math.max(0, Math.min(g.worldH, y));
  }

  _respawn(playerId, spawnRoomId = "Helm") {
    const p = this._requireAlive(playerId);
    p.plane = PLANE.PHYSICAL;
    const g = this.map.geometry;
    const r = g.rooms[spawnRoomId];
    if (r) {
      // spawn outside the 160x160 furniture box
      const signX = this.rng.next() > 0.5 ? 1 : -1;
      const signY = this.rng.next() > 0.5 ? 1 : -1;
      p.x = r.x + r.w / 2 + signX * this.rng.range(120, 250);
      p.y = r.y + r.h / 2 + signY * this.rng.range(120, 250);
      p.tx = p.x; p.ty = p.y;
    }
  }

  setRunning(playerId, running) {
    const p = this._player(playerId);
    p.running = running;
  }

  _isValidPosition(x, y) {
    const g = this.map.geometry;
    if (!g) return true;

    const CORR_HW = 250;       // corridor half-width in world units — must match visual hw in IsoStage (was 500)

    // Helper: clamp t onto a segment and return perpendicular distance
    const nearSegment = (px, py, ax, ay, bx, by) => {
      const dx = bx - ax, dy = by - ay;
      const l2 = dx * dx + dy * dy;
      if (l2 === 0) return Math.hypot(px - ax, py - ay);
      let t = ((px - ax) * dx + (py - ay) * dy) / l2;
      t = Math.max(0, Math.min(1, t));
      return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    };

    // Helper: find the point on a room's boundary in direction (ux,uy) from center
    const wallExit = (r, ux, uy) => {
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      const hw = r.w / 2, hh = r.h / 2;
      // t to hit x-edge, y-edge — take the nearest
      const tx = Math.abs(ux) > 1e-6 ? hw / Math.abs(ux) : Infinity;
      const ty = Math.abs(uy) > 1e-6 ? hh / Math.abs(uy) : Infinity;
      const t = Math.min(tx, ty);
      return { x: cx + ux * t, y: cy + uy * t };
    };

    // 1) Inside a room?
    let insideFloor = false;
    for (const [name, r] of Object.entries(g.rooms)) {
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
        insideFloor = true;
        break;
      }
    }

    // 2) Inside a corridor gap (between the two room walls)?
    if (!insideFloor) {
      for (const [a, b] of g.corridors) {
        const ra = g.rooms[a], rb = g.rooms[b];
        if (!ra || !rb) continue;
        const ax = ra.x + ra.w / 2, ay = ra.y + ra.h / 2;
        const bx = rb.x + rb.w / 2, by = rb.y + rb.h / 2;
        const len = Math.hypot(bx - ax, by - ay);
        if (len === 0) continue;
        const ux = (bx - ax) / len, uy = (by - ay) / len;
        // Wall-exit points (where corridor mouth is)
        const startPt = wallExit(ra, ux, uy);
        const endPt   = wallExit(rb, -ux, -uy);
        // Gap length — only valid if rooms don't overlap
        const gapLen = Math.hypot(endPt.x - startPt.x, endPt.y - startPt.y);
        if (gapLen < 10) {
          // Rooms touch or overlap — allow movement through the whole center-to-center segment
          if (nearSegment(x, y, ax, ay, bx, by) <= CORR_HW) { insideFloor = true; break; }
        } else {
          if (nearSegment(x, y, startPt.x, startPt.y, endPt.x, endPt.y) <= CORR_HW) { insideFloor = true; break; }
        }
      }
    }

    return insideFloor;
  }

  // Advance every player toward their destination by dt seconds. Called by tick.
  _integrateMovement(dt) {
    if (!this.map.geometry) return;
    for (const p of this.players.values()) {
      if (p.plane === PLANE.ELIMINATED) continue;
      if (p.tx == null || p.x == null) continue;
      const speed = MOVE.SPEED_PER_SEC * (this.config.moveSpeedMult ?? 1) * dt;
      const dx = p.tx - p.x, dy = p.ty - p.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= MOVE.ARRIVE_EPS) {
        if (this._isValidPosition(p.tx, p.ty)) { p.x = p.tx; p.y = p.ty; }
      } else {
        const k = Math.min(1, speed / dist);
        const nextX = p.x + dx * k;
        const nextY = p.y + dy * k;
        if (this._isValidPosition(nextX, nextY)) {
          p.x = nextX;
          p.y = nextY;
        } else {
          // Angle-sweep sliding: find the closest valid movement vector
          let slid = false;
          const a0 = Math.atan2(dy, dx);
          for (let deg = 10; deg <= 85; deg += 10) {
            for (const sign of [1, -1]) {
              const a = a0 + sign * deg * Math.PI / 180;
              // move at slightly reduced speed when sliding to prevent jitter
              const nx = p.x + Math.cos(a) * speed * dt * 0.9;
              const ny = p.y + Math.sin(a) * speed * dt * 0.9;
              if (this._isValidPosition(nx, ny)) {
                p.x = nx;
                p.y = ny;
                slid = true;
                break;
              }
            }
            if (slid) break;
          }
          if (!slid) {
            p.tx = p.x;
            p.ty = p.y;
          }
        }
      }
      // derive room from position; keep last known room if between cells
      const r = this._roomAt(p.x, p.y);
      if (r) p.room = r;
    }
  }

  // ---------- commander: energy allocation ----------
  allocateEnergy(playerId, system, value) {
    this._requireActive();
    if (playerId !== this.commanderId) throw new Error("Only the Commander allocates energy.");
    const p = this._player(playerId);
    if (p.plane !== PLANE.PHYSICAL) throw new Error("The Commander has crossed over — command is offline.");
    if (!SYSTEMS.includes(system)) throw new Error("Unknown system.");
    const v = Math.max(0, Math.min(100, Math.floor(value)));
    const others = SYSTEMS.reduce((a, s) => a + (s === system ? 0 : this.energy[s]), 0);
    if (others + v > REACTOR_CAPACITY) throw new Error("Exceeds reactor capacity — pull power elsewhere first.");
    this.energy[system] = v;
    this._log("energy", { system, value: v });
  }

  // ---------- oxygen: refill ----------
  refillOxygen(playerId) {
    this._requireActive();
    const p = this._player(playerId);
    if (p.plane !== PLANE.PHYSICAL) throw new Error("No tank to refill on the energy plane.");
    if (!this.map.refillRooms.includes(p.room)) throw new Error("No refill station here.");
    if (this._refillDisabled()) throw new Error("Refill stations are offline — life support is down.");
    if (this.power <= 0) throw new Error("No power — the oxygen machine is dead until tasks generate more.");
    p.oxygen = OXYGEN.MAX;
    this._log("refill", { id: playerId, room: p.room });
  }

  // ---------- crew: control power routing ----------
  // Set the engine level (0 to 5), routing power from shields to engines.
  // Must be at the Helm console; sets the momentum target (actual speed eases toward it).
  setEngineLevel(playerId, level) {
    this._requireActive();
    const p = this._player(playerId);
    if (p.plane !== PLANE.PHYSICAL) throw new Error("Downed players can't run ship systems.");
    if (p.room !== 'Helm') throw new Error("You must be at the Helm to adjust engine level.");
    
    const lvl = Math.max(0, Math.min(5, Math.floor(level)));
    this.helmMomentum.target = lvl;
    this._log("engine_level_set", { level: lvl });
  }

  // ---------- spacewalk: airlock interaction ----------
  bangDoor(playerId) {
    this._requireActive();
    const p = this._player(playerId);
    if (p.room !== 'Space' && p.room !== 'Airlock') throw new Error("You're not near the airlock.");
    this.airlockBanging.add(playerId);
    this._log("airlock_bang", { id: playerId, name: p.name });
  }

  openAirlock(playerId) {
    this._requireActive();
    const p = this._player(playerId);
    if (p.room !== 'Airlock') throw new Error("You must be at the Airlock.");
    if (p.plane !== PLANE.PHYSICAL) throw new Error("Only physical players can open the airlock.");
    if (this.airlockLocked) {
      // Check if there's actually an active AIRLOCK_LOCKDOWN sabotage preventing unlock
      const hasLockdownSab = this.sabotages.has('AIRLOCK_LOCKDOWN');
      if (hasLockdownSab) throw new Error("Airlock is locked down — resolve the sabotage first.");
      this.airlockLocked = false;
    }
    this.airlockBanging.clear();
    this._log("airlock_opened", { by: playerId });
  }

  // ---------- turret: shoot incoming attack ships ----------
  shootTurretShip(playerId) {
    this._requireActive();
    const p = this._player(playerId);
    const turretRooms = this.map.turretRooms || [];
    if (!turretRooms.includes(p.room)) throw new Error("You must be in a turret room.");
    if (!this.globalAttack) throw new Error("No attack in progress.");
    if (this.now < this.globalAttack.warningUntil) throw new Error("Attack incoming — brace yourself!");
    this.globalAttack.shipsDestroyed++;
    const shipsLeft = this.globalAttack.shipsTotal - this.globalAttack.shipsDestroyed - this.globalAttack.shipsEscaped;
    if (shipsLeft <= 0) {
      this._log("attack_ended", { destroyed: this.globalAttack.shipsDestroyed, escaped: this.globalAttack.shipsEscaped, total: this.globalAttack.shipsTotal });
      this.globalAttackCdUntil = this.now + 45 + Math.floor(this.rng() * 46); // 45-90s cooldown
      this.globalAttack = null;
    }
    return { hit: true, shipsLeft: Math.max(0, shipsLeft) };
  }

  // ---------- repair: divert shield energy into the hull ----------
  // Costs a chunk of power, heals some hull. No journey progress. Only at repair
  // stations, and only meaningful while shields are the active defense.
  repairHull(playerId) {
    this._requireActive();
    const p = this._player(playerId);
    if (p.plane !== PLANE.PHYSICAL) throw new Error("Downed players can't run repairs.");
    if (!this.map.repairRooms.includes(p.room)) throw new Error("No repair station here.");
    if (this.power < POWER.PER_TASK) throw new Error("Not enough power to run a repair cycle.");
    this.power -= POWER.PER_TASK;
    this.hull = Math.min(HULL.MAX, this.hull + 15);
    this._log("repair", { id: playerId, hull: Math.round(this.hull) });
  }

  // ---------- crossing to the energy plane (replaces "death") ----------
  _down(playerId, cause) {
    const p = this._player(playerId);
    if (p.plane !== PLANE.PHYSICAL) return; // already crossed over or eliminated
    // Let an active mode take over (e.g. Infection converts instead of crossing).
    if (this.mode?.onDown && this.mode.onDown(this, p, cause)) {
      this._checkWin();
      return;
    }
    p.plane = PLANE.ENERGY;
    p.oxygen = 0;
    // Fresh energy-themed tasks that feed the SAME shared bar.
    p.tasks = this._assignTasks(ENERGY_TASKS);
    this._log("downed", { id: playerId, cause, private: true }); // who/why is privileged info
    this._checkWin();
  }

  // ---------- full elimination (energy-plane cable-pull) ----------
  // A player downed AGAIN while already on the energy plane is fully out: removed
  // from the parity tallies. This is the impostor's path to actually win by
  // attrition now that merely downing crew keeps them in play.
  _eliminate(playerId, cause) {
    const p = this._player(playerId);
    if (p.plane === PLANE.ELIMINATED) return;
    p.plane = PLANE.ELIMINATED;
    p.tasks = [];
    this._log("eliminated_for_good", { id: playerId, cause, private: true });
    this._checkWin();
  }

  // ---------- impostor: detach air cable ----------
  // Two-stage: pulling a PHYSICAL target crosses them to the energy plane; pulling
  // an ENERGY-plane target (impostor must also be on the energy plane) fully
  // eliminates them. Impostor and target must share the same plane and room.
  detachCable(impostorId, targetId) {
    this._requireActive();
    const imp = this._player(impostorId);
    const shoveMode = !!this.mode?.onShove; // KotH: anyone may shove, no role needed
    if (!shoveMode && imp.role !== ROLE.IMPOSTOR) throw new Error("Only impostors can do that.");
    if (imp.plane === PLANE.ELIMINATED) throw new Error("You're out of the match.");
    const target = this._player(targetId);
    if (target.id === impostorId) throw new Error("Can't detach your own cable.");
    if (!shoveMode && target.role === ROLE.IMPOSTOR) throw new Error("Can't target a fellow impostor.");
    if (target.plane === PLANE.ELIMINATED) throw new Error("Target is already gone.");
    if (target.plane !== imp.plane) throw new Error("Target is on a different plane.");
    if (target.room !== imp.room) throw new Error("Target not in your room.");
    const dist = Math.hypot(target.x - imp.x, target.y - imp.y);
    if (dist > 250) throw new Error("Target is too far away to pull their cable.");
    const cd = this.cooldowns[impostorId] || (this.cooldowns[impostorId] = { cable: 0 });
    if (this.now < cd.cable) throw new Error("Cable-pull on cooldown.");
    cd.cable = this.now + 15;

    // A mode may reinterpret the cable-pull (KotH shove; Who Did It arms a guess).
    if (this.mode?.onShove && this.mode.onShove(this, target, impostorId)) return;

    // Stage by the plane both are on: physical => cross over; energy => eliminate.
    if (target.plane === PLANE.PHYSICAL) this._down(targetId, "cable_pull");
    else this._eliminate(targetId, "energy_cable_pull");

    // Anyone in the same room witnesses the murder.
    for (const q of this.players.values()) {
      if (q.role === ROLE.CREW && q.plane === imp.plane && q.room === imp.room && q.id !== targetId) {
        q.witnessedMurderer = impostorId;
      }
    }

    // Bounty hook: if the victim is flagged BOUNTY_TARGET for an active event and
    // both players have accounts, emit a claim the net layer reports to the
    // backend (which grants the reward once). Engine just signals; backend pays.
    const bounty = (target.eventFlags || []).find((f) => f.flag === "BOUNTY_TARGET");
    if (bounty && imp.accountId && target.accountId) {
      this.bountyClaims = this.bountyClaims || [];
      const claim = { eventId: bounty.eventId, targetId: target.accountId, byUserId: imp.accountId };
      this.bountyClaims.push(claim);
      this._log("bounty_claim", { ...claim, private: true }); // reported, not shown to all
    }
  }

  // Drain & return any pending bounty claims (net layer reports these to backend).
  drainBountyClaims() { const c = this.bountyClaims || []; this.bountyClaims = []; return c; }

  // Hot Potato: pass the potato to a player in the same room (delegates to mode).
  passPotato(fromId, toId) {
    this._requireActive();
    if (!this.mode?.onPass) throw new Error("No potato in play.");
    return this.mode.onPass(this, fromId, toId);
  }

  // Who Did It?: the detective names a suspect (delegates to mode).
  guessWhoDidIt(detectiveId, suspectId) {
    this._requireActive();
    if (!this.mode?.onGuess) throw new Error("Nothing to guess.");
    return this.mode.onGuess(this, detectiveId, suspectId);
  }

  // Does this player hold the EVENT_HOST flag for an active event? (Grants
  // extended host powers — unrestricted config, force-start, mode choice.)
  isEventHost(playerId) {
    const p = this.players.get(playerId);
    return !!(p && (p.eventFlags || []).some((f) => f.flag === "EVENT_HOST"));
  }

  // ---------- impostor: sabotage ----------
  triggerSabotage(impostorId, kind) {
    this._requireActive();
    const imp = this._player(impostorId);
    if (imp.role !== ROLE.IMPOSTOR || imp.plane !== PLANE.PHYSICAL) throw new Error("Only living impostors sabotage.");
    const def = SABOTAGE[kind];
    if (!def) throw new Error("Unknown sabotage.");
    if (this.sabotages.has(kind)) throw new Error("That sabotage is already active.");
    // Shared GLOBAL cooldown across all sabotage types (cable-pull is separate).
    if (this.now < this.globalSabotageCdUntil) throw new Error("Sabotage systems recharging.");

    // LINGERING_DARK perk stretches the timed nuisance sabotages' fuses.
    const fuseMult = (def.lightsOut || def.attractsAttackers) ? this._eff("sabFuseMult") : 1;
    // Reconcile the sabotage's resolve points with the ACTUAL map. Procedural
    // maps include only a subset of the room library, so a definition's
    // resolveRooms may not all exist. Keep only rooms on this map; if none match,
    // fall back to the spawn/hub so it's always fixable. Cap resolversNeeded to
    // the number of available points so a sabotage can never be unresolvable.
    const present = (def.resolveRooms || []).filter((r) => this.map.rooms.includes(r));
    const resolveRooms = present.length ? present : [this.map.spawnRoom];
    const resolversNeeded = Math.min(def.resolversNeeded, resolveRooms.length);
    this.sabotages.set(kind, {
      kind, label: def.label,
      resolveRooms, resolversNeeded,
      resolvedBy: new Set(),
      expiresAt: def.fuseSeconds == null ? null : this.now + def.fuseSeconds * fuseMult,
    });
    this.globalSabotageCdUntil = this.now + this._eff("sabCooldown");
    this._log("sabotage_started", { kind, label: def.label,
      expiresAt: this.sabotages.get(kind).expiresAt,
      disablesRefill: !!def.disablesRefill, lightsOut: !!def.lightsOut,
      freezesTasks: !!def.freezesTasks, attractsAttackers: !!def.attractsAttackers });
  }

  resolveSabotage(playerId, kind) {
    this._requireActive();
    const p = this._player(playerId);
    if (p.plane !== PLANE.PHYSICAL) throw new Error("Only physical crew can resolve sabotage.");
    // If kind omitted, resolve whichever active sabotage this room is a point for.
    let sab = kind ? this.sabotages.get(kind) : null;
    if (!sab) {
      for (const s of this.sabotages.values()) if (s.resolveRooms.includes(p.room)) { sab = s; break; }
    }
    if (!sab) throw new Error("Nothing here to resolve.");
    if (!sab.resolveRooms.includes(p.room)) throw new Error("You're not at a resolution point for that.");
    sab.resolvedBy.add(playerId);
    this._log("sabotage_progress", { kind: sab.kind, resolved: sab.resolvedBy.size, needed: sab.resolversNeeded });
    if (sab.resolvedBy.size >= sab.resolversNeeded) {
      this.sabotages.delete(sab.kind);
      this._log("sabotage_resolved", { kind: sab.kind });
    }
  }

  // ---------- crew: tasks generate POWER (now timed mini-games) ----------
  // Phase 1: begin a task. Records the server start time; the client then plays
  // the mini-game. Validates room + that the task isn't already done/running.
  startTask(playerId, taskId) {
    this._requireActive();
    const p = this._player(playerId);
    const task = p.tasks.find((t) => t.id === taskId);
    if (!task) throw new Error("That task isn't yours.");
    if (task.done) throw new Error("Already done.");
    if (p.room !== task.room) throw new Error("You must be in the task's room.");
    if (this._tasksFrozen()) throw new Error("Systems are EMP-locked — repair the outage first.");
    task.startedAt = this.now;
    this._log("task_started", { id: playerId, taskId, game: task.game, minSeconds: task.minSeconds, private: true, recipients: [playerId] });
    return { taskId, game: task.game, minSeconds: task.minSeconds, startedAt: task.startedAt };
  }

  // Phase 2: complete a task. The SERVER checks that enough time elapsed since
  // startTask (anti-cheat: a client can't shortcut the mini-game) and that the
  // player is still in the room. Only then does it count + generate power.
  completeTask(playerId, taskId) {
    this._requireActive();
    const p = this._player(playerId);
    const task = p.tasks.find((t) => t.id === taskId);
    if (!task) throw new Error("That task isn't yours.");
    if (task.done) throw new Error("Already done.");
    if (p.room !== task.room) throw new Error("You must be in the task's room.");
    if (this._tasksFrozen()) throw new Error("Systems are EMP-locked — repair the outage first.");
    // Must have been started, and enough server-time must have passed.
    if (task.startedAt == null) throw new Error("Start the task first.");
    const elapsed = this.now - task.startedAt;
    if (elapsed > TASK.ABANDON_SEC) { task.startedAt = null; throw new Error("Task timed out — start it again."); }
    if (elapsed < task.minSeconds - TASK.EARLY_GRACE_SEC) {
      throw new Error("Too fast — finish the mini-game."); // the anti-cheat gate
    }
    p.tasks = p.tasks.filter((t) => t.id !== taskId);
    p.lastCompletedRoom = task.room;
    this._log("task_attempt", { id: playerId, plane: p.plane });

    // PHYSICAL plane: impostor "tasks" are fake — they generate NO power.
    // ENERGY plane: every downed player's tasks count (design choice).
    const counts = p.plane === PLANE.ENERGY || p.role === ROLE.CREW;
    if (counts) {
      const gain = this._eff("taskPower");
      this.power = Math.min(this._eff("powerMax"), this.power + gain);
      this._log("power_generated", { amount: gain, pool: Math.round(this.power) });
    }

    // Refill tasks immediately so the player always has exactly 2 active tasks in 2 different rooms
    if (p.plane === PLANE.PHYSICAL || p.plane === PLANE.ENERGY) {
      const templateSet = p.plane === PLANE.ENERGY ? ENERGY_TASKS : ROOM_TASKS;
      const gamePool = p.plane === PLANE.ENERGY ? ENERGY_GAMES : PHYSICAL_GAMES;
      const otherActiveRoom = p.tasks[0]?.room;

      const validRooms = this.map.rooms.filter(r => 
        r !== "Space" && 
        (templateSet[r] || templateSet[r.replace(/\s+\d+$/, "")]) &&
        r !== p.lastCompletedRoom &&
        r !== otherActiveRoom
      );

      const nextRoom = validRooms.length > 0 
        ? validRooms[Math.floor(this.rng() * validRooms.length)] 
        : p.lastCompletedRoom; // fallback

      const baseType = nextRoom.replace(/\s+\d+$/, "");
      const templates = templateSet[nextRoom] || templateSet[baseType] || ["Run a system diagnostic", "Recalibrate instruments"];
      const name = templates[Math.floor(this.rng() * templates.length)];
      const game = gamePool[Math.floor(this.rng() * gamePool.length)];

      p.tasks.push({
        id: newId("task"), room: nextRoom, name, done: false,
        game, minSeconds: MINIGAMES[game].minSeconds,
        startedAt: null,
      });
    }

    return { counted: counts, power: Math.round(this.power) };
  }

  // Live task completion snapshot (informational; not a win bar anymore).
  taskProgress() {
    let done = 0, total = 0;
    for (const p of this.players.values()) {
      const counts = p.plane === PLANE.ENERGY || p.role === ROLE.CREW;
      if (!counts) continue;
      for (const t of p.tasks) { total++; if (t.done) done++; }
    }
    return { done, total };
  }

  // ---------- continuous voting ----------
  // Cast or change your vote. Living players only. Majority-of-living is the bar.
  castVote(voterId, targetId /* or null to clear */) {
    this._requireActive();
    const voter = this._player(voterId);
    if (voter.plane !== PLANE.PHYSICAL) throw new Error("Downed players can't vote.");
    if (targetId != null) {
      const t = this._player(targetId);
      if (t.plane !== PLANE.PHYSICAL) throw new Error("That player has already crossed over.");
    }
    if (targetId == null) this.votes.delete(voterId);
    else this.votes.set(voterId, targetId);
    this._log("vote_cast", { by: voterId }); // target stays private until elimination
    this._evaluateInstantMajority();
  }

  _tally() {
    const counts = {};
    for (const [, target] of this.votes) counts[target] = (counts[target] || 0) + 1;
    let leader = null, leadVotes = 0, tie = false;
    for (const [id, n] of Object.entries(counts)) {
      if (n > leadVotes) { leader = id; leadVotes = n; tie = false; }
      else if (n === leadVotes) tie = true;
    }
    return { counts, leader, leadVotes, tie };
  }
  _majorityNeeded() { return Math.floor(this._living().length / 2) + 1; }

  // Instant elimination the moment someone crosses majority-of-living.
  _evaluateInstantMajority() {
    const { leader, leadVotes } = this._tally();
    if (leader && leadVotes >= this._majorityNeeded()) this._eliminateByVote(leader);
  }

  _eliminateByVote(targetId) {
    const p = this.players.get(targetId);
    if (!p || p.plane === PLANE.ELIMINATED) return;
    this._log("player_eliminated", { id: targetId }); // public + the robotic "Player eliminated" line
    // A vote is the crew collectively ejecting someone — a FULL elimination
    // (out for good), unlike a cable-pull which only crosses you to the energy
    // plane on the first hit. This keeps the crew's win path: eject the impostor.
    this._eliminate(targetId, "vote");
    this._resetVoteRound();
  }
  _resetVoteRound() { this.votes.clear(); this.voteRoundStartedAt = this.now; }

  // ---------- time + win conditions ----------
  // Network layer calls tick() ~once a second.
  tick(dt = 1) {
    this.now += dt;
    // Draft phase: auto-resolve when the timer elapses (or earlier if all voted).
    if (this.phase === PHASE.DRAFT) {
      if (this.now - this.draft.startedAt >= DRAFT.SECONDS) this.resolveDraft();
      return;
    }
    if (this.phase !== PHASE.ACTIVE) return;

    // Continuous movement runs regardless of mode (everyone can move in real time).
    this._integrateMovement(dt);

    // Active game mode drives its own clock (potato fuse, music rounds, hill
    // scoring). Run it first; it may end the match.
    if (this.mode?.tick) { this.mode.tick(this, dt); if (this.phase === PHASE.ENDED) return; }
    if (this.mode?.checkWin) { if (this._checkWin()) return; }

    // Bespoke modes (KotH, Hot Potato, Musical Chairs) run their own rules and
    // skip the ship simulation (power, combat, journey, sabotage, voting). They
    // still get oxygen drain so air pressure matters. Infection opts back in.
    const baseSim = !this.mode || this.mode.usesBaseSimulation === true;

    // 0) Power economy: active systems drain the pool.
    let powered = true;
    if (baseSim) {
    // ---- Helm momentum: gradual speed changes ----
    if (this.helmMomentum.target > this.helmMomentum.current) {
      // Speeding up: takes 15 seconds to go 0->5
      this.helmMomentum.current = Math.min(this.helmMomentum.target, this.helmMomentum.current + dt * (5 / 15));
    } else if (this.helmMomentum.target < this.helmMomentum.current) {
      // Slowing down: takes 5 seconds to go 5->0
      this.helmMomentum.current = Math.max(this.helmMomentum.target, this.helmMomentum.current - dt * (5 / 5));
    }

    let draw = 0;
    const enginePct = this.helmMomentum.current / 5;
    const shieldPct = 1 - enginePct;
    
    // Constant oxygen draw, plus scaled engine and shield draws.
    draw += POWER.OXYGEN_DRAW_PER_SEC * dt;
    draw += enginePct * POWER.ENGINE_DRAW_PER_SEC * dt;
    draw += shieldPct * POWER.SHIELD_DRAW_PER_SEC * dt;
    powered = this.power >= draw;
    this.power = Math.max(0, this.power - draw);

    // Journey advances scaled by engine power.
    if (enginePct > 0 && powered) {
      const target = JOURNEY.DISTANCE * (this.config.journeyDistanceMult ?? 1);
      const speed = JOURNEY.ENGINE_SPEED_PER_SEC * enginePct;
      this.distance = Math.min(target, this.distance + speed * dt);
      if (this.distance >= target) {
        this.distanceReached = true;
        // A mode may reinterpret "reached the location" (Infection => survivors escape).
        if (this.mode) { if (this._checkWin()) return; }
        else { this._end(WINNER.CREW, "reached_location"); return; }
      }
    }

    // Combat: global attack waves replace ambient damage.
    // Random attacks trigger every 45-90 seconds (cooldown-based).
    if (!this.globalAttack && this.now >= this.globalAttackCdUntil) {
      // Start a new attack wave
      this.globalAttack = {
        startedAt: this.now,
        shipsTotal: 20,
        shipsDestroyed: 0,
        shipsEscaped: 0,
        warningUntil: this.now + 20,
        difficulty: Math.max(1, this.helmMomentum.current),
        _lastShipAt: this.now + 20, // track when the last ship spawned (starts after warning)
      };
      this._log("attack_incoming", { label: "INCOMING ATTACK" });
    }

    // Process active global attack
    if (this.globalAttack) {
      const atk = this.globalAttack;
      const pastWarning = this.now >= atk.warningUntil;
      if (pastWarning) {
        // Ships appear at a rate based on difficulty (higher engine = faster ships)
        const shipInterval = Math.max(1, 4 - atk.difficulty * 0.5); // 1-3.5s between ships
        const dealt = atk.shipsDestroyed + atk.shipsEscaped;
        if (dealt < atk.shipsTotal && this.now - atk._lastShipAt >= shipInterval) {
          atk._lastShipAt = this.now;
          // A ship that isn't destroyed within its window deals 5 hull damage (lowered from 8)
          atk.shipsEscaped++;
          const attract = this._attractActive();
          let dmg = 5;
          // Scale damage based on speed: faster speed = heavier hits!
          const speedFactor = 1 + this.helmMomentum.current;
          dmg *= speedFactor;
          dmg *= this._eff("attackDamageMult");
          if (attract) dmg *= ATTRACT.dmgFactor;
          this.hull = Math.max(0, this.hull - dmg);
          this._log("attack", { dmg, shielded: shieldPct > 0.5, hull: Math.round(this.hull) });

          if (this.hull <= 0 && !this.mode) { this._end(WINNER.IMPOSTORS, "hull_destroyed"); return; }
        }
        // Check if the attack is over
        if (atk.shipsDestroyed + atk.shipsEscaped >= atk.shipsTotal) {
          this._log("attack_ended", { destroyed: atk.shipsDestroyed, escaped: atk.shipsEscaped, total: atk.shipsTotal });
          this.globalAttackCdUntil = this.now + 45 + Math.floor(this.rng() * 46); // 45-90s cooldown
          this.globalAttack = null;
        }
      }
    }
    } // end baseSim (power / journey / combat)

    // 1) Oxygen drain for everyone still physical; empty tank => downed.
    //    (Refills require the oxygen machine to be powered — see refillOxygen.)
    //    The infiniteOxygen crazy toggle skips drain entirely.
    //    Players in Space drain 3x (O2 used for propulsion); 90s => frozen death.
    if (!this.config.infiniteOxygen) {
      for (const p of this._living()) {
        let drainMult = 1;
        if (p.room === 'Space') {
          drainMult = 3; // spacewalkers use O2 for propulsion
          // Track time in space for freeze death
          if (!p.spaceEnteredAt) p.spaceEnteredAt = this.now;
          if (this.now - p.spaceEnteredAt > 90) {
            this._eliminate(p.id, 'frozen'); // permanent death
            if (this.phase === PHASE.ENDED) return;
            continue;
          }
        } else {
          p.spaceEnteredAt = null; // clear when not in space
        }
        // drain only if oxygen machine is dead or life-support sabotaged
        if (this.power <= 0 || this._refillDisabled()) {
          drainMult *= 3.0;
        }
        p.oxygen = Math.max(0, p.oxygen - this._eff("oxygenDrain") * drainMult * dt);
        if (p.oxygen <= 0) this._down(p.id, "out_of_air");
        if (this.phase === PHASE.ENDED) return;
      }
    }
    // Energy-plane players in Space can pass through Airlock freely (ghosts walk through doors)
    for (const p of this.players.values()) {
      if (p.plane === PLANE.ENERGY && p.room === 'Space') {
        // No airlock restriction for ghosts — they phase through
      }
    }

    // 2) Expire fused sabotages. A reactor meltdown (losesIfExpires) ends the
    //    match for impostors; timed nuisances (lights, attract) just clear.
    if (baseSim) {
    for (const s of [...this.sabotages.values()]) {
      if (s.expiresAt != null && this.now >= s.expiresAt) {
        const def = SABOTAGE[s.kind];
        if (def?.losesIfExpires) {
          this._log("sabotage_expired", { kind: s.kind });
          this._end(WINNER.IMPOSTORS, "sabotage_unresolved");
          return;
        }
        this.sabotages.delete(s.kind);
        this._log("sabotage_expired", { kind: s.kind });
        // Airlock lockdown: unlock when the sabotage expires
        if (s.kind === 'AIRLOCK_LOCKDOWN') this.airlockLocked = false;
      }
    }
    // Airlock lockdown sabotage: lock the airlock while active
    if (this.sabotages.has('AIRLOCK_LOCKDOWN')) {
      this.airlockLocked = true;
    } else if (!this.sabotages.has('AIRLOCK_LOCKDOWN') && this.airlockLocked) {
      // If the sabotage was resolved (not expired), also unlock
      this.airlockLocked = false;
    }

    // 3) Vote clock: resolve at 2:00 (or by 3:00 grace).
    const elapsed = this.now - this.voteRoundStartedAt;
    if (elapsed >= VOTE.ROUND_SECONDS) {
      const { leader, leadVotes, tie } = this._tally();
      const votedCount = this.votes.size;
      const half = this._living().length / 2;
      const need = this._majorityNeeded();
      if (elapsed >= VOTE.ROUND_SECONDS + VOTE.GRACE_SECONDS) {
        // End of grace: eliminate current leader if a clear, non-tied leader exists.
        if (leader && !tie && leadVotes > 0) this._eliminateByVote(leader);
        else { this._log("vote_inconclusive", {}); this._resetVoteRound(); }
      } else {
        // At the 2:00 mark: eliminate only if >half voted AND someone has majority.
        if (votedCount > half && leader && leadVotes >= need) this._eliminateByVote(leader);
        // otherwise let the grace minute run (instant-majority still armed via castVote)
      }
    }
    } // end baseSim (sabotage expiry + vote clock)
  }

  _checkWin() {
    if (this.phase === PHASE.ENDED) return true;
    // An active mode REPLACES the base win conditions.
    if (this.mode?.checkWin) {
      const result = this.mode.checkWin(this);
      if (result) { this._end(result.winner, result.reason); return true; }
      return false;
    }
    // Crew win: every impostor fully ELIMINATED (not merely downed to energy).
    if (this._inPlayImpostors().length === 0) { this._end(WINNER.CREW, "all_impostors_down"); return true; }
    // Impostors win: parity with crew still IN PLAY (physical + energy). Downed
    // crew keep counting until fully eliminated on the energy plane, so a solo
    // impostor must actually finish people off, not just shove them over once.
    if (this._inPlayImpostors().length >= this._inPlayCrew().length) { this._end(WINNER.IMPOSTORS, "impostors_parity"); return true; }
    // NOTE: reaching the location (crew) and hull destroyed (impostors) are
    // time-driven and handled in tick(); completing tasks no longer wins — it
    // generates the power that fuels the journey, oxygen, and shields.
    return false;
  }
  _end(winner, reason) {
    if (this.phase === PHASE.ENDED) return;
    this.phase = PHASE.ENDED;
    this.winner = winner;
    this.winReason = reason;
    this._log("match_ended", { winner, reason });
  }

  // Build the result report the network layer sends to the backend at match end.
  // Maps each ACCOUNT player to whether their side won (guests have no accountId
  // and are skipped by the backend). Roles are included for stat-tracking.
  matchResult() {
    const winningSide = this.winner; // "crew" | "impostors"
    const participants = [];
    for (const p of this.players.values()) {
      if (!p.accountId) continue; // guests earn no XP
      const isImpostor = p.role === ROLE.IMPOSTOR;
      const won = (winningSide === WINNER.IMPOSTORS && isImpostor) ||
                  (winningSide === WINNER.CREW && !isImpostor);
      participants.push({ userId: p.accountId, role: p.role, won });
    }
    return { winner: this.winner, participants };
  }

  // ============================================================
  // REDACTED PER-PLAYER VIEW — the only thing a client receives.
  // ============================================================
  viewFor(playerId) {
    const me = this.players.get(playerId);
    if (!me) throw new Error("No such player.");
    const iAmImpostor = me.role === ROLE.IMPOSTOR;
    const iAmDowned = me.plane === PLANE.ENERGY;
    const ended = this.phase === PHASE.ENDED;
    const privileged = iAmImpostor || iAmDowned || ended;

    // Lights Out: non-privileged crew can't see other rooms — only players in
    // their own room are visible; others are obscured. Impostors (nightvision)
    // and ghosts/post-game see normally.
    const lightsOut = this._lightsOut();
    const dimmed = lightsOut && !iAmImpostor && !iAmDowned && !ended;

    const players = [...this.players.values()].map((p) => {
      const sameRoom = p.room === me.room;
      const base = { id: p.id, name: p.name, plane: p.plane, connected: p.connected, isBot: !!p.isBot,
        loadout: p.loadout, idColor: p.idColor };
      // Position: hidden for off-room players while dimmed (self always visible).
      const hidespatial = dimmed && !sameRoom && p.id !== me.id;
      base.room = hidespatial ? null : p.room;
      base.obscured = hidespatial;
      // Continuous world position for the real-time renderer (null when obscured).
      base.x = hidespatial ? null : (p.x ?? null);
      base.y = hidespatial ? null : (p.y ?? null);
      if (ended || iAmDowned) base.role = p.role;                          // ghosts & post-game see all
      else if (iAmImpostor && p.role === ROLE.IMPOSTOR) base.role = ROLE.IMPOSTOR; // impostors see each other
      else base.role = "unknown";
      return base;
    });

    // Comms scope: physical players hear only same-room players; downed players
    // share one map-wide energy channel. We expose the channel membership so the
    // client knows who it may message; message relay itself is the net layer's job.
    let commChannel;
    if (iAmDowned) {
      commChannel = { scope: "energy_mapwide",
        members: [...this.players.values()].filter((p) => p.plane === PLANE.ENERGY).map((p) => p.id) };
    } else {
      commChannel = { scope: "proximity",
        members: [...this.players.values()].filter((p) => p.plane === PLANE.PHYSICAL && p.room === me.room).map((p) => p.id) };
    }

    const voteElapsed = this.phase === PHASE.ACTIVE ? this.now - this.voteRoundStartedAt : 0;
    return {
      phase: this.phase,
      now: this.now,
      map: { id: this.map.id, name: this.map.name, rooms: this.map.rooms,
        refillRooms: this.map.refillRooms, turretRooms: this.map.turretRooms,
        repairRooms: this.map.repairRooms, helmRoom: 'Helm',
        // Non-secret layout metadata the client HUD/minimap needs:
        adjacency: this.map.adjacency || null, spawnRoom: this.map.spawnRoom,
        geometry: this.map.geometry || null,
        minPlayers: this.map.minPlayers, maxPlayers: this.map.maxPlayers, hullMax: HULL.MAX },
      config: this.config, // host overrides the client needs (move speed, body/head size, low-g, visibility)
      mode: this.mode ? {
        id: this.mode.id, label: this.mode.label,
        // public, non-leaking mode state for the HUD:
        kothRoom: this.kothRoom ?? null,
        potatoHolder: this.potatoHolder ?? null,
        potatoExplodesAt: this.potatoExplodesAt ?? null,
        mcPhase: this.mcPhase ?? null,
        mcSafeRoom: this.mcSafeRoom ?? null,
        // Who Did It? — detective, phase, and solved count are public; the
        // culprit is deliberately NOT exposed (that's the whole guessing game).
        wdiDetective: this.wdiDetective ?? null,
        wdiPhase: this.wdiPhase ?? null,
        wdiSolved: this.wdiSolved ?? null,
      } : null,
      energy: this.energy,
      // ---- v0.3 ship status ----
      power: Math.round(this.power),
      powerMax: this._eff("powerMax"),
      hull: Math.round(this.hull),
      hullMax: HULL.MAX,
      journey: { distance: Math.round(this.distance), total: JOURNEY.DISTANCE },
      systems: {
        oxygenOn: this.systems.oxygenOn,
        enginesOn: this.systems.enginesOn,
        shieldsUp: this._shieldsUp(),       // true defensive state (engines force this false)
        oxygenOnline: this._oxygenOnline(), // refills actually working right now
        engineLevel: this.helmMomentum.target,  // Target speed (0-5)
        engineSpeed: this.helmMomentum.current, // Actual speed (0.0 - 5.0)
      },
      commanderId: this.commanderId,
      youAreCommander: playerId === this.commanderId,
      players,
      taskProgress: this.taskProgress(),
      you: {
        id: me.id, role: me.role, plane: me.plane, room: me.room,
        x: me.x ?? null, y: me.y ?? null, tx: me.tx ?? null, ty: me.ty ?? null,
        oxygen: Math.round(me.oxygen),
        lowOxygen: me.oxygen <= OXYGEN.PANIC_THRESHOLD,
        tasks: me.tasks,
        myVote: this.votes.get(me.id) || null,
        // Impostor-only: seconds until they can trigger another sabotage or pull a cable.
        sabotageCooldown: iAmImpostor ? Math.max(0, Math.round(this.globalSabotageCdUntil - this.now)) : undefined,
        cableCooldown: iAmImpostor ? Math.max(0, Math.round((this.cooldowns[me.id]?.cable || 0) - this.now)) : undefined,
      },
      refillOnline: !this._refillDisabled(),
      lightsOut: this._lightsOut(),
      tasksFrozen: this._tasksFrozen(),
      positionLeaked: this._attractActive(),
      commChannel,
      voiceCommands: Object.values(VOICE_COMMANDS).map((c) => ({ key: c.key, param: c.param, emoji: c.emoji, category: c.category })),
      vote: this.phase === PHASE.ACTIVE ? {
        secondsIntoRound: Math.floor(voteElapsed),
        roundSeconds: VOTE.ROUND_SECONDS,
        graceSeconds: VOTE.GRACE_SECONDS,
        majorityNeeded: this._majorityNeeded(),
        // live tallies hidden to prevent bandwagoning; only count of votes cast
        votesCast: this.votes.size,
        livingCount: this._living().length,
      } : null,
      airlockLocked: this.airlockLocked,
      airlockBanging: [...this.airlockBanging].map(id => ({ id, name: this.players.get(id)?.name })),
      globalAttack: this.globalAttack ? {
        active: true,
        shipsLeft: this.globalAttack.shipsTotal - this.globalAttack.shipsDestroyed - this.globalAttack.shipsEscaped,
        warning: this.now < this.globalAttack.warningUntil,
        warningSeconds: Math.max(0, Math.round(this.globalAttack.warningUntil - this.now)),
        difficulty: this.globalAttack.difficulty,
      } : null,
      helmMomentum: { target: this.helmMomentum.target, current: Math.round(this.helmMomentum.current * 10) / 10 },
      sabotages: [...this.sabotages.values()].map((s) => ({
        kind: s.kind, label: s.label,
        resolveRooms: s.resolveRooms,
        resolved: s.resolvedBy.size, needed: s.resolversNeeded,
        expiresAt: s.expiresAt,
      })),
      winner: this.winner,
      winReason: this.phase === PHASE.ENDED ? (this.winReason || null) : null,
      // ---- v0.4 perk draft + active perks ----
      draft: this.phase === PHASE.DRAFT ? {
        picks: DRAFT.PICKS,
        secondsLeft: Math.max(0, Math.ceil(DRAFT.SECONDS - (this.now - this.draft.startedAt))),
        votesIn: this.draft.votes.size,
        playerCount: this.players.size,
        // Mixed crew+impostor list — intentionally does NOT leak roles.
        candidates: this.draft.candidates.map((k) => ({
          key: k, label: PERKS[k].label, desc: PERKS[k].desc, side: PERKS[k].side })),
        yourVote: this.draft.votes.has(playerId) ? [...this.draft.votes.get(playerId)] : [],
      } : null,
      // Won perks are public (the whole team benefits) but never tied to a player.
      activePerks: this.activePerks.map((k) => ({
        key: k, label: PERKS[k].label, desc: PERKS[k].desc, side: PERKS[k].side })),
    };
  }

  eventsFor(playerId) {
    const me = this.players.get(playerId);
    const privileged = me && (me.role === ROLE.IMPOSTOR || me.plane === PLANE.ENERGY || this.phase === PHASE.ENDED);
    return this.events.filter((e) => {
      // Comm events route by an explicit recipient list, not by privilege —
      // this is what enforces "living never hear the downed" over the wire.
      if (e.recipients) return e.recipients.includes(playerId);
      return !e.private || privileged;
    });
  }
}
