// Lobby + matchmaking socket test (game server only; guests allowed).
import { io } from "socket.io-client";
const GS = "http://localhost:5000";
const mk = () => io(GS, { transports: ["websocket"], forceNew: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const assert = (c, m) => c ? pass++ : (fail++, console.log("  ✗", m));

(async () => {
  const sockets = [];
  const emit = (s, ev, body) => new Promise((res) => s.emit(ev, body, res));

  // Host creates a PRIVATE lobby with custom config (move speed + big heads).
  const host = mk(); sockets.push(host);
  const created = await emit(host, "create_room", { name: "Host",
    config: { isPublic: false, mapId: "nebula_drift", moveSpeedMult: 1.2, headSizeMult: 2.0 } });
  assert(created.code && created.code.length === 5, "host gets a 5-char join code");
  assert(created.isPublic === false, "lobby is private as configured");

  // A friend joins by code.
  const friend = mk(); sockets.push(friend);
  const fj = await emit(friend, "join_room", { roomId: created.code, name: "Friend" });
  assert(!fj.error && fj.roomId === created.code, "friend joins by code");

  // Join Random with no open public lobby => spins up a fresh public one.
  const rando1 = mk(); sockets.push(rando1);
  const r1 = await emit(rando1, "join_random", { name: "Rando1" });
  assert(!r1.error && r1.code && r1.code !== created.code, "join_random created a new public lobby (private one not used)");

  // A second Join Random lands in that SAME public lobby (it's open + waiting).
  const rando2 = mk(); sockets.push(rando2);
  const r2 = await emit(rando2, "join_random", { name: "Rando2" });
  assert(r2.code === r1.code, "second join_random reuses the open public lobby");

  // Host can update config while in lobby; non-host cannot.
  let hostState = null, friendErr = null;
  host.on("state", (s) => { hostState = s.view; });
  friend.on("error_msg", (m) => { friendErr = m; });
  host.emit("update_config", { roomId: created.code, config: { attackDamageMult: 3 } });
  friend.emit("update_config", { roomId: created.code, config: { attackDamageMult: 0 } });
  await wait(300);
  assert(hostState && hostState.config.attackDamageMult === 3, "host config update applied");
  assert(friendErr && /host/i.test(friendErr), "non-host blocked from changing config");

  console.log(`\nPASS ${pass}  FAIL ${fail}`);
  sockets.forEach((s) => s.close());
  process.exit(fail ? 1 : 0);
})();
