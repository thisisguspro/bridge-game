// Integration test: backend (4000) + game server (5000) wired together.
// Verifies: token-authed join pulls the real loadout & unlocked perks, the draft
// pools those perks, and finishing a match awards XP on the backend.
import { io } from "socket.io-client";

const BE = "http://localhost:4000";
const GS = "http://localhost:5000";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const assert = (c, m) => c ? pass++ : (fail++, console.log("  ✗", m));

async function signIn(name) {
  const res = await fetch(`${BE}/auth/google`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mockGoogleId: "g-" + name }),
  });
  const d = await res.json();
  return d.token;
}
async function getXp(token) {
  const r = await fetch(`${BE}/profile`, { headers: { Authorization: `Bearer ${token}` } });
  const d = await r.json();
  return { xp: d.xp, level: d.level };
}
async function addXpTo(token, amount) {
  await fetch(`${BE}/profile/xp`, { method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ amount }) });
}

(async () => {
  // Make 6 accounts; push them to level 8 so they have unlocked perks to pool.
  const tokens = [];
  for (let i = 0; i < 6; i++) { const t = await signIn("Pilot" + i); await addXpTo(t, 4500); tokens.push(t); }
  const before = await getXp(tokens[0]);
  assert(before.level >= 8, "account leveled up via XP (has unlocked perks)");

  // Host creates a room WITH a token; others join WITH tokens.
  const sockets = [], me = [];
  function connect(i) {
    const s = io(GS, { transports: ["websocket"], forceNew: true });
    s.on("state", (st) => { me[i] = st.view; });
    sockets.push(s);
    return s;
  }
  const host = connect(0);
  const created = await new Promise((res) => host.emit("create_room", { config: { mapId: "nebula_drift" }, name: "Pilot0", token: tokens[0] }, res));
  const roomId = created.roomId;
  assert(!!roomId, "room created by authed host");

  for (let i = 1; i < 6; i++) {
    const s = connect(i);
    const j = await new Promise((res) => s.emit("join_room", { roomId, name: "Pilot" + i, token: tokens[i] }, res));
    assert(!j.error, "authed player " + i + " joined");
  }
  await wait(400);

  // Each player should carry a unique ID color (identity) in the view.
  const colors = me[0].players.map((p) => p.idColor?.name);
  assert(new Set(colors).size === colors.length, "every player has a unique ID color");

  // Start the draft; candidates should come from the pooled unlocked perks.
  host.emit("start_draft", { roomId });
  await wait(500);
  assert(me[0].phase === "draft", "draft started");
  assert(me[0].draft && me[0].draft.candidates.length > 0, "draft offers pooled perks");

  // Everyone votes the same 3 perks -> match begins.
  const top3 = me[0].draft.candidates.slice(0, 3).map((c) => c.key);
  for (let i = 0; i < 6; i++) sockets[i].emit("vote_perk", { roomId, perkKeys: top3 });
  await wait(600);
  assert(me[0].phase === "active", "match active after draft");
  assert(me[0].activePerks.length === 3, "3 perks active in-match");

  // Force a crew win quickly: everyone votes the same target until majority downs them,
  // repeating won't help; instead drive the impostor out by continuous vote.
  // Find who *I* (each client) can't see role of — instead, just end via vote on one target.
  // Simplest: have all vote player index 1, then 2, etc., but we don't know the impostor.
  // We'll instead just let the host trigger votes to reach a terminal state through ticks.
  // Easiest deterministic end: everyone votes the same person repeatedly across rounds.
  // For the integration check, we verify XP is awarded on ANY terminal state, so we
  // force one by voting out players until parity/all-impostors-down resolves.
  let guard = 0;
  while (me[0].phase === "active" && guard++ < 6) {
    // vote the lowest-index still-physical player that isn't yourself
    for (let i = 0; i < 6; i++) {
      const target = me[i]?.players.find((p) => p.plane === "physical" && p.id !== me[i].you.id);
      if (target) sockets[i].emit("vote", { roomId, targetId: target.id });
    }
    await wait(1100);
  }
  assert(me[0].phase === "ended", "match reached a terminal state");
  await wait(600); // allow result report + XP award to land

  const after = await getXp(tokens[0]);
  assert(after.xp > before.xp, `XP awarded after match (was ${before.xp}, now ${after.xp})`);

  console.log(`\nPASS ${pass}  FAIL ${fail}`);
  sockets.forEach((s) => s.close());
  process.exit(fail ? 1 : 0);
})();
