import { io } from "socket.io-client";

const URL = "http://localhost:5000";
const N = 5;
const sockets = [];
const me = []; // {roomId, playerId, lastView}

function mk() { return io(URL, { transports: ["websocket"], forceNew: true }); }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const assert = (c, m) => c ? pass++ : (fail++, console.log("  ✗", m));

(async () => {
  // host creates room
  const host = mk(); sockets.push(host);
  const created = await new Promise((res) => host.emit("create_room", { config: { mapId: "nebula_drift" }, name: "Host" }, res));
  const roomId = created.roomId;
  me[0] = { ...created };
  host.on("state", (s) => { me[0].lastView = s.view; me[0].lastEvents = s.events; });
  console.log("room:", roomId);

  // others join
  for (let i = 1; i < N; i++) {
    const s = mk(); sockets.push(s);
    const j = await new Promise((res) => s.emit("join_room", { roomId, name: `P${i}` }, res));
    me[i] = { ...j };
    s.on("state", (st) => { me[i].lastView = st.view; me[i].lastEvents = st.events; });
  }
  await wait(300);
  assert(me[0].lastView.players.length === N, "all players present in lobby view");

  // start
  host.emit("start_match", { roomId });
  await wait(400);
  assert(me[0].lastView.phase === "active", "match active after start");

  // each client's OWN view: count how many see a known impostor among others
  let crewSeeingRoles = 0, impostorCount = 0;
  for (let i = 0; i < N; i++) {
    const v = me[i].lastView;
    if (v.you.role === "impostor") impostorCount++;
    const othersKnown = v.players.filter((p) => p.id !== v.you.id && p.role !== "unknown").length;
    if (v.you.role === "crew" && othersKnown > 0) crewSeeingRoles++;
  }
  assert(impostorCount === 1, "exactly 1 impostor on small map (over the wire)");
  assert(crewSeeingRoles === 0, "no crew client receives another player's role");

  // commander allocates energy; non-commander allocation should error
  const cmdIdx = me.findIndex((m) => m.lastView.youAreCommander);
  assert(cmdIdx >= 0, "a commander exists");
  sockets[cmdIdx].emit("allocate", { roomId, system: "engines", value: 70 });
  await wait(200);
  assert(me[cmdIdx].lastView.energy.engines === 70, "commander energy reflected to all clients");

  const nonCmd = sockets[(cmdIdx + 1) % N];
  let gotErr = false;
  nonCmd.once("error_msg", () => { gotErr = true; });
  nonCmd.emit("allocate", { roomId, system: "shields", value: 50 });
  await wait(200);
  assert(gotErr, "non-commander allocation rejected over the wire");

  console.log(`\nPASS ${pass}  FAIL ${fail}`);
  sockets.forEach((s) => s.close());
  process.exit(fail ? 1 : 0);
})();
