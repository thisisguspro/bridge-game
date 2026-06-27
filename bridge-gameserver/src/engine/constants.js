// Game constants + map definitions. Maps are DATA — adding one is config, not code.
// Mirrors the backend's MAPS so both layers agree on scaling.
//
// CORE FICTION (v0.2): every player wears a breather fed by a backpack O2 tank.
// Tanks deplete over time; players must reach a Refill station to top up. When a
// tank empties — or an impostor detaches the air cable, or a continuous vote
// passes — the player is "downed": they cross to the ENERGY PLANE, a dreamlike
// mirror of the same map where they get a different task set that still feeds the
// SAME shared task bar. Downed players are not removed; they keep helping.

export const PHASE = {
  LOBBY: "lobby",     // waiting for players, not started
  DRAFT: "draft",     // perk draft: team votes perks before roles are revealed
  ACTIVE: "active",   // live play; continuous voting runs on a clock (no meeting phase)
  ENDED: "ended",     // win condition met
};

export const ROLE = {
  CREW: "crew",
  IMPOSTOR: "impostor",
};

// Which plane a player currently occupies.
export const PLANE = {
  PHYSICAL: "physical",   // alive, breathing, normal tasks
  ENERGY: "energy",       // downed — crossed over; still IN PLAY (counts for parity)
  ELIMINATED: "eliminated", // fully out — removed from all tallies (energy-plane cable-pull)
};

export const WINNER = {
  CREW: "crew",
  IMPOSTORS: "impostors",
  NONE: null,
};

// Reactor energy the commander allocates (unchanged).
export const SYSTEMS = ["engines", "shields", "sensors", "weapons", "lifesup"];
export const REACTOR_CAPACITY = 250;

// ---- Power economy (v0.3) ----
// Tasks generate POWER into a running pool. Three systems drain it per second
// while crew run them at their stations. If the pool empties, draws can't be
// sustained — oxygen refills go offline and the engines stop advancing.
export const POWER = {
  MAX: 1000,
  START: 200,
  PER_TASK: 60,            // each completed task adds this to the pool
  OXYGEN_DRAW_PER_SEC: 3,  // cost to keep the oxygen machine (refills) online
  ENGINE_DRAW_PER_SEC: 6,  // cost to run engines (advances the journey)
  SHIELD_DRAW_PER_SEC: 4,  // cost to hold shields up
};

// ---- Journey: reaching the next landing location is the crew win ----
// Tuned (v0.8): journey is reachable in ~3-4 pulsed engine windows interleaved
// with shield/repair recovery, not one continuous burn (which is unsurvivable
// by design — engines-on forces shields-off). See TUNING.md for the full model.
export const JOURNEY = {
  DISTANCE: 1350,                // sweep-tuned: ~11min median matches at 8 players
  ENGINE_SPEED_PER_SEC: 5,
};

// ---- Helm: engines<->shields power allocation ----
// One slider, set at the Helm by anyone standing there. allocation 0..1:
//   0 = ALL power to SHIELDS  -> ship slow (no journey), strong shields (low dmg)
//   1 = ALL power to ENGINES  -> ship fast (full journey speed), shields off (high dmg)
// The actual allocation RAMPS toward the target, not instantly: slowing down
// (toward shields) is quick, speeding up (toward engines) is slow. Perks can
// scale these ramp rates.
export const HELM = {
  START_ALLOCATION: 0.5,          // balanced at match start
  SLOWDOWN_SECONDS: 5,            // time to ramp fully toward shields (0)
  SPEEDUP_SECONDS: 15,            // time to ramp fully toward engines (1)
  // journey speed is ENGINE_SPEED_PER_SEC * allocation
  // shield strength (damage reduction) scales with (1 - allocation)
};

// Attacks are announced this many seconds before they hit, so crew can rush to
// the Helm (dump power to shields / slow down) and man the turrets.
export const ATTACK_WARNING_SECONDS = 10;

// ---- Emotes ----
// In-match expressive emotes (separate from voice commands). Each broadcasts a
// bubble to same-room players + an optional sound cue. `anime` ones lean into the
// chibi/anime feel. Cosmetic emotes the player owns can extend this at runtime;
// these are the always-available base set.
export const EMOTES = {
  WAVE:      { key: "WAVE",      emoji: "👋", label: "Wave",        kanji: "やあ",   sound: "emote_pop" },
  LAUGH:     { key: "LAUGH",     emoji: "😂", label: "Laugh",       kanji: "笑",     sound: "emote_laugh" },
  CRY:       { key: "CRY",       emoji: "😭", label: "Cry",         kanji: "泣",     sound: "emote_cry" },
  ANGRY:     { key: "ANGRY",     emoji: "😡", label: "Angry",       kanji: "怒",     sound: "emote_angry" },
  SHOCK:     { key: "SHOCK",     emoji: "😱", label: "Shocked",     kanji: "驚",     sound: "emote_gasp" },
  SMUG:      { key: "SMUG",      emoji: "😏", label: "Smug",        kanji: "ふっ",   sound: "emote_pop" },
  HEART:     { key: "HEART",     emoji: "💖", label: "Heart",       kanji: "好き",   sound: "emote_sparkle" },
  SWEAT:     { key: "SWEAT",     emoji: "😅", label: "Nervous",     kanji: "汗",     sound: "emote_pop" },
  THINK:     { key: "THINK",     emoji: "🤔", label: "Thinking",    kanji: "考",     sound: "emote_pop" },
  SLEEP:     { key: "SLEEP",     emoji: "😴", label: "Bored",       kanji: "眠",     sound: "emote_pop" },
  SALUTE:    { key: "SALUTE",    emoji: "🫡", label: "Salute",      kanji: "敬礼",   sound: "emote_pop" },
  SPARKLE:   { key: "SPARKLE",   emoji: "✨", label: "Sparkle",     kanji: "キラ",   sound: "emote_sparkle" },
  SKULL:     { key: "SKULL",     emoji: "💀", label: "Dead",        kanji: "死",     sound: "emote_pop" },
  POINT:     { key: "POINT",     emoji: "👉", label: "Point (You!)", kanji: "お前",  sound: "emote_alert" },
  SUS:       { key: "SUS",       emoji: "🤨", label: "Sus",         kanji: "怪",     sound: "emote_alert" },
  GG:        { key: "GG",        emoji: "🎉", label: "GG",          kanji: "勝利",   sound: "emote_sparkle" },
};

// Sound cues: logical names the client maps to audio files (with silent fallback
// when a file isn't present). Gameplay events also trigger cues via SOUND_EVENTS.
export const SOUND_CUES = [
  "emote_pop", "emote_laugh", "emote_cry", "emote_angry", "emote_gasp",
  "emote_sparkle", "emote_alert",
  "ui_click", "ui_back",
  "task_start", "task_done", "refill", "repair",
  "vote_cast", "ejected", "downed",
  "attack_warning", "attack_hit", "plane_down", "attack_repelled",
  "sabotage", "airlock_distress", "freeze", "victory", "defeat",
];

// Map server event types -> a sound cue the client should play when it sees one.
export const SOUND_EVENTS = {
  attack_warning: "attack_warning",
  attack_incoming: "attack_hit",
  attack_damage: "attack_hit",
  plane_downed: "plane_down",
  attack_ended: "attack_repelled",
  sabotage_started: "sabotage",
  airlock_distress: "airlock_distress",
  frozen_in_void: "freeze",
  eliminated_for_good: "ejected",
  player_downed: "downed",
  task_done: "task_done",
};

// ---- Continuous movement (real-time top-down) ----
// Players have an x/y world position and glide toward a destination each tick.
// World units are the same as the map geometry (a room is 120 units). At 180
// units/sec a player crosses a room in well under a second and a corridor in ~1s.
export const MOVE = {
  SPEED_PER_SEC: 9000,           // scaled 10x for the 100x-area map
  ARRIVE_EPS: 40,                // scaled for the huge map
  BOT_SPEED_MULT: 0.45,          // bots clearly slower than the player
  CORRIDOR_WIDTH: 5000,          // scaled for the huge rooms
};

// ---- Hull & combat ----
// Ambient attacks hit on a cadence. Shields absorb; with engines on, shields are
// OFF (hard binary) so the hull takes the full, heavier hit. Hull 0 => crew loss.
// Tuned so a continuous engine burn is fatal but PULSED play (burn, then recover
// shields/repair) reaches the landing. Repair stations claw hull back.
export const HULL = {
  MAX: 150,
  ATTACK_INTERVAL_SEC: 10,
  DMG_SHIELDED: 2,
  DMG_UNSHIELDED: 4,             // eased 5->4: timed mini-game tasks slowed power
                                 // generation, so the pulse windows needed slightly
                                 // less punishing unshielded hull damage to keep
                                 // larger crews viable (hull_destroyed was the
                                 // dominant impostor win at 8-10 players).
};

// ---- Oxygen model ----
export const OXYGEN = {
  MAX: 100,
  DRAIN_PER_SEC: 0.5,        // ~200s from full to empty if never refilled
  REFILL_PER_SEC: 25,        // a few seconds at a station to top up
  PANIC_THRESHOLD: 20,       // below this the client shows panic UI
};

// ---- Continuous vote clock ----
// A vote round is 2 minutes. At the 2:00 mark, if >half of living players have
// voted AND someone holds a majority of living players, they are eliminated.
// If no majority at 2:00, a grace minute runs to 3:00 targeting the current
// leader — but the instant anyone crosses majority-of-living during that minute,
// they are eliminated immediately. Then the clock resets.
export const VOTE = {
  ROUND_SECONDS: 120,
  GRACE_SECONDS: 60,         // extends to 180s total
};

// Sabotage catalogue. A single GLOBAL cooldown gates triggering ANY sabotage,
// so an impostor can't chain them. Multiple DIFFERENT sabotages can be active
// at once (distinct effects); the cooldown only limits how often new ones start.
// Each entry can: have a fuse (auto-end), be repairable at resolve rooms, and
// flip various effect flags consumed by the engine.
export const SABOTAGE = {
  LIFE_SUPPORT: { key: "LIFE_SUPPORT", label: "Life Support Offline",
    fuseSeconds: null, disablesRefill: true,
    resolveRooms: ["Medbay", "Reactor"], resolversNeeded: 2 },
  REACTOR_MELTDOWN: { key: "REACTOR_MELTDOWN", label: "Reactor Meltdown",
    fuseSeconds: 45, disablesRefill: false, losesIfExpires: true,
    resolveRooms: ["Reactor", "Engineering"], resolversNeeded: 2 },
  COMMS_BLACKOUT: { key: "COMMS_BLACKOUT", label: "Comms Blackout",
    fuseSeconds: null, disablesRefill: false,
    resolveRooms: ["Comms Array", "Sensors"], resolversNeeded: 1 },
  // NEW: leak the ship's position — attacks come faster & hit harder.
  ATTRACT_ATTACKERS: { key: "ATTRACT_ATTACKERS", label: "Position Leaked",
    fuseSeconds: 35, disablesRefill: false, attractsAttackers: true,
    resolveRooms: ["Comms Array", "Sensors", "Bridge"], resolversNeeded: 1 },
  // NEW: lights out — crew get a dimmed, low-info view; impostors see normally.
  LIGHTS_OUT: { key: "LIGHTS_OUT", label: "Lights Out",
    fuseSeconds: 30, disablesRefill: false, lightsOut: true,
    resolveRooms: ["Engineering", "Bridge"], resolversNeeded: 1 },
  // NEW: EMP — freezes task completion on BOTH planes. No fuse; multi-point fix.
  EMP_OUTAGE: { key: "EMP_OUTAGE", label: "EMP Power Outage",
    fuseSeconds: null, disablesRefill: false, freezesTasks: true,
    resolveRooms: ["Reactor", "Engineering", "Sensors"], resolversNeeded: 3 },
  // NEW: call in an enemy attack wave. Unlike other sabotages this isn't a
  // persistent debuff — it summons the turret-defense swarm and runs on its OWN
  // cooldown (ATTACK.CALL_COOLDOWN_SEC), separate from the normal sabotage gate.
  CALL_ATTACK: { key: "CALL_ATTACK", label: "Enemy Wave Inbound",
    fuseSeconds: null, disablesRefill: false, callsAttack: true,
    ownCooldown: true, resolveRooms: [], resolversNeeded: 0 },
};

// ---- Turret-defense attack waves ----
// An attack is a discrete event: a swarm of enemy planes the crew must shoot down
// from turrets. The attack ends when the whole swarm is destroyed. While it's
// active, any plane still flying damages the hull on a cadence (shields soak some).
// Attacks trigger on a random timer OR are CALLED IN by a dedicated sabotage that
// runs on its own cooldown, separate from the normal sabotage cooldown.
export const ATTACK = {
  SWARM_SIZE: 20,            // total planes to shoot down to end an attack
  DAMAGE_INTERVAL_SEC: 6,    // how often surviving planes hit the hull
  DMG_PER_TICK_SHIELDED: 2,  // hull damage per cadence tick with shields up
  DMG_PER_TICK_UNSHIELDED: 5,
  SHOT_COOLDOWN_SEC: 0.8,    // min time between a turret's shots (server-enforced)
  PLANES_PER_SHOT: 1,        // planes downed per shot
  RANDOM_MIN_SEC: 70,        // earliest a random attack can start after the last
  RANDOM_MAX_SEC: 140,       // latest
  CALL_COOLDOWN_SEC: 90,     // dedicated cooldown for the CALL_ATTACK sabotage
  MAX_DURATION_SEC: 75,      // if crew never clear it, it auto-ends (planes leave)
};

// While position is leaked, attacks come this much faster and this much harder.
export const ATTRACT = { intervalFactor: 0.5, dmgFactor: 2 };

// ---- Airlock / going outside ----
// You exit the ship through the Airlock on a tether (limited to the airlock zone).
// Outside, oxygen drains fast (it's also your propulsion) and a soldering task out
// there burns it too. An impostor can lock the door from inside, trapping you; you
// bang on the door to call for help (all living crew see it), and any crew member
// can come unlock it. If your oxygen runs out while outside you FREEZE — permanent
// elimination, no energy plane.
export const AIRLOCK = {
  OUTSIDE_OXYGEN_MULT: 3.0,    // oxygen drains this much faster outside
  SOLDER_OXYGEN_COST: 12,      // extra oxygen the soldering task burns
  SOLDER_MIN_SECONDS: 8,       // server-timed like other mini-games
};

// Global sabotage cooldown (shared across all sabotage types), per map override.
export const GLOBAL_SABOTAGE_COOLDOWN_SEC = 30;

export const MAPS = {
  nebula_drift: {
    id: "nebula_drift", name: "Nebula Drift", tier: "small",
    minPlayers: 5, maxPlayers: 10, impostors: 1,
    rooms: ["Bridge", "Engineering", "Sensors", "Reactor", "Medbay", "Turret Alpha", "Turret Beta"],
    refillRooms: ["Medbay", "Engineering"], // where you top up O2
    turretRooms: ["Turret Alpha", "Turret Beta"], // >=2 and >=2x impostors (1) => 2
    repairRooms: ["Engineering", "Reactor"],      // divert shields into hull here
    spawnRoom: "Bridge",
    tasksPerRoom: 2,
    sabotageCooldownSeconds: 25,
    cablePullCooldownSeconds: 45, // longer: pulls are deliberate (sim-tuned starting point)
  },
  ironhold_station: {
    id: "ironhold_station", name: "Ironhold Station", tier: "large",
    minPlayers: 10, maxPlayers: 20, impostors: 2,
    rooms: ["Bridge", "Engineering", "Sensors", "Reactor", "Medbay", "Cargo", "Hangar", "Comms Array",
            "Turret Alpha", "Turret Beta", "Turret Gamma", "Turret Delta"],
    refillRooms: ["Medbay", "Engineering", "Hangar"],
    turretRooms: ["Turret Alpha", "Turret Beta", "Turret Gamma", "Turret Delta"], // >=2x impostors (2) => 4
    repairRooms: ["Engineering", "Reactor", "Cargo"],
    spawnRoom: "Bridge",
    tasksPerRoom: 3,
    sabotageCooldownSeconds: 20,
    cablePullCooldownSeconds: 40,
  },
};

// ---- Tasks as timed mini-games ----
// A task is no longer instant: the player starts it, plays a small mini-game on
// the client for at least `minSeconds`, then completes it. The SERVER is the
// authority on timing — it records when the task was started and refuses a
// completion that arrives too early, so the client can't cheat by skipping the
// game. The client mini-game is "cosmetic" in the sense that the server only
// checks elapsed time + that the player stayed in the room; the specific game
// type is chosen here so the client knows what to render.
//
// Each mini-game is tuned to land in the 10–20s band for a normal player.
export const MINIGAMES = {
  wire_connect:  { key: "wire_connect",  label: "Connect the wires",     minSeconds: 11, energy: false },
  code_sequence: { key: "code_sequence", label: "Enter the code",        minSeconds: 10, energy: false },
  alignment:     { key: "alignment",     label: "Align the dish",        minSeconds: 12, energy: false },
  hold_timing:   { key: "hold_timing",   label: "Hold to calibrate",     minSeconds: 13, energy: false },
  water_sort:    { key: "water_sort",    label: "Sort the coolant",      minSeconds: 12, energy: false },
  pattern_recall:{ key: "pattern_recall",label: "Recall the pattern",     minSeconds: 10, energy: false },
  // energy-plane variants — same skills, ghostly theme, a touch quicker so being
  // downed still feels productive rather than punishing.
  flux_route:    { key: "flux_route",    label: "Route the flux",        minSeconds: 10, energy: true },
  phase_match:   { key: "phase_match",   label: "Match the phase",       minSeconds: 11, energy: true },
};
export const TASK = {
  // Anti-cheat grace: allow completion this many seconds before the nominal min
  // (covers latency/animation timing) — still far from "instant".
  EARLY_GRACE_SEC: 1.5,
  // A started task auto-expires if abandoned this long (so it can be restarted).
  ABANDON_SEC: 60,
  // Ghosts (downed/energy plane) generate this fraction of a living crew member's
  // task power — they still help, but less.
  GHOST_POWER_MULT: 0.5,
};
// Physical and energy mini-game pools to assign from.
const PHYSICAL_GAMES = ["wire_connect", "code_sequence", "alignment", "water_sort", "pattern_recall", "hold_timing"];
const ENERGY_GAMES = ["flux_route", "phase_match"];
export { PHYSICAL_GAMES, ENERGY_GAMES };

// Physical-plane task templates per room.
export const ROOM_TASKS = {
  "Bridge": ["Recalibrate navigation array", "Sync command console"],
  "Engineering": ["Reroute power conduit", "Patch coolant line", "Align drive core"],
  "Sensors": ["Clear sensor static", "Realign dish"],
  "Reactor": ["Stabilize reactor output", "Replace fuel cell", "Vent excess heat"],
  "Medbay": ["Submit bio-scan", "Restock medkit"],
  "Cargo": ["Secure cargo clamps", "Log manifest"],
  "Hangar": ["Pre-flight shuttle check", "Refuel drop pod"],
  "Comms Array": ["Boost signal gain", "Decrypt transmission"],
  "Labs": ["Run an assay", "Calibrate the centrifuge"],
  "Galley": ["Recycle ration packs", "Purge the water line"],
  "Storage": ["Inventory supplies", "Reseal a containment crate"],
  "Corridor": ["Reset a bulkhead door", "Clear a debris jam"],
  "Central Corridor": ["Reset a bulkhead door", "Patch floor plating"],
  "Junction": ["Reroute a conduit junction", "Test the intercom"],
  "Turret Alpha": ["Fight off boarders", "Reload turret cells"],
  "Turret Beta": ["Fight off boarders", "Reload turret cells"],
  "Turret Gamma": ["Fight off boarders", "Reload turret cells"],
  "Turret Delta": ["Fight off boarders", "Reload turret cells"],
};

// Energy-plane task templates — the "parallel universe" version of each room.
// Downed players see these; completing them feeds the SAME shared bar.
export const ENERGY_TASKS = {
  "Bridge": ["Channel a navigation echo", "Stabilize a command resonance"],
  "Engineering": ["Reweave a power filament", "Calm a coolant spirit", "Tune the drive aura"],
  "Sensors": ["Disperse sensor static-fog", "Refocus the dish's glow"],
  "Reactor": ["Soothe the reactor's pulse", "Rekindle a spent cell", "Bleed off heat-light"],
  "Medbay": ["Imprint a bio-echo", "Restore a medkit's shimmer"],
  "Cargo": ["Anchor a drifting glow-crate", "Trace a phantom manifest"],
  "Hangar": ["Align a shuttle's after-image", "Pour luminous fuel"],
  "Comms Array": ["Amplify a signal-ghost", "Unweave an encrypted echo"],
  "Labs": ["Stir a luminous assay", "Spin a phantom centrifuge"],
  "Galley": ["Recycle a ration-echo", "Purge a shimmering water line"],
  "Storage": ["Catalogue drifting glimmers", "Reseal a glowing crate"],
  "Corridor": ["Reset a spectral bulkhead", "Sweep away debris-light"],
  "Central Corridor": ["Reset a spectral bulkhead", "Mend phantom plating"],
  "Junction": ["Reroute a glowing junction", "Echo-test the intercom"],
  "Turret Alpha": ["Banish a boarding wraith", "Rekindle a spent turret-cell"],
  "Turret Beta": ["Banish a boarding wraith", "Rekindle a spent turret-cell"],
  "Turret Gamma": ["Banish a boarding wraith", "Rekindle a spent turret-cell"],
  "Turret Delta": ["Banish a boarding wraith", "Rekindle a spent turret-cell"],
};

// ---- Perk draft (v0.4) ----
// Before roles are revealed, the team is shown a MIXED list of crew and impostor
// perks and votes on perks DIRECTLY. The top N perks win and apply globally:
// crew perks buff the crew side, impostor perks buff the impostor side. Perks are
// never attributed to a player, and the mixed list means the draft can't leak
// who is what. Effects are deliberately SUBTLE — tune freely in one place here.
export const DRAFT = {
  PICKS: 3,            // how many perks the team ends up with
  SECONDS: 25,         // lobby draft timer; everyone voting early jumps ahead
};

// side: "crew" | "impostor" | "both"  (both = symmetric, affects everyone)
// effect keys are read by the engine; magnitudes are intentionally small.
export const PERKS = {
  AGILE_THRUSTERS:  { key: "AGILE_THRUSTERS",  side: "crew", label: "Agile Thrusters",
    desc: "Helm speed/slow changes happen 30% faster.", effect: { helmRampMult: 0.7 } },
  HEAVY_FLYWHEEL:   { key: "HEAVY_FLYWHEEL",   side: "crew", label: "Heavy Flywheel",
    desc: "Slower to maneuver (+40% ramp time) but the journey runs 10% longer per engine-second.", effect: { helmRampMult: 1.4 } },
  BIGGER_REACTOR:   { key: "BIGGER_REACTOR",   side: "crew", label: "Reinforced Reactor",
    desc: "+15% power pool capacity.", effect: { powerMaxMult: 1.15 } },
  LONGER_OXYGEN:    { key: "LONGER_OXYGEN",    side: "crew", label: "Deep-Cycle Tank",
    desc: "Oxygen drains 15% slower — you still must refill, just later.", effect: { oxygenDrainMult: 0.85 } },
  STURDY_HULL:      { key: "STURDY_HULL",      side: "crew", label: "Plated Hull",
    desc: "+10 starting hull.", effect: { hullBonus: 10 } },
  EFFICIENT_TASKS:  { key: "EFFICIENT_TASKS",  side: "crew", label: "Practiced Crew",
    desc: "Tasks generate 10% more power.", effect: { taskPowerMult: 1.10 } },
  FLEET_FEET:       { key: "FLEET_FEET",       side: "both", label: "Light Boots",
    desc: "Everyone moves a touch faster — crew and impostor alike.", effect: { moveSpeedMult: 1.08 } },
  QUICK_FUSES:      { key: "QUICK_FUSES",      side: "impostor", label: "Overclocked Tools",
    desc: "Sabotage global cooldown 12% shorter.", effect: { sabCooldownMult: 0.88 } },
  SILENT_STEPS:     { key: "SILENT_STEPS",     side: "impostor", label: "Muffled Tread",
    desc: "Cable-pull cooldown 12% shorter.", effect: { cableCooldownMult: 0.88 } },
  LINGERING_DARK:   { key: "LINGERING_DARK",   side: "impostor", label: "Lingering Dark",
    desc: "Lights Out and Position Leaked last 20% longer.", effect: { sabFuseMult: 1.20 } },
};

// ---- Comms (v0.5): canned voice commands + accessibility captions ----
// Commands are language-AGNOSTIC keys with optional params (e.g. a room). The
// client renders them in the player's chosen language via a translation pack, so
// "SOS in Reactor" reaches each teammate in their own language. Anything a player
// would HEAR also arrives as a caption (text + who said it) for accessibility and
// for players without audio. Routing mirrors voice: proximity for living, map-wide
// for downed; the downed hear everyone, the living never hear the downed.
//
// `param` declares what extra data the command carries so the client can fill the
// localized template. "room" => auto-filled with the speaker's current room.
export const VOICE_COMMANDS = {
  SOS:           { key: "SOS",           param: "room", emoji: "🆘", category: "alert" },
  HELP_TASK:     { key: "HELP_TASK",     param: "room", emoji: "🛠️", category: "request" },
  SABOTAGE_HERE: { key: "SABOTAGE_HERE", param: "room", emoji: "⚠️", category: "alert" },
  REFILL_HERE:   { key: "REFILL_HERE",   param: "room", emoji: "🫧", category: "info" },
  FOLLOW_ME:     { key: "FOLLOW_ME",     param: "room", emoji: "👋", category: "request" },
  SUSPECT:       { key: "SUSPECT",       param: "player", emoji: "🤨", category: "social" },
  CLEAR:         { key: "CLEAR",         param: "player", emoji: "✅", category: "social" },
  ON_MY_WAY:     { key: "ON_MY_WAY",     param: null,    emoji: "🏃", category: "info" },
  YES:           { key: "YES",           param: null,    emoji: "👍", category: "social" },
  NO:            { key: "NO",            param: null,    emoji: "👎", category: "social" },
};

// ---- Identification colors (v0.6) ----
// Every player is force-assigned a unique color + a colorblind-friendly SHAPE.
// The color is carried by the ALWAYS-VISIBLE breather (mouth/nose piece) and the
// oxygen tank, and the shape floats above the player's head — both independent of
// cosmetics, so players are always distinguishable. Supports up to 20 (large map).
export const ID_COLORS = [
  { name: "red",     hex: "#ff4d4d", shape: "triangle" },
  { name: "blue",    hex: "#4d7dff", shape: "circle" },
  { name: "green",   hex: "#49f5a0", shape: "square" },
  { name: "yellow",  hex: "#ffd24d", shape: "star" },
  { name: "magenta", hex: "#ff43c8", shape: "diamond" },
  { name: "cyan",    hex: "#34e2ff", shape: "hexagon" },
  { name: "orange",  hex: "#ff9a3d", shape: "pentagon" },
  { name: "purple",  hex: "#b46bff", shape: "cross" },
  { name: "lime",    hex: "#b6ff3d", shape: "heart" },
  { name: "pink",    hex: "#ff9ec4", shape: "crescent" },
  { name: "teal",    hex: "#2fd6c4", shape: "arrow" },
  { name: "brown",   hex: "#b07a4d", shape: "clover" },
  { name: "white",   hex: "#f0f0f5", shape: "spade" },
  { name: "black",   hex: "#3a3a4a", shape: "club" },
  { name: "gold",    hex: "#e8c24d", shape: "sun" },
  { name: "navy",    hex: "#2a3d7a", shape: "anchor" },
  { name: "coral",   hex: "#ff7a6b", shape: "shell" },
  { name: "mint",    hex: "#9ff5d0", shape: "leaf" },
  { name: "violet",  hex: "#8b5cff", shape: "bolt" },
  { name: "tan",     hex: "#d6c29f", shape: "moon" },
];

// ---- Host match config (v0.7) ----
// Every knob a host can override at lobby creation. Values here are the DEFAULTS
// — a host who changes nothing gets a normal game. Overrides are freely settable
// (no bounds) by design: standard knobs for tuning, plus "crazy" cosmetic/gameplay
// modifiers that are OFF by default. The engine reads resolved config at start.
//
// NOTE: because values are unbounded, a host CAN configure an unplayable match
// (e.g. moveSpeed 0). That's intentional for private/custom games. Defaults are
// sane so untouched configs are normal; Join Random should prefer default-ish
// lobbies (see RoomManager) so strangers aren't dropped into extreme configs.
export const MATCH_CONFIG_DEFAULTS = {
  // --- standard ---
  mapId: "nebula_drift",
  isPublic: false,            // private (code-only) unless the host opens it
  // --- advanced (gameplay) ---
  moveSpeedMult: 1.0,         // affects everyone; client uses for movement
  visibilityMult: 1.0,        // how far players can see (client render + Lights Out feel)
  attackIntervalMult: 1.0,    // <1 = more frequent attacks
  attackDamageMult: 1.0,      // hull damage scaling
  sabotageCount: null,        // null = use map default impostor scaling; else cap concurrent sabotages
  oxygenDrainMult: 1.0,
  taskPowerMult: 1.0,
  sabotageCooldownMult: 1.0,
  cablePullCooldownMult: 1.0,
  journeyDistanceMult: 1.0,   // scales the distance to the next landing (match length)
  // --- "crazy" modifiers (OFF/neutral by default; opt-in for silly games) ---
  bodySizeMult: 1.0,          // cosmetic: scales player models
  headSizeMult: 1.0,          // cosmetic: big-head mode
  lowGravity: false,          // cosmetic/feel: client movement flavor
  oneHitCables: false,        // (reserved) tweak cable behavior
};

// ---- Host match-config overrides (v0.7) ----
// Every knob a host can override per match. Values here are the DEFAULTS (drawn
// from the base constants). The host may set ANY value — no bounds enforced (per
// design) — but each knob is tagged so the UI can warn and matchmaking can prefer
// sane lobbies. `tier`: "standard" = normal range; "crazy" = off by default,
// experimental/extreme. The engine reads merged config at match start.
export const CONFIG_SCHEMA = {
  // Standard tuning — exposed, sane ranges suggested (not enforced).
  moveSpeedMult:      { tier: "standard", default: 1.0,  label: "Movement Speed", suggest: [0.5, 2.0] },
  visibilityMult:     { tier: "standard", default: 1.0,  label: "Visibility Range", suggest: [0.4, 2.0] },
  attackIntervalSec:  { tier: "standard", default: HULL.ATTACK_INTERVAL_SEC, label: "Attack Frequency (s between waves)", suggest: [4, 20] },
  attackDmgMult:      { tier: "standard", default: 1.0,  label: "Attack Damage", suggest: [0.5, 3] },
  impostorCount:      { tier: "standard", default: null, label: "Impostors (null = map default)", suggest: [1, 4] },
  maxConcurrentSabotage: { tier: "standard", default: 99, label: "Max Concurrent Sabotages", suggest: [1, 6] },
  sabotageCooldownSec:{ tier: "standard", default: null, label: "Sabotage Cooldown (null = map default)", suggest: [10, 60] },
  oxygenDrainMult:    { tier: "standard", default: 1.0,  label: "Oxygen Drain Rate", suggest: [0.5, 2] },
  taskPowerMult:      { tier: "standard", default: 1.0,  label: "Task Power Yield", suggest: [0.5, 2] },
  journeyDistanceMult:{ tier: "standard", default: 1.0,  label: "Journey Length", suggest: [0.5, 2] },

  // Crazy / experimental — OFF by default; extreme or silly modifiers.
  bodySizeMult:       { tier: "crazy", default: 1.0,  label: "Body Size", suggest: [0.3, 3] },
  headSizeMult:       { tier: "crazy", default: 1.0,  label: "Head Size", suggest: [0.3, 5] },
  lowGravity:         { tier: "crazy", default: false, label: "Low Gravity" },
  noVoting:           { tier: "crazy", default: false, label: "Disable Voting" },
  infiniteOxygen:     { tier: "crazy", default: false, label: "Infinite Oxygen" },
  oneHitHull:         { tier: "crazy", default: false, label: "Glass Hull (one big hit ends it)" },
};

// Build the default config object from the schema.
export function defaultConfig() {
  const cfg = {};
  for (const [k, v] of Object.entries(CONFIG_SCHEMA)) cfg[k] = v.default;
  return cfg;
}
