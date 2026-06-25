// ============================================================
// Cosmetics + progression catalogue (v0.1).
// All cosmetics, the equip-slot definitions, the XP curve, and the level-unlock
// ladder live here as DATA so they're easy to tweak without touching logic.
//
// Design rules baked in:
//  - Every player ALWAYS has a weapon (default multitool) and a bandana — these
//    slots can't be emptied, only reskinned.
//  - The bandana's *style* is a cosmetic, but its *color* is force-assigned per
//    match for identification (handled at match time, not here).
//  - Equipping a cosmetic requires (a) owning it and (b) its SLOT being unlocked
//    by level. Owning and equipping are separate.
// ============================================================

// ---- Equip slots ----
// alwaysFilled: slot can never be empty (has a default item).
// unlockLevel: the account level at which the slot becomes equippable.
export const SLOTS = {
  // Always-visible identity pieces — these carry the forced per-match ID color.
  breather:   { key: "breather",   label: "Breather",     alwaysFilled: true,  unlockLevel: 1,  default: "breather_standard", carriesIdColor: true },
  oxygenTank: { key: "oxygenTank", label: "O2 Tank",      alwaysFilled: true,  unlockLevel: 1,  default: "tank_standard",     carriesIdColor: true },
  weapon:     { key: "weapon",     label: "Tool",         alwaysFilled: true,  unlockLevel: 1,  default: "tool_multitool" }, // NEVER carries idColor — kept neutral so prestige skins (e.g. golden event weapons) stay purely cosmetic, not an identity tell
  bandana:    { key: "bandana",    label: "Bandana",      alwaysFilled: false, unlockLevel: 2 }, // now a pure cosmetic, not an identifier
  headpiece:  { key: "headpiece",  label: "Headpiece",    alwaysFilled: false, unlockLevel: 2 },
  body:       { key: "body",       label: "Costume",      alwaysFilled: false, unlockLevel: 3 },
  shoes:      { key: "shoes",      label: "Shoes",        alwaysFilled: false, unlockLevel: 5 },
  belt:       { key: "belt",       label: "Belt",         alwaysFilled: false, unlockLevel: 6 },
  border:     { key: "border",     label: "Profile Border", alwaysFilled: false, unlockLevel: 7 },
  victoryPose:{ key: "victoryPose",label: "Victory Pose", alwaysFilled: false, unlockLevel: 8 },
  emote:      { key: "emote",      label: "Emote",        alwaysFilled: false, unlockLevel: 9 },
};

// ---- Cosmetic catalogue ----
// Each item: id, slot, name, rarity, and a source hint (starter/level/box).
// Rarity mirrors the loot-box tiers in store.js.
export const COSMETICS = {
  // Breathers — ALWAYS visible; the mouth/nose piece that carries the ID color.
  breather_standard: { id: "breather_standard", slot: "breather", name: "Standard Breather", rarity: "Common", source: "starter" },
  breather_snout:    { id: "breather_snout",    slot: "breather", name: "Snout Rebreather",  rarity: "Rare",   source: "box" },
  breather_fanged:   { id: "breather_fanged",   slot: "breather", name: "Fanged Mask",       rarity: "Epic",   source: "box" },

  // O2 tanks — ALWAYS visible; the backpack tank that also carries the ID color.
  tank_standard:  { id: "tank_standard",  slot: "oxygenTank", name: "Standard O2 Tank", rarity: "Common", source: "starter" },
  tank_finned:    { id: "tank_finned",    slot: "oxygenTank", name: "Finned Tank",      rarity: "Rare",   source: "box" },
  tank_canister:  { id: "tank_canister",  slot: "oxygenTank", name: "Twin Canister",    rarity: "Epic",   source: "box" },

  // Bandanas — now an OPTIONAL cosmetic (no longer the identifier).
  bandana_standard: { id: "bandana_standard", slot: "bandana", name: "Standard Bandana", rarity: "Common", source: "level" },
  bandana_knot:     { id: "bandana_knot",     slot: "bandana", name: "Knotted Bandana",  rarity: "Rare",   source: "box" },
  bandana_tactical: { id: "bandana_tactical", slot: "bandana", name: "Tactical Wrap",     rarity: "Epic",   source: "box" },

  // Weapons (the always-present tool, reskinned)
  tool_multitool: { id: "tool_multitool", slot: "weapon", name: "Standard Multitool", rarity: "Common", source: "starter" },
  tool_wrench:    { id: "tool_wrench",    slot: "weapon", name: "Heavy Wrench",       rarity: "Common", source: "level" },
  tool_drill:     { id: "tool_drill",     slot: "weapon", name: "Plasma Drill",       rarity: "Rare",   source: "box" },
  tool_chicken:   { id: "tool_chicken",   slot: "weapon", name: "Rubber Chicken",     rarity: "Epic",   source: "box" },

  // Headpieces
  head_cap:     { id: "head_cap",     slot: "headpiece", name: "Cadet Cap",     rarity: "Common", source: "level" },
  head_visor:   { id: "head_visor",   slot: "headpiece", name: "Neon Visor",    rarity: "Rare",   source: "box" },
  head_halo:    { id: "head_halo",    slot: "headpiece", name: "Spirit Halo",   rarity: "Legendary", source: "box" },

  // Bodies / costumes
  body_jumpsuit: { id: "body_jumpsuit", slot: "body", name: "Crew Jumpsuit",   rarity: "Common", source: "level" },
  body_mecha:    { id: "body_mecha",    slot: "body", name: "Mecha Frame",     rarity: "Epic",   source: "box" },
  body_ronin:    { id: "body_ronin",    slot: "body", name: "Celestial Ronin", rarity: "Legendary", source: "box" },

  // Shoes
  shoes_boots:  { id: "shoes_boots",  slot: "shoes", name: "Mag Boots",     rarity: "Common", source: "level" },
  shoes_glow:   { id: "shoes_glow",   slot: "shoes", name: "Glowstep Boots", rarity: "Epic",  source: "box" },

  // Belts
  belt_utility: { id: "belt_utility", slot: "belt", name: "Utility Belt", rarity: "Common", source: "level" },

  // Borders
  border_bronze: { id: "border_bronze", slot: "border", name: "Bronze Frame", rarity: "Common", source: "level" },
  border_aurora: { id: "border_aurora", slot: "border", name: "Aurora Frame", rarity: "Epic",   source: "box" },

  // Victory poses
  pose_salute:  { id: "pose_salute",  slot: "victoryPose", name: "Crisp Salute",  rarity: "Common", source: "level" },
  pose_backflip:{ id: "pose_backflip",slot: "victoryPose", name: "Zero-G Backflip", rarity: "Rare", source: "box" },

  // Emotes
  emote_wave:   { id: "emote_wave",   slot: "emote", name: "Wave",       rarity: "Common", source: "level" },
  emote_dance:  { id: "emote_dance",  slot: "emote", name: "Victory Jig", rarity: "Rare",   source: "box" },
};

// ---- XP / level curve ----
// Total XP needed to REACH a level n is xpForLevel(n). Gentle early curve so the
// tutorial unlocks come quickly, then a steady climb.
export function xpForLevel(level) {
  if (level <= 1) return 0;
  // 100, 250, 450, 700, 1000, ... (quadratic-ish, rounded to 50s)
  return Math.round((50 * (level - 1) * level) / 1) ; // 50*n*(n-1): 1->0,2->100,3->300,4->600...
}
export function levelForXp(xp) {
  let lvl = 1;
  while (xpForLevel(lvl + 1) <= xp) lvl++;
  return lvl;
}

// ---- Unlock ladder ----
// What each level grants. Early levels are a guided tutorial: a sample cosmetic,
// then slots open one at a time, with a perk unlock woven in. "approve/tweak"
// territory — change freely.
export const LEVEL_UNLOCKS = {
  1:  { slots: ["breather", "oxygenTank", "weapon"], grants: ["breather_standard", "tank_standard", "tool_multitool"], note: "Starter kit — your breather, O2 tank, and multitool (all always visible; their color IDs you)." },
  2:  { slots: ["bandana", "headpiece"], grants: ["bandana_standard", "head_cap"], note: "Bandana + headpiece slots unlocked." },
  3:  { slots: ["body"], grants: ["body_jumpsuit"], note: "Costume slot unlocked." },
  4:  { grants: ["tank_finned"], note: "A new O2 tank skin." },
  5:  { slots: ["shoes"], grants: ["shoes_boots"], perks: ["LONGER_OXYGEN"], note: "Shoes slot + first perk available in drafts." },
  6:  { slots: ["belt"], grants: ["belt_utility"], note: "Belt slot unlocked." },
  7:  { slots: ["border"], grants: ["border_bronze"], note: "Profile border slot unlocked." },
  8:  { slots: ["victoryPose"], grants: ["pose_salute"], perks: ["BIGGER_REACTOR"], note: "Victory pose slot + a perk." },
  9:  { slots: ["emote"], grants: ["emote_wave"], note: "Emote slot unlocked." },
  10: { grants: ["tool_wrench"], perks: ["EFFICIENT_TASKS", "FLEET_FEET"], note: "A new tool skin + more perks." },
  12: { perks: ["STURDY_HULL"], note: "Perk unlocked." },
  15: { perks: ["QUICK_FUSES", "SILENT_STEPS"], note: "Impostor-side perks unlocked." },
  18: { perks: ["LINGERING_DARK"], note: "Final starter perk." },
};

// Convenience: everything unlocked at or below a level.
export function unlockedAt(level) {
  const slots = new Set();
  const perks = new Set();
  const grants = new Set();
  for (const [lvlStr, u] of Object.entries(LEVEL_UNLOCKS)) {
    if (Number(lvlStr) > level) continue;
    (u.slots || []).forEach((s) => slots.add(s));
    (u.perks || []).forEach((p) => perks.add(p));
    (u.grants || []).forEach((g) => grants.add(g));
  }
  return { slots: [...slots], perks: [...perks], grants: [...grants] };
}

// Default loadout for a brand-new account.
export function defaultLoadout() {
  return { breather: "breather_standard", oxygenTank: "tank_standard", weapon: "tool_multitool" };
}
