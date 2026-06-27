// In-memory implementation of the data interface.
// Every method here is what the routes call — swap this whole module for a
// Postgres-backed one later (same method signatures) and nothing upstream changes.

import { DEFAULT_CURRENCY, config } from "../config/index.js";
import {
  COSMETICS, SLOTS, levelForXp, unlockedAt, defaultLoadout, LEVEL_UNLOCKS,
} from "../config/cosmetics.js";
import { DEFAULT_SETTINGS, defaultWheels, sanitizeSettings, WHEEL_SLOTS } from "../config/settings.js";
import { normalizeReward, EVENT_FLAGS } from "../config/events.js";

const users = new Map();        // userId -> user
const inventories = new Map();  // userId -> [items]
const boxConfigs = new Map();   // boxId -> config
const codes = new Map();        // code -> { reward, currency, amount }
const codeRedemptions = new Map(); // `${userId}:${code}` -> true
const checkoutSessions = new Map(); // sessionId -> { userId, packId, prisms, status }
const events = new Map();        // eventId -> event record
const eventFlags = new Map();    // `${eventId}:${userId}` -> { flag, meta }
const bountyClaims = new Map();   // `${eventId}:${targetId}` -> { byUserId, at } (single claim per target/event)
const storeItems = new Map();    // id -> direct-purchase store item (with admin-only worth/dropWeight)
const txLog = [];               // transaction audit trail

let nextId = 1;
const uid = () => String(nextId++);

// ---- seed some loot boxes + codes so the API is usable immediately ----
function seed() {
  // Direct-purchase store items. Each carries PUBLIC fields (price, currency,
  // priceCents for cash) and ADMIN-ONLY fields never sent to players:
  //   dropWeight — relative likelihood when this item appears in a loot box
  //   worth      — an internal "value" number (e.g. coin-out / accounting worth)
  // Admins edit all of these in the console; players only ever see price/name.
  const item = (o) => ({ kind: "item", enabled: true, dropWeight: 10, worth: 0, ...o });
  storeItems.set("si_band_knot", item({ id:"si_band_knot", cosmeticId:"bandana_knot", name:"Knotted Bandana", rarity:"Common", currency:"CREDITS", price:150, dropWeight:70, worth:25 }));
  storeItems.set("si_visor",     item({ id:"si_visor",     cosmeticId:"head_visor",   name:"Neon Visor",      rarity:"Rare",   currency:"CREDITS", price:600, dropWeight:24, worth:120 }));
  storeItems.set("si_drill",     item({ id:"si_drill",     cosmeticId:"tool_drill",   name:"Plasma Drill",    rarity:"Rare",   currency:"CREDITS", price:550, dropWeight:30, worth:110 }));
  storeItems.set("si_glow",      item({ id:"si_glow",      cosmeticId:"shoes_glow",   name:"Glowstep Boots",  rarity:"Epic",   currency:"CREDITS", price:1200, dropWeight:12, worth:300 }));
  // PREMIUM (cash-adjacent) direct items — priceCents drives Stripe. $1 test items.
  storeItems.set("si_halo",      item({ id:"si_halo",      cosmeticId:"head_halo",    name:"Spirit Halo",     rarity:"Legendary", currency:"PREMIUM", price:100, priceCents:100, dropWeight:2,  worth:900 }));
  storeItems.set("si_ronin",     item({ id:"si_ronin",     cosmeticId:"body_ronin",   name:"Celestial Ronin", rarity:"Legendary", currency:"PREMIUM", price:100, priceCents:100, dropWeight:3,  worth:850 }));
  storeItems.set("si_aurora",    item({ id:"si_aurora",    cosmeticId:"border_aurora",name:"Aurora Frame",    rarity:"Epic",      currency:"PREMIUM", price:100, priceCents:100, dropWeight:10, worth:400 }));

  boxConfigs.set("cadet_crate", {
    id: "cadet_crate", name: "Cadet Crate", price: 250, currency: "CREDITS", kind: "box", enabled: true, worth: 250,
    drops: [
      { cosmeticId: "bandana_knot",  item: "Knotted Bandana", rarity: "Common", weight: 70 },
      { cosmeticId: "head_visor",    item: "Neon Visor",      rarity: "Rare",   weight: 24 },
      { cosmeticId: "body_mecha",    item: "Mecha Frame",     rarity: "Epic",   weight: 5 },
      { cosmeticId: "head_halo",     item: "Spirit Halo",     rarity: "Legendary", weight: 1 },
    ],
  });
  boxConfigs.set("vanguard_cache", {
    id: "vanguard_cache", name: "Vanguard Cache", price: 600, currency: "CREDITS", kind: "box", enabled: true, worth: 600,
    drops: [
      { cosmeticId: "tool_drill",    item: "Plasma Drill",     rarity: "Rare",   weight: 38 },
      { cosmeticId: "shoes_glow",    item: "Glowstep Boots",   rarity: "Epic",   weight: 14 },
      { cosmeticId: "tank_finned",   item: "Finned Tank",      rarity: "Rare",  weight: 45 },
      { cosmeticId: "body_ronin",    item: "Celestial Ronin",  rarity: "Legendary", weight: 3 },
    ],
  });
  boxConfigs.set("prism_vault", {
    id: "prism_vault", name: "Prism Vault", price: 300, currency: "PREMIUM", kind: "box", enabled: true, worth: 300, priceCents: 300,
    drops: [
      { cosmeticId: "border_aurora", item: "Aurora Frame",   rarity: "Epic",      weight: 50 },
      { cosmeticId: "head_halo",     item: "Spirit Halo",     rarity: "Legendary", weight: 20 },
      { cosmeticId: "body_ronin",    item: "Celestial Ronin", rarity: "Legendary", weight: 15 },
      { cosmeticId: "pose_backflip", item: "Zero-G Backflip", rarity: "Rare",      weight: 15 },
    ],
  });
  codes.set("BRIDGE-LAUNCH", { reward: { cosmeticId: "tool_chicken", item: "Rubber Chicken", rarity: "Epic" } });
  codes.set("WELCOME-500", { currency: "CREDITS", amount: 500 });
  codes.set("NEON-PILOT", { reward: { cosmeticId: "head_visor", item: "Neon Visor", rarity: "Rare" } });
}
seed();

export const memoryStore = {
  // ----- users -----
  async findUserByGoogleId(googleId) {
    for (const u of users.values()) if (u.googleId === googleId) return u;
    return null;
  },
  async createUser({ googleId, name, email, avatar, password }) {
    const id = uid();
    // Bootstrap: the configured super-admin email always gets full power.
    const isSuper = !!email && email.toLowerCase() === config.superadminEmail.toLowerCase();
    const user = {
      id, googleId, name, email, avatar, password,
      balances: { CREDITS: 1000, PREMIUM: 0 }, // starter Credits
      xp: 0,
      level: 1,
      adminRole: isSuper ? "superadmin" : null, // null | "admin" | "superadmin"
      moderation: { banned: false, banUntil: null, banReason: null, silenced: false },
      cosmetics: new Set(),     // owned cosmetic ids
      loadout: defaultLoadout(),// equipped per slot
      settings: structuredClone(DEFAULT_SETTINGS),
      wheels: defaultWheels(),  // emote + comms radial bindings
      createdAt: new Date().toISOString(),
    };
    users.set(id, user);
    inventories.set(id, []);
    // Grant the level-1 starter cosmetics so the kit is owned, not just defaulted.
    for (const cid of (LEVEL_UNLOCKS[1]?.grants || [])) user.cosmetics.add(cid);
    return user;
  },
  async getUser(id) { return users.get(id) || null; },

  // ----- balances (currency-agnostic) -----
  async getBalance(userId, currency = DEFAULT_CURRENCY) {
    const u = users.get(userId);
    return u ? (u.balances[currency] ?? 0) : 0;
  },
  async adjustBalance(userId, currency, delta, reason) {
    const u = users.get(userId);
    if (!u) throw new Error("user not found");
    const next = (u.balances[currency] ?? 0) + delta;
    if (next < 0) throw new Error("insufficient funds");
    u.balances[currency] = next;
    txLog.push({ userId, currency, delta, reason, at: new Date().toISOString() });
    return u.balances[currency];
  },

  // ----- inventory -----
  async getInventory(userId) { return inventories.get(userId) || []; },
  async addItem(userId, item, rarity, source) {
    const inv = inventories.get(userId) || [];
    const entry = { id: uid(), item, rarity, source, acquiredAt: new Date().toISOString() };
    inv.unshift(entry);
    inventories.set(userId, inv);
    return entry;
  },

  // ----- progression -----
  // Award XP, recompute level, and grant any cosmetics tied to newly-reached
  // levels. Returns what changed so the API can show level-up rewards.
  async addXp(userId, amount, reason) {
    const u = users.get(userId);
    if (!u) throw new Error("user not found");
    const prevLevel = u.level;
    u.xp += Math.max(0, Math.round(amount));
    u.level = levelForXp(u.xp);
    const newlyGranted = [];
    if (u.level > prevLevel) {
      for (let lvl = prevLevel + 1; lvl <= u.level; lvl++) {
        for (const cid of (LEVEL_UNLOCKS[lvl]?.grants || [])) {
          if (!u.cosmetics.has(cid)) { u.cosmetics.add(cid); newlyGranted.push(cid); }
        }
      }
    }
    txLog.push({ userId, type: "xp", amount, reason, at: new Date().toISOString() });
    return { xp: u.xp, level: u.level, leveledUp: u.level > prevLevel, fromLevel: prevLevel, granted: newlyGranted };
  },

  // ----- cosmetics: ownership + equipping -----
  async grantCosmetic(userId, cosmeticId) {
    const u = users.get(userId);
    if (!u) throw new Error("user not found");
    if (!COSMETICS[cosmeticId]) throw new Error("unknown cosmetic");
    const already = u.cosmetics.has(cosmeticId);
    u.cosmetics.add(cosmeticId);
    return { cosmeticId, newlyOwned: !already };
  },

  async getProfile(userId) {
    const u = users.get(userId);
    if (!u) return null;
    const unlocked = unlockedAt(u.level);
    return {
      id: u.id, name: u.name, avatar: u.avatar,
      xp: u.xp, level: u.level,
      balances: u.balances,
      owned: [...u.cosmetics],
      loadout: { ...u.loadout },
      unlockedSlots: unlocked.slots,
      unlockedPerks: unlocked.perks,
    };
  },

  // Compact profile the GAME SERVER pulls on join: the equipped loadout (what
  // others see) and the perks this account has unlocked (to pool into the draft).
  async getMatchProfile(userId) {
    const u = users.get(userId);
    if (!u) return null;
    return {
      id: u.id, name: u.name, level: u.level,
      loadout: { ...u.loadout },          // includes bandana STYLE; color forced per match
      unlockedPerks: unlockedAt(u.level).perks,
      banned: u.moderation.banned,         // game server blocks banned players at join
      silenced: u.moderation.silenced,     // game server disables their voice/comms
      eventFlags: await this.getEventFlags(userId), // active-event roles (bounty target, event host)
    };
  },
  async equipCosmetic(userId, cosmeticId) {
    const u = users.get(userId);
    if (!u) throw new Error("user not found");
    const cos = COSMETICS[cosmeticId];
    if (!cos) throw new Error("unknown cosmetic");
    if (!u.cosmetics.has(cosmeticId)) throw new Error("you don't own that cosmetic");
    const slot = SLOTS[cos.slot];
    const unlocked = unlockedAt(u.level).slots;
    if (!unlocked.includes(cos.slot)) throw new Error(`${slot.label} slot unlocks at level ${slot.unlockLevel}`);
    u.loadout[cos.slot] = cosmeticId;
    return { slot: cos.slot, equipped: cosmeticId, loadout: { ...u.loadout } };
  },

  // Clear a non-essential slot (always-filled slots can't be emptied).
  async unequipSlot(userId, slotKey) {
    const u = users.get(userId);
    if (!u) throw new Error("user not found");
    const slot = SLOTS[slotKey];
    if (!slot) throw new Error("unknown slot");
    if (slot.alwaysFilled) throw new Error(`${slot.label} can't be emptied — only reskinned`);
    delete u.loadout[slotKey];
    return { slot: slotKey, loadout: { ...u.loadout } };
  },

  // ----- settings (audio / graphics / accessibility / controls) -----
  async getSettings(userId) {
    const u = users.get(userId);
    if (!u) return null;
    return { settings: structuredClone(u.settings), wheels: structuredClone(u.wheels) };
  },
  // Merge + sanitize incoming settings over current (then over defaults).
  async updateSettings(userId, incoming) {
    const u = users.get(userId);
    if (!u) throw new Error("user not found");
    // Layer: defaults <- current <- incoming, all run through the sanitizer.
    const merged = { ...u.settings };
    for (const cat of Object.keys(incoming || {})) merged[cat] = { ...u.settings[cat], ...incoming[cat] };
    u.settings = sanitizeSettings(merged);
    return { settings: structuredClone(u.settings) };
  },

  // ----- radial wheels (emote + comms) -----
  // Bind an item to a wheel slot. Validates the item is legal for that wheel and
  // (for emotes) owned by the player. Pass null to clear a slot.
  async setWheelSlot(userId, wheel, slotIndex, itemKey) {
    const u = users.get(userId);
    if (!u) throw new Error("user not found");
    if (wheel !== "emote" && wheel !== "comms") throw new Error("unknown wheel");
    if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= WHEEL_SLOTS) throw new Error("bad slot index");
    if (itemKey !== null) {
      if (wheel === "emote") {
        const cos = COSMETICS[itemKey];
        if (!cos || cos.slot !== "emote") throw new Error("not an emote");
        if (!u.cosmetics.has(itemKey)) throw new Error("you don't own that emote");
      }
      // comms items are voice-command keys; the route validates against the catalogue.
    }
    u.wheels[wheel][slotIndex] = itemKey;
    return { wheel, slotIndex, itemKey, wheels: structuredClone(u.wheels) };
  },

  // ----- loot boxes -----
  async listBoxes() { return [...boxConfigs.values()]; },
  async getBox(boxId) { return boxConfigs.get(boxId) || null; },

  // ----- direct-purchase store items -----
  async listStoreItems() { return [...storeItems.values()]; },
  async getStoreItem(id) { return storeItems.get(id) || null; },

  // ----- admin: edit any store entry (item OR box) -----
  // Lets admins change the public price/currency AND the hidden worth/dropWeight.
  async adminListStore() {
    return { items: [...storeItems.values()], boxes: [...boxConfigs.values()] };
  },
  async adminUpdateStoreEntry(id, patch) {
    const target = storeItems.get(id) || boxConfigs.get(id);
    if (!target) throw new Error("No such store entry.");
    // Only allow known mutable fields.
    const allowed = ["name", "price", "priceCents", "currency", "enabled", "dropWeight", "worth"];
    for (const k of allowed) if (k in patch) target[k] = patch[k];
    return target;
  },
  async adminCreateStoreItem(data) {
    const id = data.id || ("si_" + uid());
    const it = { kind: "item", enabled: true, dropWeight: 10, worth: 0, ...data, id };
    storeItems.set(id, it);
    return it;
  },
  async adminDeleteStoreEntry(id) {
    return storeItems.delete(id) || boxConfigs.delete(id);
  },

  async upsertBox(box) { boxConfigs.set(box.id, box); return box; },

  // ----- codes -----
  async getCode(code) { return codes.get(code) || null; },
  async hasRedeemed(userId, code) { return codeRedemptions.has(`${userId}:${code}`); },
  async markRedeemed(userId, code) { codeRedemptions.set(`${userId}:${code}`, true); },
  async createCode(code, payload) { codes.set(code, payload); return { code, ...payload }; },

  // ----- paid-store checkout sessions (Stripe) -----
  // We record a pending session at checkout creation, then the webhook looks it
  // up to credit Prisms exactly once. Status guards against double-fulfillment.
  async createCheckoutSession(sessionId, payload) {
    // Persist the whole payload so both prism packs ({packId, prisms}) and item
    // carts ({kind:'items', grantCosmetics, totalCents}) round-trip intact.
    checkoutSessions.set(sessionId, { sessionId, status: "pending", createdAt: new Date().toISOString(), ...payload });
    return checkoutSessions.get(sessionId);
  },
  async getCheckoutSession(sessionId) { return checkoutSessions.get(sessionId) || null; },
  async fulfillCheckoutSession(sessionId) {
    const s = checkoutSessions.get(sessionId);
    if (!s) throw new Error("unknown session");
    if (s.status === "fulfilled") return { ...s, alreadyFulfilled: true };
    s.status = "fulfilled";
    s.fulfilledAt = new Date().toISOString();
    return { ...s, alreadyFulfilled: false };
  },

  // ===================== ADMIN =====================
  // Find by id, exact email, or name substring (for the lookup screen).
  async adminSearchUsers(query, limit = 25) {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return [];
    const out = [];
    for (const u of users.values()) {
      if (u.id === q || (u.email || "").toLowerCase() === q || (u.name || "").toLowerCase().includes(q)) {
        out.push(this._adminUserSummary(u));
        if (out.length >= limit) break;
      }
    }
    return out;
  },
  _adminUserSummary(u) {
    return {
      id: u.id, name: u.name, email: u.email, avatar: u.avatar,
      level: u.level, xp: u.xp, balances: { ...u.balances },
      adminRole: u.adminRole, moderation: { ...u.moderation },
      ownedCount: u.cosmetics.size,
    };
  },
  // Full detail for one account (admin view): everything they have.
  async adminGetUser(userId) {
    const u = users.get(userId);
    if (!u) return null;
    return { ...this._adminUserSummary(u), owned: [...u.cosmetics], loadout: { ...u.loadout } };
  },

  // ----- admin role management (superadmin only — enforced in the route) -----
  async setAdminRole(userId, role /* null | "admin" | "superadmin" */) {
    const u = users.get(userId);
    if (!u) throw new Error("user not found");
    u.adminRole = role;
    return { userId, adminRole: role };
  },
  async listAdmins() {
    return [...users.values()].filter((u) => u.adminRole).map((u) => this._adminUserSummary(u));
  },

  // ----- moderation: ban + silence -----
  async setBan(userId, { banned, durationMs = null, reason = null }) {
    const u = users.get(userId);
    if (!u) throw new Error("user not found");
    u.moderation.banned = !!banned;
    u.moderation.banReason = banned ? reason : null;
    u.moderation.banUntil = banned && durationMs ? new Date(Date.now() + durationMs).toISOString() : null; // null = permanent (if banned) or N/A
    return { userId, moderation: { ...u.moderation } };
  },
  async setSilence(userId, silenced) {
    const u = users.get(userId);
    if (!u) throw new Error("user not found");
    u.moderation.silenced = !!silenced;
    return { userId, moderation: { ...u.moderation } };
  },
  // Effective ban check (auto-expires temp bans).
  async isBanned(userId) {
    const u = users.get(userId);
    if (!u || !u.moderation.banned) return { banned: false };
    if (u.moderation.banUntil && new Date(u.moderation.banUntil) <= new Date()) {
      u.moderation.banned = false; u.moderation.banUntil = null; u.moderation.banReason = null;
      return { banned: false };
    }
    return { banned: true, until: u.moderation.banUntil, reason: u.moderation.banReason };
  },

  // ----- grant / remove (single) -----
  async removeCosmetic(userId, cosmeticId) {
    const u = users.get(userId);
    if (!u) throw new Error("user not found");
    const had = u.cosmetics.delete(cosmeticId);
    // If it was equipped, drop it from the loadout (unless an always-filled slot).
    for (const [slot, eq] of Object.entries(u.loadout)) {
      if (eq === cosmeticId && !SLOTS[slot]?.alwaysFilled) delete u.loadout[slot];
    }
    return { userId, cosmeticId, removed: had };
  },
  // setBalance lets admins set an exact value; adjust uses the existing method.
  async setBalance(userId, currency, value) {
    const u = users.get(userId);
    if (!u) throw new Error("user not found");
    u.balances[currency] = Math.max(0, Math.round(value));
    return { userId, currency, balance: u.balances[currency] };
  },

  // ----- bulk operations -----
  // Apply a gift (item and/or currency) to many accounts; returns per-user result.
  async bulkGrant(userIds, { cosmeticId = null, currency = null, amount = 0 }) {
    const results = [];
    for (const id of userIds) {
      const u = users.get(id);
      if (!u) { results.push({ userId: id, ok: false, error: "not found" }); continue; }
      if (cosmeticId && COSMETICS[cosmeticId]) u.cosmetics.add(cosmeticId);
      if (currency && amount) u.balances[currency] = (u.balances[currency] ?? 0) + Math.round(amount);
      results.push({ userId: id, ok: true });
    }
    return results;
  },
  async bulkRemove(userIds, { cosmeticId = null, currency = null, amount = 0 }) {
    const results = [];
    for (const id of userIds) {
      const u = users.get(id);
      if (!u) { results.push({ userId: id, ok: false, error: "not found" }); continue; }
      if (cosmeticId) u.cosmetics.delete(cosmeticId);
      if (currency && amount) u.balances[currency] = Math.max(0, (u.balances[currency] ?? 0) - Math.round(amount));
      results.push({ userId: id, ok: true });
    }
    return results;
  },
  // For "gift everyone" style ops.
  async allUserIds() { return [...users.keys()]; },

  // ===================== EVENTS =====================
  async createEvent({ name, type = "generic", mode = null, startsAt, endsAt, config: cfg = {}, reward = {} }) {
    const id = "ev_" + (nextId++);
    const ev = {
      id, name: name || id, type, mode,
      startsAt: startsAt || new Date().toISOString(),
      endsAt: endsAt || null,            // null = open-ended until disabled
      config: cfg || {},
      reward: normalizeReward(reward),
      enabled: true,
      createdAt: new Date().toISOString(),
    };
    events.set(id, ev);
    return ev;
  },
  async updateEvent(id, patch) {
    const ev = events.get(id);
    if (!ev) throw new Error("event not found");
    if (patch.reward) patch.reward = normalizeReward(patch.reward);
    Object.assign(ev, patch);
    return ev;
  },
  async getEvent(id) { return events.get(id) || null; },
  async listEvents() { return [...events.values()]; },
  async deleteEvent(id) { return events.delete(id); },

  // Events active right now (enabled + within window).
  async activeEvents() {
    const now = Date.now();
    return [...events.values()].filter((ev) => {
      if (!ev.enabled) return false;
      if (ev.startsAt && new Date(ev.startsAt).getTime() > now) return false;
      if (ev.endsAt && new Date(ev.endsAt).getTime() < now) return false;
      return true;
    });
  },

  // ----- per-account event flags -----
  async setEventFlag(eventId, userId, flag, meta = {}) {
    if (!events.has(eventId)) throw new Error("event not found");
    if (!EVENT_FLAGS[flag]) throw new Error("unknown event flag");
    if (!users.has(userId)) throw new Error("user not found");
    eventFlags.set(`${eventId}:${userId}`, { eventId, userId, flag, meta });
    return { eventId, userId, flag };
  },
  async clearEventFlag(eventId, userId) {
    return eventFlags.delete(`${eventId}:${userId}`);
  },
  async getEventFlags(userId) {
    // Only flags for currently-active events matter at match time.
    const active = new Set((await this.activeEvents()).map((e) => e.id));
    const out = [];
    for (const f of eventFlags.values()) if (f.userId === userId && active.has(f.eventId)) out.push(f);
    return out;
  },
  async listEventFlags(eventId) {
    return [...eventFlags.values()].filter((f) => f.eventId === eventId);
  },

  // ----- bounty claims -----
  // Claim a bounty: single claim per (event, target). Grants the event reward to
  // the claimer. Returns the granted reward or null if already claimed/ineligible.
  async claimBounty(eventId, targetId, byUserId) {
    const ev = events.get(eventId);
    if (!ev) return { ok: false, reason: "no_event" };
    const flag = eventFlags.get(`${eventId}:${targetId}`);
    if (!flag || flag.flag !== "BOUNTY_TARGET") return { ok: false, reason: "not_a_target" };
    const key = `${eventId}:${targetId}`;
    if (bountyClaims.has(key)) return { ok: false, reason: "already_claimed" };
    bountyClaims.set(key, { byUserId, at: new Date().toISOString() });

    const r = ev.reward;
    const granted = {};
    if (r.currency && r.amount) granted.balance = await this.adjustBalance(byUserId, r.currency, r.amount, `bounty:${eventId}`);
    if (r.cosmeticId && COSMETICS[r.cosmeticId]) { await this.grantCosmetic(byUserId, r.cosmeticId); granted.cosmeticId = r.cosmeticId; }
    return { ok: true, reward: r, granted };
  },
};
