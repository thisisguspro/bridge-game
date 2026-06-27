// Real Socket.IO client for the BRIDGE game server (:5000). Wraps the actual
// match protocol: create/join rooms, lobby config, and the in-match actions.
// The server streams redacted per-player state via the "state" event — this
// client just relays that to React via an onState callback.

import { io } from "socket.io-client";
import { GAME_URL, TOKEN_KEY, tokenStore } from "./config.js";

export function createGameConnection({ onState, onEvents, onError, onConnect, onDisconnect }) {
  const socket = io(GAME_URL, { transports: ["websocket"], forceNew: true });
  socket.on("connect", () => onConnect && onConnect(socket.id));
  socket.on("disconnect", () => onDisconnect && onDisconnect());
  socket.on("state", (msg) => {
    // Server sends { roomId, hostId, view, events }. Fold hostId into the view
    // so screens can read view.hostId directly, and surface events separately.
    const v = msg.view ?? msg;
    if (msg.hostId && v && typeof v === "object") v.hostId = msg.hostId;
    onState && onState(v);
    if (msg.events && onEvents) onEvents(msg.events);
  });
  socket.on("error_msg", (m) => onError && onError(m));

  const token = () => tokenStore.getItem(TOKEN_KEY);
  const cb = (resolve) => (res) => resolve(res || {});

  return {
    socket,
    // lobby
    createRoom: (config = {}, name) => new Promise((r) => socket.emit("create_room", { config, name, token: token() }, cb(r))),
    joinRoom: (roomId, name) => new Promise((r) => socket.emit("join_room", { roomId, name, token: token() }, cb(r))),
    joinRandom: (name, mapId) => new Promise((r) => socket.emit("join_random", { name, mapId, token: token() }, cb(r))),
    updateConfig: (roomId, config) => socket.emit("update_config", { roomId, config }),
    startDraft: (roomId) => socket.emit("start_draft", { roomId }),
    addBot: (roomId, tier) => socket.emit("add_bot", { roomId, tier }),
    removeBot: (roomId, playerId) => socket.emit("remove_bot", { roomId, playerId }),
    startMatch: (roomId) => socket.emit("start_match", { roomId }),
    rematch: (roomId) => socket.emit("rematch", { roomId }),
    // in-match actions
    move: (roomId, room) => socket.emit("move", { roomId, room }),
    setDestination: (roomId, x, y) => socket.emit("set_destination", { roomId, x, y }),
    setRunning: (roomId, running) => socket.emit("set_running", { roomId, running }),
    doTask: (roomId, taskId) => socket.emit("complete_task", { roomId, taskId }),
    startTask: (roomId, taskId) => socket.emit("start_task", { roomId, taskId }),
    completeTask: (roomId, taskId) => socket.emit("complete_task", { roomId, taskId }),
    refill: (roomId) => socket.emit("refill", { roomId }),
    repair: (roomId) => socket.emit("repair", { roomId }),
    airlockDoor: (roomId, open) => socket.emit("airlock_door", { roomId, open }),
    setEngineLevel: (roomId, level) => socket.emit("set_engine_level", { roomId, level }),
    allocate: (roomId, system, value) => socket.emit("allocate", { roomId, system, value }),
    detachCable: (roomId, targetId) => socket.emit("detach_cable", { roomId, targetId }),
    sabotage: (roomId, kind) => socket.emit("sabotage", { roomId, kind }),
    resolveSabotage: (roomId, kind) => socket.emit("resolve_sabotage", { roomId, kind }),
    vote: (roomId, targetId) => socket.emit("vote", { roomId, targetId }),
    voiceCommand: (roomId, command, targetId) => socket.emit("voice_command", { roomId, command, targetId }),
    perkVote: (roomId, perkKeys) => socket.emit("vote_perk", { roomId, perkKeys }),
    bangDoor: (roomId) => socket.emit("bang_door", { roomId }),
    openAirlock: (roomId) => socket.emit("open_airlock", { roomId }),
    shootTurret: (roomId) => socket.emit("shoot_turret", { roomId }),
    disconnect: () => socket.close(),
  };
}
