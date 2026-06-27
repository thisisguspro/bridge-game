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
  START: 500,              // increased from 200
  PER_TASK: 250,           // raised to 250 from 30 to match slower task completion times
  OXYGEN_DRAW_PER_SEC: 5,  // increased from 3
  ENGINE_DRAW_PER_SEC: 7,  // reduced by 1/3 (from 10 to 7)
  SHIELD_DRAW_PER_SEC: 6,  // increased from 4
};

// ---- Journey: reaching the next landing location is the crew win ----
// Tuned (v0.8): journey is reachable in ~3-4 pulsed engine windows interleaved
// with shield/repair recovery, not one continuous burn (which is unsurvivable
// by design — engines-on forces shields-off). See TUNING.md for the full model.
export const JOURNEY = {
  DISTANCE: 1350,                // sweep-tuned: ~11min median matches at 8 players
  ENGINE_SPEED_PER_SEC: 1.2,
};

// ---- Continuous movement (real-time top-down) ----
// Players have an x/y world position and glide toward a destination each tick.
// World units are the same as the map geometry (a room is 120 units). At 180
// units/sec a player crosses a room in well under a second and a corridor in ~1s.
export const MOVE = {
  SPEED_PER_SEC: 300,            // base glide speed in world units/sec
  ARRIVE_EPS: 4,                 // within this many units = arrived
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
  DRAIN_PER_SEC: 0.16,        // reduced to 0.16 (1/3 slower than 0.25, was ~400s, now ~625s)
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
    fuseSeconds: 90, disablesRefill: false, losesIfExpires: true,
    resolveRooms: ["Reactor", "Engineering"], resolversNeeded: 2 },
  COMMS_BLACKOUT: { key: "COMMS_BLACKOUT", label: "Comms Blackout",
    fuseSeconds: null, disablesRefill: false,
    resolveRooms: ["Comms Array", "Sensors"], resolversNeeded: 1 },
  // NEW: leak the ship's position — attacks come faster & hit harder.
  ATTRACT_ATTACKERS: { key: "ATTRACT_ATTACKERS", label: "Position Leaked",
    fuseSeconds: 35, disablesRefill: false, attractsAttackers: true,
    resolveRooms: ["Comms Array", "Sensors", "Helm"], resolversNeeded: 1 },
  // NEW: lights out — crew get a dimmed, low-info view; impostors see normally.
  LIGHTS_OUT: { key: "LIGHTS_OUT", label: "Lights Out",
    fuseSeconds: 30, disablesRefill: false, lightsOut: true,
    resolveRooms: ["Engineering", "Helm"], resolversNeeded: 1 },
  // NEW: EMP — freezes task completion on BOTH planes. No fuse; multi-point fix.
  EMP_OUTAGE: { key: "EMP_OUTAGE", label: "EMP Power Outage",
    fuseSeconds: null, disablesRefill: false, freezesTasks: true,
    resolveRooms: ["Reactor", "Engineering", "Sensors"], resolversNeeded: 3 },
  // NEW: airlock lockdown — prevents airlock use until resolved.
  AIRLOCK_LOCKDOWN: { key: "AIRLOCK_LOCKDOWN", label: "Airlock Lockdown",
    fuseSeconds: 40, disablesRefill: false, locksAirlock: true,
    resolveRooms: ["Airlock"], resolversNeeded: 1 },
};

// While position is leaked, attacks come this much faster and this much harder.
export const ATTRACT = { intervalFactor: 0.5, dmgFactor: 2 };

// Global sabotage cooldown (shared across all sabotage types), per map override.
export const GLOBAL_SABOTAGE_COOLDOWN_SEC = 30;

export const MAPS = {
  nebula_drift: {
    id: "nebula_drift", name: "Nebula Drift", tier: "small",
    minPlayers: 5, maxPlayers: 10, impostors: 1,
    rooms: ["Helm", "Reactor", "Engineering", "Sensors", "Medbay", "Airlock", "Space", "Turret Alpha", "Turret Beta"],
    adjacency: {
      "Reactor": ["Engineering", "Sensors"],
      "Engineering": ["Reactor", "Turret Alpha"],
      "Turret Alpha": ["Engineering", "Helm"],
      "Sensors": ["Reactor", "Medbay"],
      "Medbay": ["Sensors", "Airlock"],
      "Airlock": ["Medbay", "Turret Beta", "Space"],
      "Space": ["Airlock"],
      "Turret Beta": ["Airlock", "Helm"],
      "Helm": ["Turret Alpha", "Turret Beta"]
    },
    refillRooms: ["Medbay", "Engineering"], // where you top up O2
    turretRooms: ["Turret Alpha", "Turret Beta"], // >=2 and >=2x impostors (1) => 2
    repairRooms: ["Engineering", "Reactor"],      // divert shields into hull here
    spawnRoom: "Helm",
    tasksPerRoom: 2,
    sabotageCooldownSeconds: 25,
    cablePullCooldownSeconds: 45, // longer: pulls are deliberate (sim-tuned starting point)
  },
  ironhold_station: {
    id: "ironhold_station", name: "Ironhold Station", tier: "large",
    minPlayers: 10, maxPlayers: 20, impostors: 2,
    rooms: ["Helm", "Reactor", "Engineering", "Sensors", "Medbay", "Cargo", "Hangar", "Comms Array", "Airlock", "Space", "Turret Alpha", "Turret Beta", "Turret Gamma", "Turret Delta"],
    adjacency: {
      "Reactor": ["Engineering", "Sensors"],
      "Engineering": ["Reactor", "Turret Alpha"],
      "Turret Alpha": ["Engineering", "Cargo"],
      "Cargo": ["Turret Alpha", "Turret Beta"],
      "Turret Beta": ["Cargo", "Helm"],
      "Sensors": ["Reactor", "Medbay"],
      "Medbay": ["Sensors", "Hangar"],
      "Hangar": ["Medbay", "Comms Array"],
      "Comms Array": ["Hangar", "Airlock"],
      "Airlock": ["Comms Array", "Turret Gamma", "Space"],
      "Space": ["Airlock"],
      "Turret Gamma": ["Airlock", "Turret Delta"],
      "Turret Delta": ["Turret Gamma", "Helm"],
      "Helm": ["Turret Beta", "Turret Delta"]
    },
    refillRooms: ["Medbay", "Engineering", "Hangar"],
    turretRooms: ["Turret Alpha", "Turret Beta", "Turret Gamma", "Turret Delta"], // >=2x impostors (2) => 4
    repairRooms: ["Engineering", "Reactor", "Cargo"],
    spawnRoom: "Helm",
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
  // Physical plane
  wire_connect:  { key: "wire_connect",  label: "Pipe Router",           minSeconds: 6, energy: false },
  code_sequence: { key: "code_sequence", label: "Reflex Sequence",       minSeconds: 8, energy: false },
  alignment:     { key: "alignment",     label: "Target Tracking",       minSeconds: 10, energy: false },
  hold_timing:   { key: "hold_timing",   label: "Flappy Stabilizer",     minSeconds: 12, energy: false },
  // Energy plane (cyan tinted, for downed ghosts)
  flux_route:    { key: "flux_route",    label: "Whack-a-Node",          minSeconds: 12, energy: true },
  phase_match:   { key: "phase_match",   label: "Target Tracking",       minSeconds: 10, energy: true },
};
export const TASK = {
  // Anti-cheat grace: allow completion this many seconds before the nominal min
  // (covers latency/animation timing) — still far from "instant".
  EARLY_GRACE_SEC: 1.5,
  // A started task auto-expires if abandoned this long (so it can be restarted).
  ABANDON_SEC: 60,
};
// Physical and energy mini-game pools to assign from.
const PHYSICAL_GAMES = ["wire_connect", "code_sequence", "alignment", "hold_timing"];
const ENERGY_GAMES = ["flux_route", "phase_match"];
export { PHYSICAL_GAMES, ENERGY_GAMES };

// Physical-plane task templates per room.
export const ROOM_TASKS = {
  "Helm": ["Calibrate the helm console", "Plot a new course", "Adjust heading"],
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
  "Airlock": ["Cycle the airlock pressure", "Check the EVA suits"],
  "Space": ["Solder the hull breach", "Replace external sensor array"],
};

// Energy-plane task templates — the "parallel universe" version of each room.
// Downed players see these; completing them feeds the SAME shared bar.
export const ENERGY_TASKS = {
  "Helm": ["Channel a navigation whisper", "Stabilize the helm's echo"],
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
  "Airlock": ["Mend the airlock's spectral seal", "Calm the pressure ghost"],
  "Space": ["Weave a hull-breach shimmer", "Realign an astral sensor"],
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
  { name: "red",     hex: "#ff4d4d", shape: "triangle", hue: 0 },
  { name: "blue",    hex: "#4d7dff", shape: "circle", hue: 220 },
  { name: "green",   hex: "#49f5a0", shape: "square", hue: 150 },
  { name: "yellow",  hex: "#ffd24d", shape: "star", hue: 45 },
  { name: "magenta", hex: "#ff43c8", shape: "diamond", hue: 320 },
  { name: "cyan",    hex: "#34e2ff", shape: "hexagon", hue: 190 },
  { name: "orange",  hex: "#ff9a3d", shape: "pentagon", hue: 25 },
  { name: "purple",  hex: "#b46bff", shape: "cross", hue: 270 },
  { name: "lime",    hex: "#b6ff3d", shape: "heart", hue: 80 },
  { name: "pink",    hex: "#ff9ec4", shape: "crescent", hue: 340 },
  { name: "teal",    hex: "#2fd6c4", shape: "arrow", hue: 170 },
  { name: "brown",   hex: "#b07a4d", shape: "clover", hue: 25, sat: 0.5 },
  { name: "white",   hex: "#f0f0f5", shape: "spade", hue: 0, sat: 0 },
  { name: "black",   hex: "#3a3a4a", shape: "club", hue: 0, sat: 0, bright: 0.2 },
  { name: "gold",    hex: "#e8c24d", shape: "sun", hue: 45 },
  { name: "navy",    hex: "#2a3d7a", shape: "anchor", hue: 220, sat: 0.6, bright: 0.5 },
  { name: "coral",   hex: "#ff7a6b", shape: "shell", hue: 10 },
  { name: "mint",    hex: "#9ff5d0", shape: "leaf", hue: 150, sat: 0.4, bright: 1.2 },
  { name: "violet",  hex: "#8b5cff", shape: "bolt", hue: 260 },
  { name: "tan",     hex: "#d6c29f", shape: "moon", hue: 35, sat: 0.4 },
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
  mapId: "procedural",
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
