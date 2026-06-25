// Room manager: one GameEngine per room, plus the socket<->player mapping and
// matchmaking. Pure bookkeeping + lobby logic — all game truth lives in the engine.

import { GameEngine } from "../engine/GameEngine.js";
import { PHASE } from "../engine/constants.js";

// Code alphabet excludes easily-confused chars (0/O, 1/I/L) for spoken codes.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LEN = 5;

export class Room {
  constructor(id, config) {
    this.id = id;
    this.config = config;                       // kept so a rematch reuses host config
    this.engine = new GameEngine({ config });   // host config drives the match
    this.isPublic = !!config.isPublic;
    this.sockets = new Map(); // socketId -> playerId
    this.players = new Map(); // playerId -> socketId
    this.joinInfo = new Map(); // socketId -> { name, account } (for rematch rebuild)
    this.botState = new Map();  // botPlayerId -> per-bot scratch (cadence, draft vote)
    this.bots = [];             // [{ name, tier }] so rematch can re-add them
    this.hostSocketId = null;
    this.ticker = null;
  }

  attach(socketId, playerId, info) {
    this.sockets.set(socketId, playerId);
    this.players.set(playerId, socketId);
    if (info) this.joinInfo.set(socketId, info);
    if (!this.hostSocketId) this.hostSocketId = socketId;
  }
  detach(socketId) {
    const playerId = this.sockets.get(socketId);
    this.sockets.delete(socketId);
    this.joinInfo.delete(socketId);
    if (playerId) this.players.delete(playerId);
    // If the host left, hand the role to whoever's next (keeps the lobby alive).
    if (socketId === this.hostSocketId) this.hostSocketId = this.sockets.keys().next().value || null;
    return playerId;
  }

  // Rematch: spin up a fresh engine and re-seat everyone currently attached,
  // preserving their account/name. Returns to the lobby phase so the host can
  // start a new draft. Keeps the same room code, host, and config.
  rematch() {
    if (this.ticker) { clearInterval(this.ticker); this.ticker = null; }
    this.engine = new GameEngine({ config: this.config });
    const remap = new Map(); // old socketId -> new playerId
    for (const [socketId, info] of this.joinInfo) {
      const pid = this.engine.addPlayer(info.name, info.account);
      remap.set(socketId, pid);
    }
    this.sockets = new Map(); this.players = new Map();
    for (const [socketId, pid] of remap) { this.sockets.set(socketId, pid); this.players.set(pid, socketId); }
    // re-seat the bots too (fresh scratch state)
    this.botState = new Map();
    for (const b of this.bots) {
      this.engine.addPlayer(b.name, { isBot: true, botTier: b.tier });
    }
    // host stays whoever it was if still present, else first seat
    if (!this.sockets.has(this.hostSocketId)) this.hostSocketId = this.sockets.keys().next().value || null;
  }

  // Add a bot of the given tier (host action, lobby only). Tracked so rematch
  // can re-seat it. Returns the new bot's playerId.
  addBot(tier = "pilot") {
    const n = this.bots.length + 1;
    const name = `${tierName(tier)} Bot ${n}`;
    const id = this.engine.addPlayer(name, { isBot: true, botTier: tier });
    this.bots.push({ name, tier });
    return id;
  }
  removeBot(playerId) {
    const p = this.engine.players.get(playerId);
    if (!p || !p.isBot) return false;
    this.engine.players.delete(playerId);
    this.bots = this.bots.filter((b) => b.name !== p.name);
    this.botState.delete(playerId);
    return true;
  }
  playerIdOf(socketId) { return this.sockets.get(socketId); }
  isEmpty() { return this.sockets.size === 0; }

  // Joinable by Join Random: public, still in the lobby, and below the map cap.
  isOpenForRandom() {
    return this.isPublic
      && this.engine.phase === PHASE.LOBBY
      && this.engine.players.size < this.engine.map.maxPlayers;
  }
  // Has the minimum players the map needs to start?
  canStart() {
    return this.engine.players.size >= this.engine.map.minPlayers;
  }
}

export class RoomManager {
  constructor() { this.rooms = new Map(); }

  _newCode() {
    let code;
    do {
      code = Array.from({ length: CODE_LEN }, () =>
        CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join("");
    } while (this.rooms.has(code));
    return code;
  }

  // Create a room from a host config object (merged over defaults in the engine).
  create(config = {}) {
    const id = this._newCode();
    const room = new Room(id, config);
    this.rooms.set(id, room);
    return room;
  }

  get(id) { return this.rooms.get(id ? String(id).toUpperCase() : "") || null; }

  // Join Random: prefer an open public lobby; if none exist, spin up a fresh
  // public one with default config so the player isn't dropped into someone's
  // extreme custom settings.
  findOrCreateRandom(preferredMapId) {
    for (const room of this.rooms.values()) {
      if (room.isOpenForRandom() && (!preferredMapId || room.engine.map.id === preferredMapId)) return room;
    }
    return this.create({ isPublic: true, mapId: preferredMapId || "nebula_drift" });
  }

  destroy(id) {
    const r = this.rooms.get(id);
    if (r?.ticker) clearInterval(r.ticker);
    this.rooms.delete(id);
  }
}

// Display name for a bot tier (used in the auto-generated bot name).
function tierName(tier) {
  return { recruit: "Recruit", pilot: "Pilot", ace: "Ace" }[tier] || "Pilot";
}
