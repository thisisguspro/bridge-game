// ============================================================
// Network layer (Socket.IO). It does ONE job: receive player inputs,
// call the matching authoritative engine method, then push each player
// their OWN redacted view. It never computes game outcomes itself.
//
// Every action is wrapped so an engine validation error becomes a clean
// error back to just that socket — the server never trusts the client.
// ============================================================

import http from "http";
import { Server } from "socket.io";
import { RoomManager } from "./RoomManager.js";
import { PHASE } from "../engine/constants.js";
import { botStep, newBotState, BOT_TIERS } from "../engine/bots.js";
import { getMode } from "../engine/modes/index.js";
import { config } from "./config.js";
import { verifySession, fetchMatchProfile, reportMatchResult, reportBountyClaim, fetchActiveEvents } from "./backendClient.js";

const PORT = process.env.PORT || 5000;

// When run directly, the game server owns its own HTTP server (with a /health
// route). When embedded in the combined deploy server, attachGameServer(server)
// is called with the shared HTTP server instead, so Socket.IO rides the same port.
let server;
let io;

function setupIo(httpServer) {
  io = new Server(httpServer, { cors: { origin: "*" } });
  wireConnections();
}
const rooms = new RoomManager();

// Push every player in a room their personalized, redacted state + events.
function broadcast(room) {
  const hostId = room.sockets.get(room.hostSocketId) || null; // playerId of the host
  for (const [socketId, playerId] of room.sockets) {
    const sock = io.sockets.sockets.get(socketId);
    if (!sock) continue;
    sock.emit("state", {
      roomId: room.id,
      hostId,
      view: room.engine.viewFor(playerId),
      events: room.engine.eventsFor(playerId),
    });
  }
}

// Authoritative clock. Runs at 10 Hz so continuous movement looks real-time;
// every game system is dt-scaled, so dt=0.1 keeps per-second tuning identical to
// the old 1 Hz loop. We broadcast every tick (10/sec) during active play.
const TICK_HZ = 10;
const TICK_DT = 1 / TICK_HZ;
function ensureTicker(room) {
  if (room.ticker) return;
  room.ticker = setInterval(() => {
    const before = room.engine.phase;
    room.engine.tick(TICK_DT);
    const ph = room.engine.phase;
    // Drive any bot players. Each bot acts at its tier's cadence (tracked in
    // room.botState) so higher tiers react more often. Bots auto-vote draft perks
    // and play out the match; errors are swallowed (a bot mis-stepping shouldn't
    // crash the room).
    if (ph === PHASE.ACTIVE) driveBots(room);
    else if (ph === PHASE.DRAFT) driveBotDraft(room);
    if (ph === PHASE.ACTIVE || ph === PHASE.DRAFT || ph !== before) broadcast(room);
    if (ph === PHASE.ENDED) {
      clearInterval(room.ticker); room.ticker = null; broadcast(room);
      const result = room.engine.matchResult();
      if (result.participants.length > 0) {
        reportMatchResult({ matchId: room.id, winner: result.winner, participants: result.participants });
      }
    }
  }, 1000 / TICK_HZ);
}

// Step each bot at its tier cadence.
function driveBots(room) {
  const e = room.engine;
  for (const p of e.players.values()) {
    if (!p.isBot) continue;
    const tier = p.botTier || "pilot";
    const st = room.botState.get(p.id) || newBotState();
    room.botState.set(p.id, st);
    const every = (BOT_TIERS[tier] || BOT_TIERS.pilot).actEverySec;
    if (e.now >= st.nextActAt) {
      st.nextActAt = e.now + every;
      try { botStep(e, p, tier, st); } catch {}
    }
  }
}
// Bots vote a random valid perk set once per draft so the draft can resolve.
function driveBotDraft(room) {
  const e = room.engine;
  for (const p of e.players.values()) {
    if (!p.isBot) continue;
    const st = room.botState.get(p.id) || newBotState();
    room.botState.set(p.id, st);
    if (st.draftVoted) continue;
    st.draftVoted = true;
    try {
      const cands = (e.viewFor(p.id).draft?.candidates || []).map((c) => c.key);
      if (cands.length) e.voteDraftPerk(p.id, cands.slice(0, 2));
    } catch {}
  }
}

function wireConnections() {
io.on("connection", (socket) => {
  // helper: run an engine action with the caller's playerId, guard errors, rebroadcast
  function act(roomId, fn) {
    const room = rooms.get(roomId);
    if (!room) return socket.emit("error_msg", "Room not found.");
    const playerId = room.playerIdOf(socket.id);
    if (!playerId) return socket.emit("error_msg", "You're not in this room.");
    try { fn(room, playerId); broadcast(room); }
    catch (e) { socket.emit("error_msg", e.message); }
  }

  // Resolve a joining socket's account from its session token. Returns an
  // account object for addPlayer, or null for a guest (if guests are allowed).
  async function resolveAccount(token, fallbackName) {
    const session = verifySession(token);
    if (!session) {
      if (!config.allowGuests) return { error: "Sign in to play." };
      return { account: null, name: fallbackName || "Guest" };
    }
    const profile = await fetchMatchProfile(session.userId);
    // Even if the backend is unreachable, we still know who they are from the token.
    return {
      account: profile
        ? { userId: session.userId, loadout: profile.loadout, unlockedPerks: profile.unlockedPerks, eventFlags: profile.eventFlags || [], silenced: profile.silenced, banned: profile.banned }
        : { userId: session.userId, loadout: {}, unlockedPerks: [], eventFlags: [] },
      name: (profile && profile.name) || session.name || fallbackName || "Crew",
      banned: profile ? profile.banned : false,
    };
  }

  socket.on("create_room", async ({ config, name, token } = {}, cb) => {
    const r = await resolveAccount(token, name || "Host");
    if (r.error) return cb?.({ error: r.error });
    let room;
    try { room = rooms.create(config || {}); }
    catch (e) { return cb?.({ error: e.message }); } // e.g. unknown mapId
    const playerId = room.engine.addPlayer(r.name, r.account);
    room.attach(socket.id, playerId, { name: r.name, account: r.account });
    socket.join(room.id);
    cb?.({ roomId: room.id, playerId, code: room.id, isPublic: room.isPublic });
    broadcast(room);
  });

  // Join Random: drop into an open public lobby, or spin up a fresh one.
  socket.on("join_random", async ({ name, token, mapId } = {}, cb) => {
    const r = await resolveAccount(token, name || "Crew");
    if (r.error) return cb?.({ error: r.error });
    const room = rooms.findOrCreateRandom(mapId);
    try {
      const playerId = room.engine.addPlayer(r.name, r.account);
      room.attach(socket.id, playerId, { name: r.name, account: r.account });
      socket.join(room.id);
      cb?.({ roomId: room.id, playerId, code: room.id });
      broadcast(room);
    } catch (e) { cb?.({ error: e.message }); }
  });

  // Host tweaks match config while still in the lobby (before draft/start).
  socket.on("update_config", async ({ roomId, config } = {}) => {
    const room = rooms.get(roomId);
    if (!room) return socket.emit("error_msg", "Room not found.");
    if (socket.id !== room.hostSocketId) return socket.emit("error_msg", "Only the host can change settings.");
    if (room.engine.phase !== PHASE.LOBBY) return socket.emit("error_msg", "Can't change settings after the match starts.");
    const incoming = { ...(config || {}) };
    // Game modes are selectable ONLY via an event, by an event-host, and only a
    // mode that an active event actually names. Otherwise the mode key is dropped.
    if ("mode" in incoming) {
      const pid = room.playerIdOf(socket.id);
      const isEventHost = room.engine.isEventHost(pid);
      const activeModes = new Set((await fetchActiveEvents()).map((e) => e.mode).filter(Boolean));
      if (!isEventHost || (incoming.mode && !activeModes.has(incoming.mode))) {
        delete incoming.mode; // not allowed / not an active event mode
        socket.emit("error_msg", "Game modes can only be set by an event host during an active event.");
      }
    }
    // Merge freely (no bounds, by design) over the engine's current config.
    Object.assign(room.engine.config, incoming);
    room.engine.mode = getMode(room.engine.config.mode); // re-resolve active mode
    room.isPublic = !!room.engine.config.isPublic;
    broadcast(room);
  });

  socket.on("join_room", async ({ roomId, name, token } = {}, cb) => {
    const room = rooms.get(roomId);
    if (!room) return cb?.({ error: "Room not found." });
    const r = await resolveAccount(token, name || "Crew");
    if (r.error) return cb?.({ error: r.error });
    try {
      const playerId = room.engine.addPlayer(r.name, r.account);
      room.attach(socket.id, playerId, { name: r.name, account: r.account });
      socket.join(room.id);
      cb?.({ roomId: room.id, playerId });
      broadcast(room);
    } catch (e) { cb?.({ error: e.message }); }
  });

  // Host adds a bot (lobby only) of a chosen tier, up to the map cap. Mixed
  // tiers allowed; bots get roles normally (a bot can be the impostor).
  socket.on("add_bot", ({ roomId, tier } = {}) => {
    const room = rooms.get(roomId);
    if (!room) return socket.emit("error_msg", "Room not found.");
    if (socket.id !== room.hostSocketId) return socket.emit("error_msg", "Only the host can add bots.");
    if (room.engine.phase !== PHASE.LOBBY) return socket.emit("error_msg", "Bots can only be added in the lobby.");
    if (room.engine.players.size >= room.engine.map.maxPlayers) return socket.emit("error_msg", "Lobby is full.");
    try { room.addBot(tier || "pilot"); broadcast(room); }
    catch (e) { socket.emit("error_msg", e.message); }
  });
  socket.on("remove_bot", ({ roomId, playerId } = {}) => {
    const room = rooms.get(roomId);
    if (!room) return socket.emit("error_msg", "Room not found.");
    if (socket.id !== room.hostSocketId) return socket.emit("error_msg", "Only the host can remove bots.");
    if (room.engine.phase !== PHASE.LOBBY) return socket.emit("error_msg", "Bots can only be removed in the lobby.");
    if (room.removeBot(playerId)) broadcast(room);
  });

  socket.on("start_draft", ({ roomId } = {}) => {
    const room = rooms.get(roomId);
    if (!room) return socket.emit("error_msg", "Room not found.");
    if (socket.id !== room.hostSocketId) return socket.emit("error_msg", "Only the host can start the draft.");
    const pid = room.playerIdOf(socket.id);
    const force = room.engine.isEventHost(pid); // event hosts may start below the map minimum
    try { room.engine.startDraft({ force }); ensureTicker(room); broadcast(room); }
    catch (e) { socket.emit("error_msg", e.message); }
  });

  socket.on("vote_perk", ({ roomId, perkKeys }) => act(roomId, (r, pid) => r.engine.voteDraftPerk(pid, perkKeys)));

  socket.on("start_match", ({ roomId } = {}) => {
    const room = rooms.get(roomId);
    if (!room) return socket.emit("error_msg", "Room not found.");
    if (socket.id !== room.hostSocketId) return socket.emit("error_msg", "Only the host can start.");
    const pid = room.playerIdOf(socket.id);
    const force = room.engine.isEventHost(pid); // event hosts may start below the map minimum
    try { room.engine.start({ force }); ensureTicker(room); broadcast(room); }
    catch (e) { socket.emit("error_msg", e.message); }
  });

  // Rematch: host re-runs with the same crew. Spins up a fresh engine in the
  // lobby phase so a new draft/match can start; keeps the room code + roster.
  socket.on("rematch", ({ roomId } = {}) => {
    const room = rooms.get(roomId);
    if (!room) return socket.emit("error_msg", "Room not found.");
    if (socket.id !== room.hostSocketId) return socket.emit("error_msg", "Only the host can rematch.");
    if (room.engine.phase !== PHASE.ENDED) return socket.emit("error_msg", "Match still in progress.");
    room.rematch();
    broadcast(room);
  });

  // ---- player actions: thin pass-throughs to the engine ----
  socket.on("move", ({ roomId, room }) => act(roomId, (r, pid) => r.engine.move(pid, room)));
  socket.on("set_destination", ({ roomId, x, y }) => act(roomId, (r, pid) => r.engine.setDestination(pid, x, y)));
  socket.on("allocate", ({ roomId, system, value }) => act(roomId, (r, pid) => r.engine.allocateEnergy(pid, system, value)));
  socket.on("refill", ({ roomId }) => act(roomId, (r, pid) => r.engine.refillOxygen(pid)));
  socket.on("set_system", ({ roomId, system, on }) => act(roomId, (r, pid) => r.engine.setSystem(pid, system, on)));
  socket.on("repair", ({ roomId }) => act(roomId, (r, pid) => r.engine.repairHull(pid)));
  socket.on("start_task", ({ roomId, taskId }) => act(roomId, (r, pid) => r.engine.startTask(pid, taskId)));
  socket.on("surrender", ({ roomId } = {}) => act(roomId, (r, pid) => r.engine.surrender(pid)));
  socket.on("enter_turret", ({ roomId } = {}) => act(roomId, (r, pid) => r.engine.enterTurret(pid)));
  socket.on("leave_turret", ({ roomId } = {}) => act(roomId, (r, pid) => { r.engine.leaveTurret(pid); return {}; }));
  socket.on("shoot_plane", ({ roomId } = {}) => act(roomId, (r, pid) => r.engine.shootPlane(pid)));
  socket.on("go_outside", ({ roomId } = {}) => act(roomId, (r, pid) => r.engine.goOutside(pid)));
  socket.on("come_inside", ({ roomId } = {}) => act(roomId, (r, pid) => r.engine.comeInside(pid)));
  socket.on("lock_airlock", ({ roomId } = {}) => act(roomId, (r, pid) => { r.engine.lockAirlock(pid); return {}; }));
  socket.on("unlock_airlock", ({ roomId } = {}) => act(roomId, (r, pid) => { r.engine.unlockAirlock(pid); return {}; }));
  socket.on("bang_door", ({ roomId } = {}) => act(roomId, (r, pid) => { r.engine.bangOnDoor(pid); return {}; }));
  socket.on("solder_outside", ({ roomId } = {}) => act(roomId, (r, pid) => r.engine.solderOutside(pid)));
  socket.on("set_allocation", ({ roomId, value } = {}) => act(roomId, (r, pid) => r.engine.setAllocation(pid, value)));
  socket.on("complete_task", ({ roomId, taskId }) => act(roomId, (r, pid) => r.engine.completeTask(pid, taskId)));
  socket.on("detach_cable", ({ roomId, targetId }) => {
    act(roomId, (r, pid) => r.engine.detachCable(pid, targetId));
    // Report any bounty claims the engine queued (fire-and-forget; backend pays once).
    const room = rooms.get(roomId);
    if (room) for (const claim of room.engine.drainBountyClaims()) reportBountyClaim(claim);
  });
  socket.on("pass_potato", ({ roomId, targetId }) => act(roomId, (r, pid) => r.engine.passPotato(pid, targetId)));
  socket.on("guess", ({ roomId, suspectId }) => act(roomId, (r, pid) => r.engine.guessWhoDidIt(pid, suspectId)));
  socket.on("sabotage", ({ roomId, kind }) => act(roomId, (r, pid) => r.engine.triggerSabotage(pid, kind)));
  socket.on("resolve_sabotage", ({ roomId, kind }) => act(roomId, (r, pid) => r.engine.resolveSabotage(pid, kind)));
  socket.on("vote", ({ roomId, targetId }) => act(roomId, (r, pid) => r.engine.castVote(pid, targetId ?? null)));
  socket.on("voice_command", ({ roomId, command, targetId }) => act(roomId, (r, pid) => r.engine.sendVoiceCommand(pid, command, targetId ?? null)));
  socket.on("speech", ({ roomId, text }) => act(roomId, (r, pid) => r.engine.sendSpeech(pid, text ?? null)));
  socket.on("emote", ({ roomId, emote }) => act(roomId, (r, pid) => r.engine.sendEmote(pid, emote)));

  socket.on("disconnect", () => {
    for (const room of rooms.rooms.values()) {
      if (room.sockets.has(socket.id)) {
        const playerId = room.detach(socket.id);
        if (playerId) { try { room.engine.removePlayer(playerId); } catch {} }
        if (room.isEmpty()) rooms.destroy(room.id);
        else broadcast(room);
      }
    }
  });
});
} // end wireConnections

// Attach the game server (Socket.IO) to an existing HTTP server — used by the
// combined deploy server so the game shares one port with the backend + client.
export function attachGameServer(httpServer) {
  setupIo(httpServer);
  return io;
}

// Run standalone only when this file is the entry point.
import { fileURLToPath } from "url";
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  server = http.createServer((req, res) => {
    if (req.url === "/health") { res.writeHead(200); return res.end("ok"); }
    res.writeHead(404); res.end();
  });
  setupIo(server);
  server.listen(PORT, () => console.log(`BRIDGE game server (Socket.IO) on :${PORT}`));
}
