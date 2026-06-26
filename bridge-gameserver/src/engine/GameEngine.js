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
  POWER, JOURNEY, MOVE, HULL, HELM, ATTACK_WARNING_SECONDS, ATTRACT, ATTACK, AIRLOCK, GLOBAL_SABOTAGE_COOLDOWN_SEC,
  DRAFT, PERKS, VOICE_COMMANDS, EMOTES, ID_COLORS, MATCH_CONFIG_DEFAULTS,
} from "./constants.js";
import { getMode } from "./modes/index.js";

let seq = 1;
const newId = (p) => `${p}_${seq++}`;

import { makeRng, shuffle } from "./rng.js";
import { generateMap, buildGeometry } from "./mapgen.js";
import { generateShip } from "./shipgen.js";
import { blockersForRoom, resolveMove, nearestFree, PLAYER_RADIUS } from "./collision.js";

export class GameEngine {
  constructor({ mapId = "nebula_drift", seed = null, config = {}, map = null } = {}) {
    // Resolve host config over defaults. mapId in config wins if provided.
    this.config = { ...MATCH_CONFIG_DEFAULTS, ...config };
    const resolvedMapId = config.mapId || mapId;
    // Map resolution order: an explicit map object > a "procedural:N" request >
    // a named map in the MAPS table (named maps are themselves frozen generated
    // layouts). "procedural" with no size generates from the config's player hint.
    let resolved = map;
    if (!resolved && typeof resolvedMapId === "string" && resolvedMapId.startsWith("procedural")) {
      const players = Number(resolvedMapId.split(":")[1]) || config.players || 8;
      resolved = generateShip({ players, seed });
    }
    if (!resolved) resolved = MAPS[resolvedMapId];
    if (!resolved) throw new Error(`Unknown map: ${resolvedMapId}`);
    // Named/fixed maps (the MAPS table) were authored before spatial geometry
    // existed, so they have rooms but no x/y layout — which left the client with
    // "NO SPATIAL MAP" and no way to walk around. If a resolved map is missing
    // geometry, generate it now from its room list. Named maps don't declare an
    // adjacency graph (they're treated as fully reachable), so we synthesize a
    // connected layout: a central spawn linked to a ring of the other rooms.
    if (!resolved.geometry) {
      const rooms = resolved.rooms || [];
      const spawn = resolved.spawnRoom || rooms[0];
      const adjacency = resolved.adjacency || (() => {
        const adj = {}; rooms.forEach((r) => (adj[r] = []));
        const others = rooms.filter((r) => r !== spawn);
        // hub-and-spoke: spawn connects to all; ring connects neighbors so the
        // layout spreads out instead of stacking on one point.
        others.forEach((r) => { adj[spawn].push(r); adj[r].push(spawn); });
        for (let i = 0; i < others.length; i++) {
          const a = others[i], b = others[(i + 1) % others.length];
          if (a !== b && !adj[a].includes(b)) { adj[a].push(b); adj[b].push(a); }
        }
        return adj;
      })();
      resolved = { ...resolved, adjacency, geometry: buildGeometry(rooms, adjacency, spawn) };
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
    // ---- turret-defense attack waves ----
    this.attack = null;           // { planesLeft, startedAt, lastDamageAt, source } when active
    this.attackWarnUntil = null;  // if set, an attack is incoming at this time (10s warning)
    this.pendingAttackSource = null;
    this.nextRandomAttackAt = null; // scheduled time of the next random attack
    this.turretOccupants = {};    // turretRoom -> playerId (one per turret)
    this.callAttackCdUntil = 0;   // separate cooldown gate for CALL_ATTACK sabotage
    this.planesByPlayer = {};     // playerId -> planes they've personally downed
    // ---- airlock / outside ----
    this.airlockLocked = false;   // impostor can lock the door from inside
    this.airlockDistress = new Set(); // outside players banging for help (crew see it)
    // Crew toggle their own system's draw at stations. Engines ON forces shields OFF.
    this.systems = { oxygenOn: true };
    // Helm power allocation: 0 = all shields (slow, safe), 1 = all engines (fast,
    // exposed). `allocation` ramps toward `targetAllocation` gradually.
    this.allocation = HELM.START_ALLOCATION;
    this.targetAllocation = HELM.START_ALLOCATION;
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
    let cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    // nudge out of any furniture blocker at the room center
    const rects = blockersForRoom(room, r);
    const free = nearestFree(cx, cy, rects);
    return { x: free.x, y: free.y, tx: free.x, ty: free.y };
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
    // Public announcement so the crew sees who dropped (name + whether mid-match).
    this._log("player_left", { id, name: p.name, midMatch: this.phase === PHASE.ACTIVE });
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
      // Helm ramp speed: <1 = faster speed/slow changes, >1 = slower. Perks
      // (e.g. AGILE_THRUSTERS) and host config can tune it; product of both.
      case "helmRampMult": return (e.helmRampMult ?? 1) * (c.helmRampMult ?? 1);
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
      if (impostors.has(id)) this.cooldowns[id] = { cable: this._eff("cableCooldown") };
    }
    const crewIds = ids.filter((id) => this.players.get(id).role === ROLE.CREW);
    this.commanderId = shuffle(crewIds, this.rng)[0];

    this.phase = PHASE.ACTIVE;
    this.voteRoundStartedAt = this.now;
    this._log("match_started", { playerCount: ids.length, impostorCount, commanderId: this.commanderId, perks: this.activePerks });

    // Hand off to the active mode (if any) to set up its own roles/state. The mode
    // may REPLACE the impostor/crew split (e.g. Infection's patient-zero setup).
    if (this.mode?.onMatchStart) {
      this.mode.onMatchStart(this);
      // Ensure every infected/hunter has a cable cooldown entry.
      for (const p of this.players.values()) {
        if (p.role === ROLE.IMPOSTOR && !this.cooldowns[p.id]) this.cooldowns[p.id] = { cable: this._eff("cableCooldown") };
      }
    }
    return { impostorCount, perks: this.activePerks, mode: this.mode?.id || null };
  }


  _assignTasks(templateSet) {
    const rooms = shuffle(this.map.rooms, this.rng).slice(0, Math.min(3, this.map.rooms.length));
    const energy = templateSet === ENERGY_TASKS;
    const gamePool = energy ? ENERGY_GAMES : PHYSICAL_GAMES;
    const tasks = [];
    for (const room of rooms) {
      // Generated rooms may be named "Labs 2", "Corridor 3" — fall back to the
      // base type (strip a trailing number) so they still get themed tasks.
      const baseType = room.replace(/\s+\d+$/, "");
      const template = templateSet[room] || templateSet[baseType] || ["Run a system diagnostic", "Recalibrate instruments"];
      const pool = shuffle(template, this.rng).slice(0, this.map.tasksPerRoom);
      const rect = this.map.geometry?.rooms?.[room];
      let idx = 0;
      for (const name of pool) {
        const game = gamePool[Math.floor(this.rng() * gamePool.length)];
        // place the task marker at a spread-out spot in the room (avoids overlap
        // and keeps it off the central walking lane). Falls back to room center.
        let tx = null, ty = null;
        if (rect) {
          const spots = [[0.25, 0.28], [0.75, 0.28], [0.25, 0.74], [0.75, 0.74], [0.5, 0.2]];
          const [fx, fy] = spots[idx % spots.length];
          tx = rect.x + fx * rect.w; ty = rect.y + fy * rect.h;
        }
        tasks.push({
          id: newId("task"), room, name, done: false,
          game, minSeconds: MINIGAMES[game].minSeconds,
          x: tx, y: ty,        // world position of the interactable "!" marker
          startedAt: null, // set when the player begins the mini-game
        });
        idx++;
      }
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
  // The oxygen machine (refill stations) only works if the oxygen system is
  // toggled on AND the power pool isn't empty AND life support isn't sabotaged.
  _oxygenOnline() { return this.systems.oxygenOn && this.power > 0 && !this._refillDisabled(); }

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

  // ---------- player reports ----------
  // A player flags another for review (e.g. a name or behavior that slipped past
  // the filter). We collect reports so the net layer can forward them to the
  // backend for moderation. Deliberately lightweight: it doesn't punish anyone
  // in-match, it just records the flag.
  reportPlayer(reporterId, targetId, reason = null) {
    const reporter = this._player(reporterId);
    const target = this.players.get(targetId);
    if (!target) throw new Error("No such player to report.");
    if (targetId === reporterId) throw new Error("You can't report yourself.");
    this._reports = this._reports || [];
    // de-dupe: one report per reporter->target
    if (this._reports.some((r) => r.reporterId === reporterId && r.targetId === targetId)) {
      return { ok: true, deduped: true };
    }
    this._reports.push({
      reporterId, reporterName: reporter.name,
      targetId, targetName: target.name,
      reason: reason ? String(reason).slice(0, 120) : "unspecified",
      at: this.now, matchId: this.id || null,
    });
    this._log("player_reported", { targetId, private: true, recipients: [reporterId] });
    return { ok: true };
  }
  drainReports() { const r = this._reports || []; this._reports = []; return r; }

  // ---------- emotes ----------
  // An expressive emote pops a bubble above the player for same-room viewers and
  // carries a sound cue. Cosmetic emotes the player owns are allowed too (passed
  // as a free-form key); otherwise it must be in the base EMOTES set.
  sendEmote(playerId, emoteKey) {
    this._requireActive();
    const p = this._player(playerId);
    const base = EMOTES[emoteKey];
    const owns = (p.loadout?.emote === emoteKey) || (Array.isArray(p.ownedEmotes) && p.ownedEmotes.includes(emoteKey));
    if (!base && !owns) throw new Error("Unknown emote.");
    const recipients = this._commRecipients(p);
    this._log("comm", {
      kind: "emote",
      from: playerId, fromName: p.name, fromPlane: p.plane,
      emote: emoteKey, emoji: base?.emoji || "✨", kanji: base?.kanji || null,
      sound: base?.sound || "emote_sparkle",
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
      // glide the avatar toward a free point in the room (avoiding furniture), and
      // commit room membership now (the player chose to enter an adjacent room).
      const free = nearestFree(g.x + g.w / 2, g.y + g.h / 2, blockersForRoom(room, g));
      p.tx = free.x; p.ty = free.y;
      p.room = room;
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

  // Advance every player toward their destination by dt seconds. Called by tick.
  _integrateMovement(dt) {
    if (!this.map.geometry) return;
    const speed = MOVE.SPEED_PER_SEC * (this.config.moveSpeedMult ?? 1) * dt;
    for (const p of this.players.values()) {
      if (p.plane === PLANE.ELIMINATED) continue;
      if (p.tx == null || p.x == null) continue;
      const dx = p.tx - p.x, dy = p.ty - p.y;
      const dist = Math.hypot(dx, dy);
      let nx, ny;
      if (dist <= MOVE.ARRIVE_EPS) { nx = p.tx; ny = p.ty; }
      else { const k = Math.min(1, speed / dist); nx = p.x + dx * k; ny = p.y + dy * k; }
      // Collision: block movement through furniture. Outside players ignore it
      // (they're in the void on a tether, not walking the room). Check blockers of
      // the room at the intended destination AND the current room (covers edges).
      if (!p.outside) {
        const rects = this._blockersNear(nx, ny, p.x, p.y);
        if (rects.length) { const r = resolveMove(p.x, p.y, nx, ny, rects); nx = r.x; ny = r.y; }
      }
      p.x = nx; p.y = ny;
      const r = this._roomAt(p.x, p.y);
      if (r) p.room = r;
    }
  }

  // All furniture blockers in world space, keyed by room (cached). For the client
  // renderer + so click-to-move can visualize obstacles.
  _allBlockers() {
    if (this._allBlockerCache) return this._allBlockerCache;
    const g = this.map.geometry; if (!g) return {};
    const out = {};
    for (const [name, rect] of Object.entries(g.rooms)) {
      const b = blockersForRoom(name, rect);
      if (b.length) out[name] = b;
    }
    this._allBlockerCache = out;
    return out;
  }

  // Gather furniture blockers for the room(s) under the given points (cached per
  // match since geometry is fixed). Usually one room; two near a doorway.
  _blockersNear(ax, ay, bx, by) {
    if (!this._blockerCache) this._blockerCache = {};
    const rooms = new Set([this._roomAt(ax, ay), this._roomAt(bx, by)].filter(Boolean));
    let out = [];
    for (const name of rooms) {
      if (!(name in this._blockerCache)) {
        const rect = this.map.geometry.rooms[name];
        this._blockerCache[name] = rect ? blockersForRoom(name, rect) : [];
      }
      out = out.concat(this._blockerCache[name]);
    }
    return out;
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
    if (!this.systems.oxygenOn) throw new Error("Oxygen machine is switched off — power it at a station.");
    if (this.power <= 0) throw new Error("No power — the oxygen machine is dead until tasks generate more.");
    p.oxygen = OXYGEN.MAX;
    this._log("refill", { id: playerId, room: p.room });
  }

  // ---------- crew: ship systems ----------
  // Oxygen remains a simple on/off station. Engines & shields are now a single
  // ALLOCATION slider controlled at the Helm (see setAllocation) — no more hard
  // engines/shields toggle.
  setSystem(playerId, system, on) {
    this._requireActive();
    const p = this._player(playerId);
    if (p.plane !== PLANE.PHYSICAL) throw new Error("Downed players can't run ship systems.");
    on = !!on;
    if (system === "oxygen") {
      this.systems.oxygenOn = on;
    } else if (system === "engines" || system === "shields") {
      // Back-compat shim: treat as a coarse allocation nudge so older callers/tests
      // still work. engines:true => full engines; shields:true => full shields.
      this.setAllocation(playerId, system === "engines" ? (on ? 1 : 0.5) : (on ? 0 : 0.5));
      return;
    } else {
      throw new Error("Unknown system.");
    }
    this._log("system_set", { system, on });
  }

  // ---------- Helm: engines<->shields power allocation ----------
  // Anyone standing at the Helm can set the target allocation (0..1). The actual
  // allocation ramps toward it over time (slow to speed up, quick to slow down).
  setAllocation(playerId, value) {
    this._requireActive();
    const p = this._player(playerId);
    if (p.plane !== PLANE.PHYSICAL) throw new Error("Downed players can't pilot.");
    if (p.room !== (this.map.spawnRoom || "Helm")) throw new Error("Adjust power allocation at the Helm.");
    this.targetAllocation = Math.max(0, Math.min(1, value));
    this._log("allocation_set", { target: Math.round(this.targetAllocation * 100) });
    return { target: this.targetAllocation };
  }
  // Effective shield strength 0..1 (more = less attack damage). Full when all
  // power is in shields (allocation 0), zero at full engines (allocation 1).
  _shieldStrength() { return 1 - this.allocation; }
  _shieldsUp() { return this._shieldStrength() > 0.35; } // back-compat: "shields effectively up"

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

  // ---------- turret defense ----------
  // Enter a turret. Only ONE player may occupy a turret at a time; you must be
  // standing in the turret's room. Returns the turret room you took.
  enterTurret(playerId) {
    this._requireActive();
    const p = this._player(playerId);
    if (p.plane !== PLANE.PHYSICAL) throw new Error("Downed players can't man turrets.");
    if (!(this.map.turretRooms || []).includes(p.room)) throw new Error("You're not in a turret.");
    const occupant = this.turretOccupants[p.room];
    if (occupant && occupant !== playerId) throw new Error("This turret is already manned.");
    // leave any other turret you were in
    for (const [room, occ] of Object.entries(this.turretOccupants)) if (occ === playerId) delete this.turretOccupants[room];
    this.turretOccupants[p.room] = playerId;
    this._log("turret_manned", { id: playerId, room: p.room, private: true, recipients: [playerId] });
    return { turret: p.room };
  }
  leaveTurret(playerId) {
    for (const [room, occ] of Object.entries(this.turretOccupants)) if (occ === playerId) delete this.turretOccupants[room];
  }
  // Fire from your turret at the incoming swarm. Server-enforces a per-shot
  // cooldown so you can't auto-fire, and only counts while an attack is active.
  shootPlane(playerId) {
    this._requireActive();
    const p = this._player(playerId);
    const turret = Object.entries(this.turretOccupants).find(([, occ]) => occ === playerId)?.[0];
    if (!turret || p.room !== turret) throw new Error("Man a turret first.");
    if (!this.attack) throw new Error("No incoming attack.");
    const cd = this.cooldowns[playerId]?.shot || 0;
    if (this.now < cd) throw new Error("Reloading.");
    (this.cooldowns[playerId] ||= {}).shot = this.now + ATTACK.SHOT_COOLDOWN_SEC;
    const downed = Math.min(ATTACK.PLANES_PER_SHOT, this.attack.planesLeft);
    this.attack.planesLeft -= downed;
    this.planesByPlayer[playerId] = (this.planesByPlayer[playerId] || 0) + downed;
    this._log("plane_downed", { id: playerId, by: p.name, planesLeft: this.attack.planesLeft });
    if (this.attack.planesLeft <= 0) this._endAttack("repelled");
    return { planesLeft: this.attack.planesLeft, yourTotal: this.planesByPlayer[playerId] };
  }
  // Begin an attack wave (random timer or CALL_ATTACK sabotage).
  startAttack(source = "random") {
    if (this.attack) return; // one at a time
    this.attack = { planesLeft: ATTACK.SWARM_SIZE, startedAt: this.now, lastDamageAt: this.now, source };
    this._log("attack_incoming", { swarm: ATTACK.SWARM_SIZE, source });
  }
  // Announce an incoming attack with a warning window (like a sabotage alert), so
  // crew can rush to the Helm + turrets before it lands.
  _warnAttack(source) {
    if (this.attack || this.attackWarnUntil != null) return;
    this.attackWarnUntil = this.now + ATTACK_WARNING_SECONDS;
    this.pendingAttackSource = source;
    this._log("attack_warning", { source, inSeconds: ATTACK_WARNING_SECONDS });
  }
  _endAttack(reason) {
    if (!this.attack) return;
    this._log("attack_ended", { reason, hull: Math.round(this.hull) });
    this.attack = null;
    // schedule the next random one
    this.nextRandomAttackAt = this.now + ATTACK.RANDOM_MIN_SEC + this.rng() * (ATTACK.RANDOM_MAX_SEC - ATTACK.RANDOM_MIN_SEC);
  }

  // ---------- airlock / going outside ----------
  // Step out through the airlock onto the tether. Must be in the airlock room and
  // the door must be unlocked. Outside, oxygen burns fast (see tick).
  goOutside(playerId) {
    this._requireActive();
    const p = this._player(playerId);
    if (p.plane !== PLANE.PHYSICAL) throw new Error("Only living crew can go outside.");
    if (p.room !== this.map.airlockRoom) throw new Error("You're not at the airlock.");
    if (this.airlockLocked) throw new Error("The airlock is locked.");
    if (p.outside) return { outside: true };
    p.outside = true;
    this._log("went_outside", { id: playerId, name: p.name });
    return { outside: true };
  }
  // Come back in. Blocked if the door is locked (you're trapped until rescued).
  comeInside(playerId) {
    this._requireActive();
    const p = this._player(playerId);
    if (!p.outside) return { outside: false };
    if (this.airlockLocked) throw new Error("The airlock is locked — bang for help!");
    p.outside = false;
    this.airlockDistress.delete(playerId);
    this._log("came_inside", { id: playerId, name: p.name });
    return { outside: false };
  }
  // Impostor locks the door from inside, trapping anyone outside.
  lockAirlock(impostorId) {
    this._requireActive();
    const imp = this._player(impostorId);
    if (imp.role !== ROLE.IMPOSTOR || imp.plane !== PLANE.PHYSICAL) throw new Error("Only living impostors can lock it.");
    if (imp.room !== this.map.airlockRoom) throw new Error("You're not at the airlock.");
    if (imp.outside) throw new Error("You can't lock it from outside.");
    this.airlockLocked = true;
    this._log("airlock_locked", { by: imp.name });
  }
  // Any living crew member in the airlock room can unlock it.
  unlockAirlock(playerId) {
    this._requireActive();
    const p = this._player(playerId);
    if (p.plane !== PLANE.PHYSICAL) throw new Error("Only living crew can unlock it.");
    if (p.room !== this.map.airlockRoom) throw new Error("You're not at the airlock.");
    if (p.outside) throw new Error("You must be inside to unlock it.");
    if (!this.airlockLocked) return;
    this.airlockLocked = false;
    this._log("airlock_unlocked", { by: p.name });
  }
  // Trapped outside: bang on the door to raise a distress call all living crew see.
  bangOnDoor(playerId) {
    this._requireActive();
    const p = this._player(playerId);
    if (!p.outside) throw new Error("You're not outside.");
    this.airlockDistress.add(playerId);
    this._log("airlock_distress", { id: playerId, name: p.name });
  }
  // The soldering task done OUTSIDE — server-timed, and burns extra oxygen.
  solderOutside(playerId) {
    this._requireActive();
    const p = this._player(playerId);
    if (!p.outside) throw new Error("The hull solder task is done outside.");
    p.oxygen = Math.max(0, p.oxygen - AIRLOCK.SOLDER_OXYGEN_COST);
    this._log("soldered", { id: playerId, oxygen: Math.round(p.oxygen) });
    return { oxygen: Math.round(p.oxygen) };
  }
  // Permanent freeze death (ran out of air in the void). NOT the energy plane.
  _freeze(playerId) {
    const p = this.players.get(playerId);
    if (!p || p.plane === PLANE.ELIMINATED) return;
    p.outside = false;
    p.frozen = true;
    this.airlockDistress.delete(playerId);
    this._log("frozen_in_void", { id: playerId, name: p.name });
    this._eliminate(playerId, "frozen");
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

  // A player surrenders / leaves an active match: they're removed from play
  // (eliminated) and a public note is logged so the rest of the crew sees it.
  // In lobby we just drop them entirely. Win conditions are re-checked so a
  // surrender that tips the balance ends the match correctly.
  surrender(playerId) {
    const p = this.players.get(playerId);
    if (!p) return;
    if (this.phase === PHASE.LOBBY) { this.players.delete(playerId); return; }
    if (this.phase !== PHASE.ACTIVE) return;
    this._log("player_surrendered", { id: playerId, name: p.name });
    p.surrendered = true;
    this._eliminate(playerId, "surrender");
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
    const cd = this.cooldowns[impostorId] || (this.cooldowns[impostorId] = { cable: 0 });
    if (this.now < cd.cable) throw new Error("Cable-pull on cooldown.");
    cd.cable = this.now + this._eff("cableCooldown");

    // A mode may reinterpret the cable-pull (KotH shove; Who Did It arms a guess).
    if (this.mode?.onShove && this.mode.onShove(this, target, impostorId)) return;

    // Stage by the plane both are on: physical => cross over; energy => eliminate.
    if (target.plane === PLANE.PHYSICAL) this._down(targetId, "cable_pull");
    else this._eliminate(targetId, "energy_cable_pull");

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

    // CALL_ATTACK is special: it summons an attack wave rather than installing a
    // persistent sabotage, and runs on its OWN cooldown (separate from the shared
    // sabotage gate) so impostors can pressure the crew with attacks independently.
    if (def.callsAttack) {
      if (this.now < this.callAttackCdUntil) throw new Error("Attack beacon recharging.");
      if (this.attack || this.attackWarnUntil != null) throw new Error("An attack is already underway.");
      this.callAttackCdUntil = this.now + ATTACK.CALL_COOLDOWN_SEC;
      this._warnAttack("sabotage");
      this._log("sabotage_started", { kind, label: def.label, callsAttack: true });
      return;
    }

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
    // Must have been started. We no longer enforce a minimum duration — when the
    // player solves the mini-game the client reports completion and it counts
    // immediately (no artificial wait). The abandon timeout still applies so a
    // stale "started" task can be restarted cleanly.
    if (task.startedAt == null) throw new Error("Start the task first.");
    const elapsed = this.now - task.startedAt;
    if (elapsed > TASK.ABANDON_SEC) { task.startedAt = null; throw new Error("Task timed out — start it again."); }
    task.done = true;
    task.startedAt = null;
    this._log("task_attempt", { id: playerId, plane: p.plane });

    // PHYSICAL plane: impostor "tasks" are fake — they generate NO power.
    // ENERGY plane: every downed player's tasks count (design choice).
    const counts = p.plane === PLANE.ENERGY || p.role === ROLE.CREW;
    if (counts) {
      // Ghosts (downed/energy plane) still help, but at reduced output — half the
      // power a living crew member generates per task.
      const ghostMult = p.plane === PLANE.ENERGY ? TASK.GHOST_POWER_MULT : 1;
      const gain = Math.round(this._eff("taskPower") * ghostMult);
      this.power = Math.min(this._eff("powerMax"), this.power + gain);
      this._log("power_generated", { amount: gain, pool: Math.round(this.power), ghost: p.plane === PLANE.ENERGY });
      if (p.tasks.every((t) => t.done)) {
        p.tasks = this._assignTasks(p.plane === PLANE.ENERGY ? ENERGY_TASKS : ROOM_TASKS);
      }
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

    // 0) Power economy: active systems drain the pool. If the pool can't cover a
    //    system this second, that system effectively goes dark for the tick.
    let powered = true;
    if (baseSim) {
    // Ramp the allocation toward its target: quick toward shields (slowdown),
    // slow toward engines (speedup). Perks can scale the ramp rates.
    if (this.allocation !== this.targetAllocation) {
      const speedingUp = this.targetAllocation > this.allocation;
      const seconds = (speedingUp ? HELM.SPEEDUP_SECONDS : HELM.SLOWDOWN_SECONDS) * this._eff("helmRampMult");
      const step = (1 / Math.max(0.1, seconds)) * dt; // full 0..1 sweep over `seconds`
      if (speedingUp) this.allocation = Math.min(this.targetAllocation, this.allocation + step);
      else this.allocation = Math.max(this.targetAllocation, this.allocation - step);
    }

    // Power draw: oxygen as before; engines+shields together draw proportionally
    // to the allocation split (the ship always spends on both ends of the slider).
    let draw = 0;
    if (this.systems.oxygenOn) draw += POWER.OXYGEN_DRAW_PER_SEC * dt;
    draw += POWER.ENGINE_DRAW_PER_SEC * this.allocation * dt;       // speed costs power
    draw += POWER.SHIELD_DRAW_PER_SEC * this._shieldStrength() * dt; // protection costs power
    powered = this.power >= draw;
    this.power = Math.max(0, this.power - draw);

    // Journey advances at a rate proportional to engine allocation (and only while
    // powered). Full speed at allocation 1, none at allocation 0 (all shields).
    if (this.allocation > 0 && powered) {
      const target = JOURNEY.DISTANCE * (this.config.journeyDistanceMult ?? 1);
      this.distance = Math.min(target, this.distance + JOURNEY.ENGINE_SPEED_PER_SEC * this.allocation * dt);
      if (this.distance >= target) {
        this.distanceReached = true;
        if (this.mode) { if (this._checkWin()) return; }
        else { this._end(WINNER.CREW, "reached_location"); return; }
      }
    }

    // Combat: enemy planes only damage the hull during a DISCRETE ATTACK WAVE.
    // Attacks start on a random timer or via the CALL_ATTACK sabotage. While one
    // is active, every surviving plane chips the hull on a cadence; shields up
    // (and powered) soak most of it. Crew end the attack by shooting all planes
    // down from turrets (see shootPlane). Position-leaked makes hits harder.
    const attract = this._attractActive();

    // schedule the first random attack a bit after launch
    if (this.nextRandomAttackAt == null) {
      this.nextRandomAttackAt = this.now + ATTACK.RANDOM_MIN_SEC + this.rng() * (ATTACK.RANDOM_MAX_SEC - ATTACK.RANDOM_MIN_SEC);
    }
    // Random attacks are ANNOUNCED: when the timer is up, arm a warning window
    // instead of striking immediately, giving crew ~10s to reach the Helm (slow
    // down / shields up) and man the turrets.
    if (!this.attack && this.attackWarnUntil == null && this.now >= this.nextRandomAttackAt) {
      this._warnAttack("random");
    }
    // when the warning elapses, the attack actually lands
    if (this.attackWarnUntil != null && this.now >= this.attackWarnUntil) {
      const src = this.pendingAttackSource || "random";
      this.attackWarnUntil = null; this.pendingAttackSource = null;
      this.startAttack(src);
    }

    if (this.attack) {
      if (this.now - this.attack.startedAt >= ATTACK.MAX_DURATION_SEC) {
        this._endAttack("withdrew");
      } else if (this.now - this.attack.lastDamageAt >= ATTACK.DAMAGE_INTERVAL_SEC) {
        this.attack.lastDamageAt = this.now;
        // Damage scales CONTINUOUSLY with shield strength (the Helm allocation):
        // full shields ~= the shielded floor, no shields ~= the unshielded max.
        const ss = powered ? this._shieldStrength() : 0; // unpowered = no protection
        const base = ATTACK.DMG_PER_TICK_UNSHIELDED - (ATTACK.DMG_PER_TICK_UNSHIELDED - ATTACK.DMG_PER_TICK_SHIELDED) * ss;
        const swarmFactor = this.attack.planesLeft / ATTACK.SWARM_SIZE;
        let dmg = base * this._eff("attackDamageMult") * (0.5 + 0.5 * swarmFactor);
        if (attract) dmg *= ATTRACT.dmgFactor;
        this.hull = Math.max(0, this.hull - dmg);
        this._log("attack_damage", { dmg: Math.round(dmg), shieldStrength: Math.round(ss * 100), planesLeft: this.attack.planesLeft, hull: Math.round(this.hull) });
        if (this.hull <= 0 && !this.mode) { this._end(WINNER.IMPOSTORS, "hull_destroyed"); return; }
      }
    }
    } // end baseSim (power / journey / combat)

    // 1) Oxygen drain for everyone still physical; empty tank => downed.
    //    (Refills require the oxygen machine to be powered — see refillOxygen.)
    //    The infiniteOxygen crazy toggle skips drain entirely.
    //    OUTSIDE the airlock, oxygen drains much faster (it doubles as propulsion).
    //    Running out while OUTSIDE is a permanent FREEZE death — no energy plane.
    if (!this.config.infiniteOxygen) {
      for (const p of this._living()) {
        const outside = !!p.outside;
        const drain = this._eff("oxygenDrain") * (outside ? AIRLOCK.OUTSIDE_OXYGEN_MULT : 1);
        p.oxygen = Math.max(0, p.oxygen - drain * dt);
        if (p.oxygen <= 0) {
          if (outside) this._freeze(p.id);     // permanent — they froze in the void
          else this._down(p.id, "out_of_air");
        }
        if (this.phase === PHASE.ENDED) return;
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
      }
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

    // Same-room-only visibility (hard walls): living players only see others in
    // their own room. This is the core "social deduction" sightline — you can't
    // watch the whole ship at once. Ghosts (downed) and post-game see everyone.
    // Impostors get NO x-ray either (they must also walk to see), but they still
    // learn each other's role below. Lights Out no longer changes sight (it's
    // already restricted); it keeps its other effects.
    const fullSight = iAmDowned || ended;

    const players = [...this.players.values()].map((p) => {
      const sameRoom = p.room === me.room;
      const base = { id: p.id, name: p.name, plane: p.plane, connected: p.connected, isBot: !!p.isBot,
        loadout: p.loadout, idColor: p.idColor };
      // Hide everyone not in my room (unless I have full sight). Self always shown.
      const hidespatial = !fullSight && !sameRoom && p.id !== me.id;
      base.room = hidespatial ? null : p.room;
      base.obscured = hidespatial;
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
        repairRooms: this.map.repairRooms,
        // Non-secret layout metadata the client HUD/minimap needs:
        adjacency: this.map.adjacency || null, spawnRoom: this.map.spawnRoom,
        geometry: this.map.geometry || null,
        blockers: this._allBlockers(),
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
      // turret-defense attack: present only while a wave is active
      attack: this.attack ? {
        planesLeft: this.attack.planesLeft,
        swarmSize: ATTACK.SWARM_SIZE,
        source: this.attack.source,
        secondsLeft: Math.max(0, Math.round(ATTACK.MAX_DURATION_SEC - (this.now - this.attack.startedAt))),
      } : null,
      // which turret (if any) you're manning, and which turrets are occupied
      yourTurret: Object.entries(this.turretOccupants).find(([, occ]) => occ === me.id)?.[0] || null,
      turretsOccupied: Object.keys(this.turretOccupants).filter((r) => this.turretOccupants[r]),
      planesDowned: this.planesByPlayer[me.id] || 0,
      // airlock / outside state
      airlock: {
        room: this.map.airlockRoom,
        locked: this.airlockLocked,
        youOutside: !!me.outside,
        // distress calls — all living crew see who's banging for help
        distress: [...this.airlockDistress].map((id) => ({ id, name: this.players.get(id)?.name })).filter((d) => d.name),
      },
      journey: { distance: Math.round(this.distance), total: JOURNEY.DISTANCE },
      systems: {
        oxygenOn: this.systems.oxygenOn,
        oxygenOnline: this._oxygenOnline(), // refills actually working right now
        // Helm allocation: 0 = all shields (slow/safe), 1 = all engines (fast/exposed)
        allocation: Math.round(this.allocation * 100) / 100,
        targetAllocation: Math.round(this.targetAllocation * 100) / 100,
        shieldStrength: Math.round(this._shieldStrength() * 100) / 100,
        ramping: this.allocation !== this.targetAllocation,
        // back-compat booleans some UI still reads, derived from the slider
        enginesOn: this.allocation > 0.5,
        shieldsUp: this._shieldsUp(),
      },
      // attack warning window (10s lead) so the client can flash "rush to Helm/turrets"
      attackWarning: this.attackWarnUntil != null
        ? { secondsLeft: Math.max(0, Math.round(this.attackWarnUntil - this.now)), source: this.pendingAttackSource }
        : null,
      helm: { room: this.map.spawnRoom || "Helm" },
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
        // Impostor-only: seconds until they can trigger another sabotage.
        sabotageCooldown: iAmImpostor ? Math.max(0, Math.round(this.globalSabotageCdUntil - this.now)) : undefined,
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
