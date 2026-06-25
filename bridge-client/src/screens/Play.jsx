import { useEffect, useRef, useState, useCallback } from "react";
import { createGameConnection } from "../api/game.js";
import { SpeedLines, useImpact, KanjiFlash } from "../components/effects.jsx";
import MiniMap from "../components/MiniMap.jsx";
import IsoStage from "../components/IsoStage.jsx";
import VotePanel from "../components/VotePanel.jsx";
import { useComms, CommsRadial, CaptionStream } from "../components/Comms.jsx";
import { SabotageMenu, SabotageAlerts } from "../components/Sabotage.jsx";
import MiniGame from "../components/MiniGame.jsx";
import { useControls, ControlHints, TipBubble } from "../components/Controls.jsx";

// Play: connects to the game server, hosts the lobby, then renders the live
// match driven by the server's per-player "state" stream. Classic mode focus —
// no event/mode pickers here. Real Socket.IO throughout.
export default function Play({ user, profile }) {
  const [conn, setConn] = useState(null);
  const [connected, setConnected] = useState(false);
  const [view, setView] = useState(null);     // redacted match view from server
  const [roomId, setRoomId] = useState(null);
  const [error, setError] = useState(null);
  const [joinCode, setJoinCode] = useState("");
  const [flash, setFlash] = useState(null);
  const [liveEvents, setLiveEvents] = useState([]);
  const prevPhase = useRef(null);
  const seenEvents = useRef(new Set());

  // open the socket on mount
  useEffect(() => {
    const c = createGameConnection({
      onState: (v) => setView(v),
      onEvents: (events) => {
        setLiveEvents(events); // latest batch, for the comms/caption layer
        for (const e of events) {
          const key = `${e.type}:${e.id ?? ""}:${e.at ?? e.t ?? ""}`;
          if (seenEvents.current.has(key)) continue;
          if (e.type === "player_eliminated") {
            seenEvents.current.add(key);
            setFlash({ text: "追放", sub: "PILOT EJECTED", color: "var(--hot)" });
          }
        }
        if (seenEvents.current.size > 200) seenEvents.current = new Set();
      },
      onError: (m) => { setError(m); setTimeout(() => setError(null), 2600); },
      onConnect: () => setConnected(true),
      onDisconnect: () => setConnected(false),
    });
    setConn(c);
    return () => c.disconnect();
  }, []);

  // phase-change flourishes
  useEffect(() => {
    if (!view) return;
    const ph = view.phase;
    if (ph !== prevPhase.current) {
      if (ph === "active" && prevPhase.current === "draft") setFlash({ text: "出撃", sub: "MISSION START", color: "var(--hot)" });
      if (ph === "ended") {
        const won = view.winner === "crew" ? "CREW PREVAIL" : "IMPOSTORS WIN";
        setFlash({ text: view.winner === "crew" ? "勝利" : "敗北", sub: won, color: view.winner === "crew" ? "var(--volt)" : "var(--hot)" });
      }
      prevPhase.current = ph;
    }
  }, [view]);

  const create = async () => {
    setError(null);
    const res = await conn.createRoom({ isPublic: false }, user.name);
    if (res.error) return setError(res.error);
    setRoomId(res.roomId);
  };
  const joinByCode = async () => {
    if (!joinCode.trim()) return;
    const res = await conn.joinRoom(joinCode.trim().toUpperCase(), user.name);
    if (res.error) return setError(res.error);
    setRoomId(res.roomId);
  };
  const joinRandom = async () => {
    const res = await conn.joinRandom(user.name);
    if (res.error) return setError(res.error);
    setRoomId(res.roomId);
  };

  const inMatch = view && (view.phase === "active" || view.phase === "draft" || view.phase === "ended");

  return (
    <div style={wrap}>
      <SpeedLines hot={inMatch} />
      {flash && <KanjiFlash {...flash} onDone={() => setFlash(null)} />}
      {error && <div style={toast}>{error}</div>}

      <div style={{ position: "relative", zIndex: 2, height: "100%" }}>
        {!roomId && <LobbyEntry connected={connected} joinCode={joinCode} setJoinCode={setJoinCode}
          onCreate={create} onJoinCode={joinByCode} onRandom={joinRandom} />}
        {roomId && !inMatch && <LobbyRoom view={view} roomId={roomId} conn={conn} isHost={view?.you?.id === view?.hostId} />}
        {roomId && view?.phase === "draft" && <Draft view={view} roomId={roomId} conn={conn} />}
        {roomId && view?.phase === "active" && <Match view={view} roomId={roomId} conn={conn} events={liveEvents} />}
        {roomId && view?.phase === "ended" && <Results view={view} roomId={roomId} conn={conn} profile={profile}
          onLeave={() => { setRoomId(null); setView(null); }} />}
      </div>
    </div>
  );
}

/* ---------------- lobby entry ---------------- */
function LobbyEntry({ connected, joinCode, setJoinCode, onCreate, onJoinCode, onRandom }) {
  return (
    <div style={{ height: "100%", display: "grid", placeItems: "center", padding: 24 }}>
      <div style={{ textAlign: "center", maxWidth: 720 }}>
        <div className="kanji" style={{ fontSize: 20, color: "var(--hot)", letterSpacing: "0.4em" }}>出撃準備</div>
        <h1 className="display" style={{ fontSize: "clamp(60px,10vw,120px)", margin: "4px 0 6px", color: "var(--paper)" }}>DEPLOY</h1>
        <div className="impactf dim" style={{ letterSpacing: "0.2em", marginBottom: 4 }}>
          {connected ? "FLEET LINK ESTABLISHED" : "CONNECTING TO FLEET…"}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 30 }}>
          <button className="panel" style={bigChoice} onClick={onCreate} disabled={!connected}>
            <div className="kanji" style={{ fontSize: 40, color: "var(--hot)" }}>主</div>
            <div className="display" style={{ fontSize: 34 }}>Host Match</div>
            <div className="dim" style={{ fontSize: 13 }}>Create a room & get a join code</div>
          </button>
          <button className="panel" style={bigChoice} onClick={onRandom} disabled={!connected}>
            <div className="kanji" style={{ fontSize: 40, color: "var(--volt)" }}>乱</div>
            <div className="display" style={{ fontSize: 34 }}>Join Random</div>
            <div className="dim" style={{ fontSize: 13 }}>Drop into an open public lobby</div>
          </button>
        </div>
        <div className="panel" style={{ marginTop: 16, padding: 18, display: "flex", gap: 10, alignItems: "center" }}>
          <span className="impactf" style={{ fontSize: 13, letterSpacing: "0.1em", color: "var(--dim)" }}>JOIN BY CODE</span>
          <input value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} maxLength={5}
            placeholder="ABCDE" style={codeInput} onKeyDown={(e) => e.key === "Enter" && onJoinCode()} />
          <button className="btn btn-hot" onClick={onJoinCode} disabled={!connected}>Join</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- lobby room ---------------- */
function LobbyRoom({ view, roomId, conn, isHost }) {
  const players = view?.players || [];
  const min = view?.map?.minPlayers || 5;
  const enough = players.length >= min;
  return (
    <div style={{ padding: "32px 40px", height: "100%", display: "grid", gridTemplateColumns: "1fr 340px", gap: 24 }}>
      <div>
        <div className="tag"><span>Briefing room</span></div>
        <div className="row" style={{ alignItems: "baseline", gap: 16, marginTop: 10 }}>
          <span className="display" style={{ fontSize: 30 }}>JOIN CODE</span>
          <span className="display" style={{ fontSize: 64, color: "var(--hot)", letterSpacing: "0.1em" }}>{roomId}</span>
        </div>
        <div className="dim" style={{ marginBottom: 20 }}>Share this code with your squad. {players.length}/{view?.map?.maxPlayers} aboard.</div>

        <div style={crewGrid}>
          {players.map((p) => (
            <div key={p.id} className="panel" style={crewCard}>
              <div style={{ ...crewDot, background: p.idColor?.hex || "var(--dim)" }} />
              <span style={{ fontWeight: 700 }}>{p.name}</span>
              {p.isBot && <span className="tag" style={{ fontSize: 8, opacity: 0.8 }}><span>BOT</span></span>}
              {p.id === view?.hostId && <span className="tag" style={{ marginLeft: "auto", fontSize: 9 }}><span>HOST</span></span>}
              {isHost && p.isBot && (
                <button className="btn btn-ghost" style={{ marginLeft: "auto", fontSize: 10, padding: "3px 8px" }}
                  onClick={() => conn.removeBot(roomId, p.id)}>✕</button>
              )}
            </div>
          ))}
        </div>

        {isHost && players.length < (view?.map?.maxPlayers || 99) && (
          <div style={{ marginTop: 16 }}>
            <div className="impactf faint" style={{ fontSize: 11, letterSpacing: "0.12em", marginBottom: 8 }}>ADD A BOT</div>
            <div className="row gap-s">
              {[["recruit", "Recruit", "易"], ["pilot", "Pilot", "中"], ["ace", "Ace", "難"]].map(([tier, label, kanji]) => (
                <button key={tier} className="btn" style={{ fontSize: 12, padding: "8px 14px", textTransform: "none" }}
                  onClick={() => conn.addBot(roomId, tier)}>
                  <span className="kanji" style={{ marginRight: 6, color: "var(--volt)" }}>{kanji}</span>{label}
                </button>
              ))}
            </div>
            <div className="faint" style={{ fontSize: 11, marginTop: 6 }}>Recruit = passive · Pilot = standard · Ace = aggressive. Bots can be crew or impostor.</div>
          </div>
        )}

        {isHost && (
          <button className="btn btn-hot" style={{ marginTop: 24, fontSize: 20 }} disabled={!enough}
            onClick={() => conn.startDraft(roomId)}>
            {enough ? "Begin Perk Draft →" : `Need ${min - players.length} more pilot${min - players.length === 1 ? "" : "s"}`}
          </button>
        )}
        {!isHost && <div className="impactf dim" style={{ marginTop: 24, letterSpacing: "0.1em" }}>WAITING FOR HOST TO LAUNCH…</div>}
      </div>

      <div className="panel" style={{ padding: 18 }}>
        <MiniMap view={view} compact />
        <div className="faint" style={{ fontSize: 12, marginTop: 12 }}>Map: {view?.map?.id} · scaled to {view?.map?.maxPlayers} pilots</div>
      </div>
    </div>
  );
}

/* ---------------- perk draft ---------------- */
function Draft({ view, roomId, conn }) {
  const cands = view?.draft?.candidates || [];
  const [picks, setPicks] = useState([]);
  const toggle = (k) => setPicks((p) => p.includes(k) ? p.filter((x) => x !== k) : p.length < 3 ? [...p, k] : p);
  const submit = () => conn.perkVote(roomId, picks);
  return (
    <div style={{ padding: "32px 40px", height: "100%", overflowY: "auto" }}>
      <div className="kanji" style={{ fontSize: 18, color: "var(--violet)", letterSpacing: "0.3em" }}>能力選択</div>
      <h1 className="display" style={{ fontSize: 56, margin: "2px 0 4px" }}>PERK DRAFT</h1>
      <div className="dim" style={{ marginBottom: 20 }}>Vote up to 3 — the squad's top picks go live. Drawn from gear your team has unlocked.</div>
      <div style={perkGrid}>
        {cands.map((c) => {
          const k = c.key || c; const on = picks.includes(k);
          return (
            <button key={k} className="panel" style={{ ...perkCard, ...(on ? perkOn : null) }} onClick={() => toggle(k)}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span className="impactf" style={{ fontSize: 14 }}>{(c.label || c.name || k).toString().replace(/_/g, " ")}</span>
                {on && <span style={{ color: "var(--hot)", fontWeight: 800 }}>✓</span>}
              </div>
              {c.desc && <div className="dim" style={{ fontSize: 12, marginTop: 6 }}>{c.desc}</div>}
              {c.side && <div style={{ fontSize: 10, marginTop: 8, color: c.side === "impostor" ? "var(--violet)" : "var(--volt)", fontWeight: 700, letterSpacing: "0.08em" }}>{c.side.toUpperCase()}</div>}
            </button>
          );
        })}
      </div>
      <button className="btn btn-hot" style={{ marginTop: 22, fontSize: 18 }} onClick={submit}>Lock In Votes ({picks.length}/3)</button>
    </div>
  );
}

/* ---------------- live match ---------------- */
function Match({ view, roomId, conn, events }) {
  const { pop, layer } = useImpact();
  const [voteOpen, setVoteOpen] = useState(false);
  const [sabOpen, setSabOpen] = useState(false);
  const [activeTask, setActiveTask] = useState(null);
  const comms = useComms({ view, roomId, conn, events });
  const ctrl = useControls({
    view, roomId, conn,
    taskOpen: !!activeTask,
    onOpenTask: (t) => setActiveTask(t),
    onOpenSabotage: () => setSabOpen(true),
  });
  const you = view.you || {};
  const room = you.room;
  const map = view.map || {};
  const here = (view.players || []).filter((p) => p.room === room && p.id !== you.id);
  const myTasks = (you.tasks || []).filter((t) => t.room === room && !t.done);
  const isImpostor = you.role === "impostor";
  const onEnergy = you.plane === "energy";

  const act = (fn) => (e) => { fn(); if (e) pop(e.clientX, e.clientY); };

  return (
    <div style={{ height: "100%", display: "grid", gridTemplateColumns: "300px 1fr 320px" }}>
      {layer}
      {/* voting overlay */}
      {voteOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "grid", placeItems: "center", background: "rgba(5,4,9,0.55)" }} onClick={(e) => { if (e.target === e.currentTarget) setVoteOpen(false); }}>
          <VotePanel view={view} roomId={roomId} conn={conn} onClose={() => setVoteOpen(false)} />
        </div>
      )}
      {/* LEFT: ship status */}
      <div style={sidePane}>
        <div className="tag"><span>Ship status</span></div>
        <Gauge label="HULL" value={view.hull} max={map.hullMax || 150} color="var(--hot)" kanji="船体" />
        <Gauge label="POWER" value={Math.round(view.power)} max={1000} color="var(--gold)" kanji="動力" />
        <Gauge label="YOUR O₂" value={Math.round(you.oxygen)} max={100} color="var(--volt)" kanji="酸素" />
        <div style={{ marginTop: 14 }}>
          <div className="impactf faint" style={{ fontSize: 11, letterSpacing: "0.12em" }}>JOURNEY</div>
          <div style={journeyTrack}>
            <div style={{ ...journeyFill, width: `${Math.min(100, (view.journey?.distance / (view.journey?.total || 1)) * 100)}%` }} />
          </div>
          <div className="faint" style={{ fontSize: 11, marginTop: 4 }}>{Math.round(view.journey?.distance || 0)} / {view.journey?.total} to landing</div>
        </div>
        <div style={{ marginTop: 16 }}>
          <div className="impactf faint" style={{ fontSize: 11, letterSpacing: "0.12em", marginBottom: 6 }}>SYSTEMS</div>
          <div className="row gap-s" style={{ flexWrap: "wrap" }}>
            <Sys on={view.systems?.oxygenOn} label="O₂" />
            <Sys on={view.systems?.enginesOn} label="ENG" />
            <Sys on={view.systems?.shieldsOn && !view.systems?.enginesOn} label="SHLD" />
          </div>
        </div>
      </div>

      {/* CENTER: the isometric playfield (click to move) with a floating HUD */}
      <div style={{ position: "relative", overflow: "hidden" }}>
        <IsoStage view={view} onMoveTo={(x, y) => conn.setDestination(roomId, x, y)} />

        {/* energy-plane wash + banner when you've crossed over */}
        {onEnergy && (
          <>
            <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "radial-gradient(120% 100% at 50% 50%, transparent 30%, rgba(70,230,255,0.10) 100%)", boxShadow: "inset 0 0 120px rgba(70,230,255,0.25)" }} />
            <div style={{ position: "absolute", top: 70, left: "50%", transform: "translateX(-50%)", textAlign: "center", pointerEvents: "none" }}>
              <div className="kanji" style={{ fontSize: 18, color: "var(--volt)", letterSpacing: "0.3em" }}>霊体</div>
              <div className="impactf" style={{ fontSize: 13, color: "var(--volt)", letterSpacing: "0.12em" }}>ENERGY PLANE — STILL IN PLAY</div>
              <div className="faint" style={{ fontSize: 11, marginTop: 2 }}>Finish energy tasks to help your team. A second pull on this plane ends you for good.</div>
            </div>
          </>
        )}

        {/* top-left role + room readout */}
        <div style={{ position: "absolute", top: 16, left: 20, pointerEvents: "none" }}>
          <div className="kanji" style={{ fontSize: 14, color: onEnergy ? "var(--volt)" : isImpostor ? "var(--violet)" : "var(--volt)" }}>{isImpostor ? "裏切者" : "乗員"}</div>
          <div className="display" style={{ fontSize: 40, lineHeight: 0.85 }}>{room || "—"}</div>
          <span style={{ ...roleBadge, fontSize: 11, padding: "4px 10px", borderColor: onEnergy ? "var(--volt)" : isImpostor ? "var(--violet)" : "var(--volt)", color: onEnergy ? "var(--volt)" : isImpostor ? "var(--violet)" : "var(--volt)" }}>
            {onEnergy ? "DOWNED · ENERGY" : isImpostor ? "IMPOSTOR" : "CREW"}
          </span>
        </div>

        {/* hint + vote opener + comms */}
        <div style={{ position: "absolute", top: 14, right: 18, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
          <div className="impactf faint" style={{ fontSize: 10, letterSpacing: "0.12em", pointerEvents: "none" }}>CLICK FLOOR TO MOVE · HOLD C FOR COMMS</div>
          <div className="row gap-s">
            <button className="btn" style={{ fontSize: 13, padding: "8px 14px", borderColor: "var(--volt)" }} onClick={() => comms.setOpen(true)}>声 COMMS</button>
            <button className="btn btn-hot" style={{ fontSize: 13, padding: "8px 16px" }} onClick={() => setVoteOpen(true)}>
              投票 EJECT VOTE
              {view.you?.myVote && <span style={{ marginLeft: 8, fontSize: 10 }}>● VOTED</span>}
            </button>
          </div>
        </div>

        {/* incoming comms captions */}
        <CaptionStream captions={comms.captions} />
        {comms.open && <CommsRadial wheel={comms.wheel} fire={comms.fire} onClose={() => comms.setOpen(false)} />}

        {/* active sabotage alerts (everyone) + impostor trigger menu */}
        <SabotageAlerts view={view} roomId={roomId} conn={conn} />
        {sabOpen && <SabotageMenu view={view} roomId={roomId} conn={conn} onClose={() => setSabOpen(false)} />}

        {/* task mini-game */}
        {activeTask && (
          <MiniGame task={activeTask} energy={onEnergy}
            onSolved={() => { conn.completeTask(roomId, activeTask.id); setActiveTask(null); }}
            onCancel={() => setActiveTask(null)} />
        )}

        {/* onboarding: contextual control hints + rotating tips (toggle-gated) */}
        {ctrl.showHints && <ControlHints hints={ctrl.hints} />}
        <TipBubble view={view} enabled={ctrl.showTips} />

        {/* bottom floating action bar */}
        <div style={hudBar}>
          {/* tasks here */}
          {myTasks.length > 0 ? myTasks.map((t) => (
            <button key={t.id} className="btn" style={{ fontSize: 12, padding: "10px 14px", textTransform: "none", borderColor: "var(--gold)" }} onClick={() => { conn.startTask(roomId, t.id); setActiveTask(t); }}>
              ◆ {t.name}
            </button>
          )) : <span className="faint impactf" style={{ fontSize: 11, alignSelf: "center" }}>NO TASKS HERE</span>}

          <span style={{ width: 1, background: "var(--line)", alignSelf: "stretch", margin: "0 4px" }} />

          {(map.refillRooms || []).includes(room) && <button className="btn" style={hudBtn} onClick={act(() => conn.refill(roomId))}>Refill O₂</button>}
          {(map.repairRooms || []).includes(room) && <button className="btn" style={hudBtn} onClick={act(() => conn.repair(roomId))}>Repair</button>}
          {view.youAreCommander && <button className="btn" style={hudBtn} onClick={() => conn.setSystem(roomId, "engines", !view.systems?.enginesOn)}>Engines {view.systems?.enginesOn ? "ON" : "OFF"}</button>}
          {isImpostor && <button className="btn" style={{ ...hudBtn, borderColor: "var(--violet)" }} onClick={() => setSabOpen(true)}>妨害 Sabotage</button>}

          {/* pilots in the same room: pull / vote */}
          {here.map((p) => (
            <span key={p.id} className="row gap-s" style={{ padding: "4px 8px", border: `1px solid ${p.idColor?.hex || "var(--line)"}`, alignItems: "center" }}>
              <span style={{ ...crewDot, width: 10, height: 10, background: p.idColor?.hex || "var(--dim)" }} />
              <span style={{ fontSize: 12, fontWeight: 700 }}>{p.name}</span>
              {isImpostor && p.plane === you.plane && <button className="btn" style={miniBtn} onClick={act(() => conn.detachCable(roomId, p.id))}>Pull</button>}
              <button className="btn btn-ghost" style={miniBtn} onClick={() => conn.vote(roomId, p.id)}>Vote</button>
            </span>
          ))}
        </div>
      </div>

      {/* RIGHT: minimap */}
      <div style={{ ...sidePane, borderLeft: "2px solid var(--line)", borderRight: "none" }}>
        <MiniMap view={view} compact />
        <div className="faint" style={{ fontSize: 12, marginTop: 14 }}>Click anywhere on the floor to walk there. Walk into stations to use them, and into other pilots to act.</div>
      </div>
    </div>
  );
}

// Win reasons -> human flavor text.
const WIN_REASON_TEXT = {
  all_impostors_down: "Every impostor was ejected.",
  reached_location: "The crew reached the landing zone.",
  hull_destroyed: "The hull was torn apart.",
  impostors_parity: "The impostors reached parity.",
  sabotage_unresolved: "A sabotage went unresolved.",
};

function Results({ view, roomId, conn, profile, onLeave }) {
  const won = view.winner === "crew";
  const you = view.you || {};
  const iWon = (won && you.role !== "impostor") || (!won && you.role === "impostor");
  const players = view.players || [];
  const impostors = players.filter((p) => p.role === "impostor");
  // XP mirrors the backend rule: base 50 + 75 if your side won.
  const xpGain = 50 + (iWon ? 75 : 0);
  const [rematchSent, setRematchSent] = useState(false);
  const isHost = you.id === view.hostId;

  // If the host rematches, the room flips back to lobby — Play's phase switch
  // handles the screen change; we just fire the action.
  const rematch = () => { conn.rematch(roomId); setRematchSent(true); };

  return (
    <div style={{ height: "100%", position: "relative", overflow: "hidden", background: "radial-gradient(120% 100% at 50% 0%, #1d1626 0%, var(--ink) 60%)" }}>
      <SpeedLines hot={!won} />
      <div style={{ position: "relative", zIndex: 2, height: "100%", display: "grid", gridTemplateColumns: "1fr 360px" }}>
        {/* left: verdict + roster */}
        <div style={{ padding: "40px 48px", overflowY: "auto" }}>
          <div className="kanji" style={{ fontSize: 28, color: won ? "var(--volt)" : "var(--hot)", letterSpacing: "0.3em" }}>{won ? "勝利" : "敗北"}</div>
          <h1 className="display" style={{ fontSize: "clamp(56px,9vw,110px)", margin: "0 0 2px", lineHeight: 0.82, color: won ? "var(--volt)" : "var(--hot)" }}>
            {won ? "CREW PREVAIL" : "IMPOSTORS WIN"}
          </h1>
          <div className="dim" style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>{WIN_REASON_TEXT[view.winReason] || "The match has ended."}</div>
          <div style={{ ...resultBadge, borderColor: iWon ? "var(--gold)" : "var(--faint)", color: iWon ? "var(--gold)" : "var(--dim)" }}>
            YOU {iWon ? "WON" : "LOST"} · {you.role === "impostor" ? "IMPOSTOR" : "CREW"}
          </div>

          <div className="tag" style={{ margin: "32px 0 14px" }}><span>The Impostors Were</span></div>
          <div className="row gap-s" style={{ flexWrap: "wrap", marginBottom: 28 }}>
            {impostors.map((p) => (
              <div key={p.id} className="panel panel-hot" style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px" }}>
                <span style={{ width: 16, height: 16, borderRadius: "50%", background: p.idColor?.hex || "var(--hot)", border: "2px solid var(--ink)", boxShadow: "0 0 0 1px var(--line)" }} />
                <span className="impactf" style={{ fontSize: 15 }}>{p.name}{p.id === you.id ? " (you)" : ""}</span>
                <span className="kanji" style={{ color: "var(--violet)", fontSize: 14 }}>裏切者</span>
              </div>
            ))}
          </div>

          <div className="tag" style={{ marginBottom: 14 }}><span>Final Roster</span></div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(170px,1fr))", gap: 8 }}>
            {players.map((p) => {
              const imp = p.role === "impostor";
              const out = p.plane === "eliminated";
              return (
                <div key={p.id} className="panel" style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", borderColor: imp ? "var(--hot-deep)" : "var(--line)", opacity: out ? 0.6 : 1 }}>
                  <span style={{ width: 12, height: 12, borderRadius: "50%", background: p.idColor?.hex || "var(--dim)", flexShrink: 0, border: "2px solid var(--ink)" }} />
                  <span style={{ fontWeight: 700, fontSize: 13 }}>{p.name}</span>
                  <span className="impactf" style={{ marginLeft: "auto", fontSize: 9, color: imp ? "var(--violet)" : "var(--volt)" }}>{imp ? "IMP" : "CREW"}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* right: rewards + actions */}
        <div style={{ borderLeft: "2px solid var(--line)", background: "var(--ink-2)", padding: "40px 28px", display: "flex", flexDirection: "column" }}>
          <div className="tag"><span>Mission Report</span></div>
          <div style={{ margin: "24px 0", textAlign: "center" }}>
            <div className="impactf faint" style={{ fontSize: 12, letterSpacing: "0.15em" }}>XP EARNED</div>
            <div className="display" style={{ fontSize: 72, color: "var(--gold)", lineHeight: 0.9, textShadow: "0 0 40px rgba(255,200,61,0.3)" }}>+{xpGain}</div>
            <div className="dim" style={{ fontSize: 13 }}>50 base{iWon ? " + 75 victory bonus" : ""}</div>
          </div>
          {profile && (
            <div className="panel" style={{ padding: 14, marginBottom: 24 }}>
              <div className="row" style={{ justifyContent: "space-between", fontSize: 13 }}>
                <span className="dim">Rank</span><span className="impactf">LV {profile.level}</span>
              </div>
              <div className="faint" style={{ fontSize: 11, marginTop: 4 }}>XP is awarded to your account by the server. Reopen the Hangar to see your updated rank.</div>
            </div>
          )}
          <div className="grow" />
          {isHost && (
            <button className="btn btn-hot" style={{ width: "100%", fontSize: 18, marginBottom: 10 }} disabled={rematchSent} onClick={rematch}>
              {rematchSent ? "Restarting…" : "↻ Rematch (same crew)"}
            </button>
          )}
          {!isHost && <div className="impactf dim" style={{ fontSize: 11, textAlign: "center", marginBottom: 10, letterSpacing: "0.1em" }}>HOST MAY REMATCH THE CREW</div>}
          <button className="btn" style={{ width: "100%", fontSize: 15 }} onClick={onLeave}>Return to Hangar</button>
        </div>
      </div>
    </div>
  );
}

/* ---- small bits ---- */
function Gauge({ label, value, max, color, kanji }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div style={{ marginTop: 14 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="impactf" style={{ fontSize: 11, letterSpacing: "0.12em" }}>{label}</span>
        <span style={{ fontFamily: "var(--display)", fontSize: 18, color }}>{value}</span>
      </div>
      <div style={gaugeTrack}><div style={{ ...gaugeFill, width: `${pct}%`, background: color, boxShadow: `0 0 12px ${color}` }} /></div>
    </div>
  );
}
function Sys({ on, label }) {
  return <span style={{ ...sysChip, ...(on ? sysOn : null) }}>{label}</span>;
}

const wrap = { height: "100%", position: "relative", overflow: "hidden", background: "radial-gradient(120% 100% at 50% 0%, #1d1626 0%, var(--ink) 60%)" };
const toast = { position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 9999, background: "var(--hot)", color: "var(--ink)", padding: "12px 22px", fontWeight: 700, clipPath: "polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%)" };
const bigChoice = { padding: 28, background: "var(--ink-2)", display: "flex", flexDirection: "column", gap: 6, alignItems: "center", cursor: "pointer" };
const codeInput = { flex: 1, background: "var(--ink)", border: "2px solid var(--line)", color: "var(--paper)", padding: "10px 12px", fontFamily: "var(--display)", fontSize: 24, letterSpacing: "0.3em", textAlign: "center", outline: "none" };
const crewGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px,1fr))", gap: 10 };
const crewCard = { padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, background: "var(--ink-2)" };
const crewDot = { width: 14, height: 14, borderRadius: "50%", border: "2px solid var(--ink)", boxShadow: "0 0 0 1px var(--line)" };
const perkGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px,1fr))", gap: 12 };
const perkCard = { padding: 16, textAlign: "left", background: "var(--ink-2)", cursor: "pointer" };
const perkOn = { borderColor: "var(--hot)", boxShadow: "0 0 0 1px rgba(255,45,77,0.3)" };
const sidePane = { background: "var(--ink-2)", borderRight: "2px solid var(--line)", padding: "22px 18px", overflowY: "auto" };
const gaugeTrack = { height: 12, background: "var(--ink)", border: "1px solid var(--line)", marginTop: 4, overflow: "hidden" };
const gaugeFill = { height: "100%", transition: "width 0.4s ease" };
const journeyTrack = { height: 14, background: "var(--ink)", border: "2px solid var(--line)", marginTop: 4, overflow: "hidden", clipPath: "polygon(0 0,100% 0,calc(100% - 6px) 100%,0 100%)" };
const journeyFill = { height: "100%", background: "linear-gradient(90deg,var(--volt),var(--violet))", transition: "width 0.5s ease" };
const sysChip = { fontFamily: "var(--impact)", fontSize: 11, padding: "4px 10px", border: "2px solid var(--line)", color: "var(--faint)" };
const sysOn = { color: "var(--ink)", background: "var(--volt)", borderColor: "var(--volt)" };
const roleBadge = { fontFamily: "var(--impact)", fontSize: 14, letterSpacing: "0.1em", padding: "8px 16px", border: "2px solid" };
const resultBadge = { display: "inline-block", fontFamily: "var(--impact)", fontSize: 13, letterSpacing: "0.1em", padding: "8px 16px", border: "2px solid", marginTop: 6 };
const taskBtn = { display: "flex", alignItems: "center", padding: "12px 14px", background: "var(--ink-2)", cursor: "pointer", textAlign: "left" };
const hereCard = { display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "var(--ink-2)" };
const miniBtn = { fontSize: 11, padding: "6px 12px" };
const navGrid = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 };
const navBtn = { fontSize: 11, padding: "9px 8px", textTransform: "none" };
const hudBar = { position: "absolute", left: 16, right: 16, bottom: 16, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", padding: "10px 12px", background: "rgba(13,11,20,0.82)", border: "2px solid var(--line)", backdropFilter: "blur(4px)" };
const hudBtn = { fontSize: 12, padding: "9px 13px", textTransform: "none" };
