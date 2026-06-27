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
import { getMode } from "../engine/modes/index.js";
import { config } from "./config.js";
import { verifySession, fetchMatchProfile, reportMatchResult, reportBountyClaim, fetchActiveEvents } from "./backendClient.js";

const PORT = process.env.PORT || 5000;
const server = http.createServer((req, res) => {
  if (req.url === "/health") { res.writeHead(200); return res.end("ok"); }
  res.writeHead(404); res.end();
});
const io = new Server(server, { cors: { origin: "*" } });
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

// Start the 1s authoritative clock once a match enters draft or active play.
function ensureTicker(room) {
  if (room.ticker) return;
  room.ticker = setInterval(() => {
    const before = room.engine.phase;
    room.engine.tick(1);
    const ph = room.engine.phase;
    // Broadcast every tick during draft/active, and on any phase transition.
    if (ph === PHASE.ACTIVE || ph === PHASE.DRAFT || ph !== before) broadcast(room);
    if (ph === PHASE.ENDED) {
      clearInterval(room.ticker); room.ticker = null; broadcast(room);
      // Report to the backend so it can award XP (server-to-server).
      const result = room.engine.matchResult();
      if (result.participants.length > 0) {
        reportMatchResult({ matchId: room.id, winner: result.winner, participants: result.participants });
      }
    }
  }, 1000);
}

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
    room.attach(socket.id, playerId);
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
      room.attach(socket.id, playerId);
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
      room.attach(socket.id, playerId);
      socket.join(room.id);
      cb?.({ roomId: room.id, playerId });
      broadcast(room);
    } catch (e) { cb?.({ error: e.message }); }
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

  // ---- player actions: thin pass-throughs to the engine ----
  socket.on("move", ({ roomId, room }) => act(roomId, (r, pid) => r.engine.move(pid, room)));
  socket.on("allocate", ({ roomId, system, value }) => act(roomId, (r, pid) => r.engine.allocateEnergy(pid, system, value)));
  socket.on("refill", ({ roomId }) => act(roomId, (r, pid) => r.engine.refillOxygen(pid)));
  socket.on("set_system", ({ roomId, system, on }) => act(roomId, (r, pid) => r.engine.setSystem(pid, system, on)));
  socket.on("repair", ({ roomId }) => act(roomId, (r, pid) => r.engine.repairHull(pid)));
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

  // ---- new: spacewalk / turret / helm / task pass-throughs ----
  socket.on("set_destination", ({ roomId, x, y }) => act(roomId, (r, pid) => r.engine.setDestination(pid, x, y)));
  socket.on("set_engine_level", ({ roomId, level }) => act(roomId, (r, pid) => r.engine.setEngineLevel(pid, level)));
  socket.on("start_task", ({ roomId, taskId }) => act(roomId, (r, pid) => r.engine.startTask(pid, taskId)));
  socket.on("bang_door", ({ roomId }) => act(roomId, (r, pid) => r.engine.bangDoor(pid)));
  socket.on("open_airlock", ({ roomId }) => act(roomId, (r, pid) => r.engine.openAirlock(pid)));
  socket.on("shoot_turret", ({ roomId }) => act(roomId, (r, pid) => r.engine.shootTurretShip(pid)));

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

server.listen(PORT, () => console.log(`BRIDGE game server (Socket.IO) on :${PORT}`));
