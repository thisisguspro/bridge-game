import { useEffect, useRef, useState, useCallback } from "react";
import { createGameConnection } from "../api/game.js";
import { SpeedLines, useImpact, KanjiFlash, SlashEffect } from "../components/effects.jsx";
import MiniMap from "../components/MiniMap.jsx";
import IsoStage from "../components/IsoStage.jsx";
import VotePanel from "../components/VotePanel.jsx";
import { useComms, CommsRadial, CaptionStream } from "../components/Comms.jsx";
import { SabotageMenu, SabotageAlerts } from "../components/Sabotage.jsx";
import MiniGame from "../components/MiniGame.jsx";
import { useControls, ControlHints, TipBubble } from "../components/Controls.jsx";
import { sfx, initAudio } from "../api/audio.js";

// Play: connects to the game server, hosts the lobby, then renders the live
// match driven by the server's per-player "state" stream. Classic mode focus —
// no event/mode pickers here. Real Socket.IO throughout.
export default function Play({ user, profile, onRoomStatus, onChange }) {
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

  useEffect(() => {
    if (onRoomStatus) onRoomStatus(!!roomId);
  }, [roomId, onRoomStatus]);

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
            sfx.eject();
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
  const leave = () => { if (conn) conn.disconnect(); setView(null); setRoomId(null); setLiveEvents([]); onRoomStatus?.(false); onChange?.(); };

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
        {roomId && view?.phase === "active" && <Match view={view} roomId={roomId} conn={conn} events={liveEvents} onLeave={leave} />}
        {roomId && view?.phase === "ended" && <Results view={view} roomId={roomId} conn={conn} profile={profile}
          onLeave={() => { setRoomId(null); setView(null); onChange?.(); }} onChange={onChange} />}
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

  const briefingBadge = {
    background: "#ff2a47",
    color: "#fff",
    padding: "3px 16px",
    display: "inline-block",
    fontFamily: "Rajdhani, sans-serif",
    fontWeight: 900,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.15em",
    transform: "skewX(-15deg)",
    marginBottom: 16
  };

  const beginDraftBtn = {
    background: "#ff2a47",
    color: "#000",
    width: "100%",
    border: "none",
    padding: "16px 24px",
    fontSize: 18,
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: "0.15em",
    transform: "skewX(-15deg)",
    cursor: "pointer",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    transition: "all 0.2s"
  };

  const mainCardStyle = {
    background: "rgba(18, 14, 30, 0.4)",
    border: "1px solid rgba(255, 255, 255, 0.08)",
    borderRadius: 4,
    padding: 24,
    marginBottom: 24
  };

  const crewGridStyle = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
    gap: 12,
    marginTop: 20
  };

  const crewCardStyle = {
    background: "rgba(22, 17, 36, 0.6)",
    border: "1px solid rgba(255, 255, 255, 0.05)",
    padding: "12px 14px",
    display: "flex",
    alignItems: "center",
    gap: 10,
    transform: "skewX(-15deg)",
    position: "relative",
    overflow: "hidden"
  };

  const sidebarStyle = {
    background: "rgba(13, 9, 24, 0.5)",
    border: "1px solid rgba(255, 255, 255, 0.08)",
    borderRadius: 4,
    padding: "48px 24px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    textAlign: "center"
  };

  return (
    <div style={{ padding: "32px 40px", height: "100%", display: "grid", gridTemplateColumns: "1fr 340px", gap: 24 }}>
      <div>
        <div style={briefingBadge}>
          <div style={{ transform: "skewX(15deg)" }}>Briefing Room</div>
        </div>
        
        <div className="row" style={{ alignItems: "baseline", gap: 12, marginTop: 4 }}>
          <span className="display" style={{ fontSize: 26, color: "#fff", fontWeight: 800, letterSpacing: "0.05em" }}>JOIN CODE</span>
          <span className="display" style={{ fontSize: 56, color: "#ff2a47", fontWeight: 800, letterSpacing: "0.05em" }}>{roomId}</span>
        </div>
        
        <div style={{ fontSize: 13, color: "rgba(255, 255, 255, 0.3)", marginBottom: 24, fontFamily: "Rajdhani" }}>
          Share this code with your squad. {players.length}/{view?.map?.maxPlayers || 10} aboard.
        </div>

        <div style={mainCardStyle}>
          {isHost ? (
            <button 
              style={{
                ...beginDraftBtn,
                background: enough ? "#ff2a47" : "rgba(255,42,71,0.4)",
                cursor: enough ? "pointer" : "not-allowed"
              }}
              disabled={!enough}
              onClick={() => conn.startDraft(roomId)}
            >
              <span style={{ transform: "skewX(15deg)", fontWeight: 900 }}>
                {enough ? "Begin Perk Draft →" : `Need ${min - players.length} more pilot${min - players.length === 1 ? "" : "s"}`}
              </span>
            </button>
          ) : (
            <button 
              style={{
                ...beginDraftBtn,
                background: "rgba(255, 255, 255, 0.05)",
                color: "rgba(255, 255, 255, 0.3)",
                border: "1px solid rgba(255, 255, 255, 0.1)",
                cursor: "not-allowed"
              }}
              disabled
            >
              <span style={{ transform: "skewX(15deg)", fontWeight: 900 }}>
                Waiting for host to launch...
              </span>
            </button>
          )}

          {isHost && players.length < (view?.map?.maxPlayers || 99) && (
            <div style={{ marginTop: 24 }}>
              <div className="impactf faint" style={{ fontSize: 11, letterSpacing: "0.12em", marginBottom: 10, color: "rgba(255, 255, 255, 0.4)" }}>ADD A BOT</div>
              <div className="row gap-s">
                {[
                  { tier: "recruit", label: "Recruit", kanji: "易", color: "#3a7dff" },
                  { tier: "pilot", label: "Pilot", kanji: "中", color: "#00f0ff" },
                  { tier: "ace", label: "Ace", kanji: "b46bff", color: "#b46bff" }
                ].map(({ tier, label, kanji, color }) => (
                  <button 
                    key={tier} 
                    style={{
                      background: "rgba(18, 14, 30, 0.8)",
                      border: `1px solid ${color}`,
                      borderRadius: 2,
                      color: "#fff",
                      padding: "8px 16px",
                      fontSize: 12,
                      fontWeight: 700,
                      transform: "skewX(-15deg)",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center"
                    }}
                    onClick={() => conn.addBot(roomId, tier)}
                  >
                    <div style={{ transform: "skewX(15deg)", display: "flex", alignItems: "center" }}>
                      <span className="kanji" style={{ marginRight: 8, color, fontWeight: 900 }}>{kanji}</span>
                      {label}
                    </div>
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 10, color: "rgba(255, 255, 255, 0.3)", marginTop: 8, fontFamily: "Rajdhani" }}>
                Recruit - passive · Pilot - standard · Ace - aggressive. Bots can be crew or impostor.
              </div>
            </div>
          )}
        </div>

        <div style={crewGridStyle}>
          {players.map((p) => (
            <div key={p.id} style={crewCardStyle}>
              {/* color accent block */}
              <div style={{
                width: 6,
                height: "100%",
                background: p.idColor?.hex || "var(--dim)",
                position: "absolute",
                left: 0,
                top: 0
              }} />
              
              <div style={{ transform: "skewX(15deg)", display: "flex", alignItems: "center", width: "100%", gap: 8 }}>
                <span style={{ fontWeight: 700, color: "#fff", marginLeft: 4 }}>{p.name}</span>
                {p.isBot && (
                  <span style={{
                    background: "#ff2a47",
                    color: "#000",
                    fontSize: 8,
                    fontWeight: 900,
                    padding: "1px 5px",
                    transform: "skewX(-10deg)"
                  }}>
                    BOT
                  </span>
                )}
                {p.id === view?.hostId && (
                  <span style={{
                    background: "#ff2a47",
                    color: "#000",
                    fontSize: 8,
                    fontWeight: 900,
                    padding: "1px 5px",
                    transform: "skewX(-10deg)",
                    marginLeft: "auto"
                  }}>
                    HOST
                  </span>
                )}
                {isHost && p.isBot && (
                  <button 
                    style={{
                      marginLeft: "auto",
                      background: "none",
                      border: "none",
                      color: "rgba(255,255,255,0.4)",
                      cursor: "pointer",
                      fontSize: 13,
                      fontWeight: 700,
                      padding: 0
                    }}
                    onClick={() => conn.removeBot(roomId, p.id)}
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={sidebarStyle}>
        <div className="kanji" style={{ fontSize: 32, color: "#00f0ff", letterSpacing: "0.2em", marginBottom: 12 }}>待機</div>
        <div className="impactf" style={{ fontSize: 14, letterSpacing: "0.15em", color: "#fff", fontWeight: 700, marginBottom: 24 }}>STANDING BY</div>
        
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", marginBottom: 6 }}>
          <span style={{ fontSize: 72, fontWeight: 900, color: "#ff2a47", lineHeight: 1 }}>{players.length}</span>
          <span style={{ fontSize: 24, color: "rgba(255, 255, 255, 0.3)", fontWeight: 700 }}>/{view?.map?.maxPlayers || 10}</span>
        </div>
        <div style={{ fontSize: 10, color: "rgba(255, 255, 255, 0.4)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 32 }}>pilots aboard</div>
        
        <div style={{ fontSize: 11, color: "rgba(255, 255, 255, 0.25)", lineHeight: 1.5, marginTop: "auto" }}>
          The ship layout is revealed when the match begins – every voyage is different.
        </div>
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
function Match({ view, roomId, conn, events, onLeave }) {
  const { pop, layer } = useImpact();
  const [voteOpen, setVoteOpen] = useState(false);
  const [sabOpen, setSabOpen] = useState(false);
  const [helmOpen, setHelmOpen] = useState(false);
  const [turretOpen, setTurretOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [slashActive, setSlashActive] = useState(false);
  const [activeTask, setActiveTask] = useState(null);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [confirmSurrender, setConfirmSurrender] = useState(false);
  const [downedBanner, setDownedBanner] = useState(false);
  const prevEnergy = useRef(false);
  const comms = useComms({ view, roomId, conn, events });
  const ctrl = useControls({
    view, roomId, conn,
    taskOpen: !!activeTask,
    onOpenTask: (t) => setActiveTask(t),
    onOpenSabotage: () => setSabOpen(true),
    onOpenTurret: () => setTurretOpen(true),
  });
  const you = view.you || {};
  const room = you.room;
  const displayRoom = you.displayRoom || you.room;
  const inCorridor = !!you.inCorridor;
  // exact exclamation-mark position for a task (mirrors IsoStage + Controls)
  const taskMarkerPos = (roomName, taskName) => {
    const r = view.map?.geometry?.rooms?.[roomName];
    if (!r) return null;
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    let hash = 0; const str = taskName || "";
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    const offs = [{dx:-r.w/4,dy:-r.h/4},{dx:r.w/4,dy:r.h/4},{dx:-r.w/4,dy:r.h/4},{dx:r.w/4,dy:-r.h/4},{dx:0,dy:-r.h/3},{dx:0,dy:r.h/3}];
    const o = offs[Math.abs(hash) % offs.length];
    return { x: cx + o.dx, y: cy + o.dy };
  };
  const INTERACT_R = 130;
  const distToMarker = (pos) => (!pos || you.x == null) ? Infinity : Math.hypot(you.x - pos.x, you.y - pos.y);
  const atRoomCenter = (() => {
    const r = view.map?.geometry?.rooms?.[room];
    if (!r || you.x == null || inCorridor) return false;
    return Math.hypot(you.x - (r.x + r.w/2), you.y - (r.y + r.h/2)) <= INTERACT_R;
  })();
  // tasks in this room you're actually standing on
  const reachableTasks = inCorridor ? [] : (you.tasks || []).filter((t) => t.room === room && !t.done && distToMarker(taskMarkerPos(t.room, t.name)) <= INTERACT_R);
  const map = view.map || {};
  const here = (view.players || []).filter((p) => p.room === room && p.id !== you.id);
  const myTasks = (you.tasks || []).filter((t) => t.room === room && !t.done);
  const isImpostor = you.role === "impostor";
  const onEnergy = you.plane === "energy";
  const isAttacked = view.globalAttack != null;

  useEffect(() => {
    if (isAttacked) {
      initAudio();
      sfx.siren();
      const t = setInterval(() => {
        sfx.siren();
      }, 800);
      return () => clearInterval(t);
    }
  }, [isAttacked]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (mapOpen) setMapOpen(false);
        else if (turretOpen) setTurretOpen(false);
        else if (helmOpen) setHelmOpen(false);
        else if (sabOpen) setSabOpen(false);
        else setPauseOpen(p => !p);
      } else if (e.code === 'KeyM' && !e.repeat) {
        // don't steal M while typing in an input
        const tag = (e.target.tagName || "").toLowerCase();
        if (tag === "input" || tag === "textarea") return;
        setMapOpen(o => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [helmOpen, sabOpen, turretOpen, mapOpen]);

  // Show "YOU WERE DOWNED" banner for 3 seconds on first energy plane entry
  useEffect(() => {
    if (onEnergy && !prevEnergy.current) {
      sfx.downed(); // harsh negative cue — your oxygen was pulled
      setDownedBanner(true);
      const t = setTimeout(() => setDownedBanner(false), 3000);
      return () => clearTimeout(t);
    }
    prevEnergy.current = onEnergy;
  }, [onEnergy]);

  const act = (fn) => (e) => { fn(); if (e) pop(e.clientX, e.clientY); };
  const pull = (id) => (e) => { conn.detachCable(roomId, id); sfx.slash(); setSlashActive(true); if (e) pop(e.clientX, e.clientY); };

  return (
    <div style={{ height: "100%", display: "grid", gridTemplateColumns: "270px 1fr" }}>
      {layer}
      <SlashEffect active={slashActive} onDone={() => setSlashActive(false)} />
      {/* voting overlay */}
      {voteOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "grid", placeItems: "center", background: "rgba(5,4,9,0.55)" }} onClick={(e) => { if (e.target === e.currentTarget) setVoteOpen(false); }}>
          <VotePanel view={view} roomId={roomId} conn={conn} onClose={() => setVoteOpen(false)} />
        </div>
      )}
      {/* pause menu overlay */}
      {pauseOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 500, display: 'grid', placeItems: 'center', background: 'rgba(5,4,9,0.85)', backdropFilter: 'blur(8px)' }}>
          <div style={{ width: 360, maxWidth: '90vw', textAlign: 'center' }}>
            <div className="kanji" style={{ fontSize: 24, color: 'var(--hot)', letterSpacing: '0.3em' }}>一時停止</div>
            <div className="display" style={{ fontSize: 56, margin: '4px 0 24px' }}>PAUSED</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <button className="btn" style={{ fontSize: 18, padding: '14px 24px', width: '100%' }} onClick={() => setPauseOpen(false)}>▶ Resume</button>
              <button className="btn" style={{ fontSize: 15, padding: '12px 24px', width: '100%', borderColor: 'var(--gold)' }} onClick={() => { setPauseOpen(false); /* open settings somehow - for now just close */ }}>⚙ Settings</button>
              <div style={{ height: 1, background: 'var(--line)', margin: '8px 0' }} />
              <button className="btn" style={{ fontSize: 15, padding: '12px 24px', width: '100%', borderColor: 'var(--red, #ff2d4d)', color: 'var(--red, #ff2d4d)' }} onClick={() => setConfirmSurrender(true)}>⚠ Surrender & Quit</button>
            </div>
            
            {/* Surrender Confirmation Modal */}
            {confirmSurrender && (
              <div style={{ position: 'absolute', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.8)' }}>
                <div style={{ background: 'var(--ink)', border: '2px solid var(--red)', padding: 30, maxWidth: 400, textAlign: 'center' }}>
                  <h2 className="impactf" style={{ color: 'var(--red)', fontSize: 24, margin: '0 0 10px' }}>ABANDON MISSION?</h2>
                  <p style={{ color: 'var(--paper)', fontSize: 14, marginBottom: 20 }}>Your crew will be down a pilot. Are you sure you want to surrender?</p>
                  <div style={{ display: 'flex', gap: 15 }}>
                    <button className="btn" style={{ flex: 1 }} onClick={() => setConfirmSurrender(false)}>CANCEL</button>
                    <button className="btn" style={{ flex: 1, borderColor: 'var(--red)', color: 'var(--red)' }} onClick={() => { setConfirmSurrender(false); setPauseOpen(false); onLeave?.(); }}>SURRENDER</button>
                  </div>
                </div>
              </div>
            )}
            
            <div className="faint" style={{ fontSize: 11, marginTop: 16 }}>Press ESC to resume</div>
          </div>
        </div>
      )}
      {/* LEFT: ship status — floats over gameplay with drop shadows, no panel bg */}
      <div style={sidePane}>
        <div style={leftCard}>
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
        </div>

        {/* mini shield/engine allocation bar — a compact copy of the Helm throttle
            so everyone can see the current power split at a glance */}
        <div style={leftCard}>
          <div className="impactf faint" style={{ fontSize: 11, letterSpacing: "0.12em", marginBottom: 6 }}>POWER BALANCE</div>
          {(() => {
            const enginePct = ((view.systems?.engineSpeed ?? 0) / 5) * 100;
            const shieldPct = 100 - enginePct;
            return (
              <>
                <div className="row" style={{ justifyContent: "space-between", fontSize: 9 }}>
                  <span style={{ color: "var(--volt)" }}>SHLD {Math.round(shieldPct)}%</span>
                  <span style={{ color: "var(--hot)" }}>ENG {Math.round(enginePct)}%</span>
                </div>
                <div style={{ position: "relative", height: 12, background: "var(--ink)", border: "1px solid var(--line)", display: "flex", marginTop: 3 }}>
                  <div style={{ width: `${shieldPct}%`, background: "var(--volt)", opacity: 0.8 }} />
                  <div style={{ width: `${enginePct}%`, background: "var(--hot)", opacity: 0.8 }} />
                </div>
                <div className="faint" style={{ fontSize: 9, marginTop: 3 }}>set at the Helm</div>
              </>
            );
          })()}
        </div>
      </div>

      {/* CENTER: the isometric playfield with a floating HUD */}
      <div style={{ position: "relative", overflow: "hidden" }}>
        <IsoStage view={view} showColorblind={ctrl.showColorblind} />

        {/* red attack warning pulse overlay */}
        {isAttacked && (
          <>
            <div style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              border: "10px solid #ff2a47",
              boxShadow: "inset 0 0 80px rgba(255,42,71,0.6)",
              animation: "redPulse 1.2s ease-in-out infinite",
              zIndex: 100
            }} />
            <style>{`
              @keyframes redPulse {
                0%, 100% { opacity: 0.25; }
                50% { opacity: 0.85; }
              }
              @keyframes bannerFlash {
                0%, 100% { border-color: var(--hot); }
                50% { border-color: var(--gold); }
              }
            `}</style>
          </>
        )}

        {/* Thin top-pinned alert banner for incoming attacks */}
        {isAttacked && view.globalAttack?.warning && (
          <div style={incomingBannerStyle}>
            <span className="impactf" style={{ fontSize: 13, color: "var(--hot)", textShadow: "0 0 8px var(--hot)" }}>
              ⚠️ INCOMING ATTACK WAVE &nbsp;·&nbsp;
            </span>
            <span className="display" style={{ fontSize: 18, color: "#fff", margin: "0 8px" }}>
              {view.globalAttack?.warningSeconds ?? 20}s
            </span>
            <span className="faint" style={{ fontSize: 11, letterSpacing: 1, textTransform: "uppercase", color: "var(--dim)" }}>
              &nbsp;·&nbsp; Man the turret stations immediately!
            </span>
          </div>
        )}

        {/* energy-plane wash + banner when you've crossed over */}
        {onEnergy && (
          <>
            <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "radial-gradient(120% 100% at 50% 50%, transparent 20%, rgba(70,230,255,0.18) 100%)", boxShadow: "inset 0 0 200px rgba(70,230,255,0.45), inset 0 0 60px rgba(70,230,255,0.3)", animation: "energyPulse 2s ease-in-out infinite" }} />
            {/* dramatic border glow */}
            <div style={{ position: "absolute", inset: 0, pointerEvents: "none", border: "3px solid rgba(70,230,255,0.35)", boxShadow: "inset 0 0 40px rgba(70,230,255,0.25), 0 0 30px rgba(70,230,255,0.15)" }} />
            {/* brief downed banner */}
            {downedBanner && (
              <div style={{ position: "absolute", top: "30%", left: "50%", transform: "translate(-50%,-50%)", textAlign: "center", pointerEvents: "none", zIndex: 30, animation: "downedFade 3s forwards" }}>
                <div className="kanji" style={{ fontSize: 36, color: "#46e6ff", letterSpacing: "0.4em", textShadow: "0 0 30px rgba(70,230,255,0.8)" }}>撃墜</div>
                <div className="display" style={{ fontSize: 64, color: "#46e6ff", textShadow: "0 0 40px rgba(70,230,255,0.6)", lineHeight: 0.85 }}>YOU WERE DOWNED</div>
                <div className="impactf" style={{ fontSize: 14, color: "var(--volt)", letterSpacing: "0.15em", marginTop: 8 }}>ENTERING ENERGY PLANE</div>
              </div>
            )}
            <div style={{ position: "absolute", top: 70, left: "50%", transform: "translateX(-50%)", textAlign: "center", pointerEvents: "none" }}>
              <div className="kanji" style={{ fontSize: 18, color: "var(--volt)", letterSpacing: "0.3em" }}>霊体</div>
              <div className="impactf" style={{ fontSize: 13, color: "var(--volt)", letterSpacing: "0.12em" }}>ENERGY PLANE — STILL IN PLAY</div>
              <div className="faint" style={{ fontSize: 11, marginTop: 2 }}>Finish energy tasks to help your team. A second pull on this plane ends you for good.</div>
            </div>
            <style>{`
              @keyframes energyPulse { 0%,100% { opacity: 0.8; } 50% { opacity: 1; } }
              @keyframes downedFade { 0% { opacity: 0; transform: translate(-50%,-50%) scale(0.8); } 15% { opacity: 1; transform: translate(-50%,-50%) scale(1); } 75% { opacity: 1; } 100% { opacity: 0; transform: translate(-50%,-50%) scale(1.05); } }
            `}</style>
          </>
        )}

        {/* top-left role + room readout — shifts down when the attack banner shows */}
        <div style={{ position: "absolute", top: (isAttacked && view.globalAttack?.warning) ? 56 : 16, left: 20, pointerEvents: "none", transition: "top 0.2s" }}>
          <div className="kanji" style={{ fontSize: 14, color: onEnergy ? "var(--volt)" : isImpostor ? "var(--violet)" : "var(--volt)" }}>{isImpostor ? "裏切者" : "乗員"}</div>
          <div className="display" style={{ fontSize: 40, lineHeight: 0.85 }}>{displayRoom || "—"}</div>
          <div className="row gap-s" style={{ alignItems: "center" }}>
            <span style={{ ...roleBadge, fontSize: 11, padding: "4px 10px", borderColor: onEnergy ? "var(--volt)" : isImpostor ? "var(--violet)" : "var(--volt)", color: onEnergy ? "var(--volt)" : isImpostor ? "var(--violet)" : "var(--volt)" }}>
              {onEnergy ? "DOWNED · ENERGY" : isImpostor ? "IMPOSTOR" : "CREW"}
            </span>
            {onEnergy && <span className="kanji" style={{ fontSize: 18, color: "var(--volt)", textShadow: "0 0 12px rgba(70,230,255,0.8)", animation: "ghostFloat 2s ease-in-out infinite" }}>霊</span>}
          </div>
          {onEnergy && <style>{`@keyframes ghostFloat { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }`}</style>}
        </div>

        {/* vote opener + comms — kept left of the corner minimap so they don't overlap */}
        <div style={{ position: "absolute", top: 14, right: 235, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
          <div className="impactf faint" style={{ fontSize: 10, letterSpacing: "0.12em", pointerEvents: "none", opacity: 0.7 }}>build R24</div>
          <div className="row gap-s">
            <button className="btn" style={{ fontSize: 13, padding: "8px 14px", borderColor: "var(--volt)" }} onClick={() => { comms.setOpen(true); }}>声 COMMS</button>
            <button className="btn btn-hot" style={{ fontSize: 13, padding: "8px 16px" }} onClick={() => { setVoteOpen(true); }}>
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
        {helmOpen && <HelmMenu view={view} roomId={roomId} conn={conn} onClose={() => setHelmOpen(false)} />}
        {turretOpen && <TurretMenu view={view} roomId={roomId} conn={conn} onClose={() => setTurretOpen(false)} />}

        {/* task mini-game */}
        {activeTask && (
          <MiniGame task={activeTask} energy={onEnergy}
            onSolved={() => { conn.completeTask(roomId, activeTask.id); sfx.taskComplete(); setActiveTask(null); }}
            onCancel={() => { setActiveTask(null); sfx.click(); }} />
        )}

        {/* onboarding: contextual control hints + rotating tips (toggle-gated) */}
        {ctrl.showHints && <ControlHints hints={ctrl.hints} />}
        <TipBubble view={view} enabled={ctrl.showTips} />

        {/* bottom floating action bar */}
        <div style={hudBar}>
          {/* tasks here — only when you're standing on the task's ❗ marker */}
          {inCorridor ? (
            <span className="faint impactf" style={{ fontSize: 11, alignSelf: "center" }}>IN CORRIDOR</span>
          ) : reachableTasks.length > 0 ? reachableTasks.map((t) => (
            <button key={t.id} className="btn" style={{ fontSize: 12, padding: "10px 14px", textTransform: "none", borderColor: "var(--gold)" }} onClick={() => { conn.startTask(roomId, t.id); setActiveTask(t); sfx.click(); }}>
              ◆ {t.name}
            </button>
          )) : myTasks.length > 0
            ? <span className="faint impactf" style={{ fontSize: 11, alignSelf: "center" }}>WALK ONTO THE ❗ MARKER</span>
            : <span className="faint impactf" style={{ fontSize: 11, alignSelf: "center" }}>NO TASKS HERE</span>}

          <span style={{ width: 1, background: "var(--line)", alignSelf: "stretch", margin: "0 4px" }} />

          {!inCorridor && atRoomCenter && (map.refillRooms || []).includes(room) && <button className="btn" style={hudBtn} onClick={act(() => conn.refill(roomId))}>Refill O₂</button>}
          {!inCorridor && atRoomCenter && (map.repairRooms || []).includes(room) && <button className="btn" style={hudBtn} onClick={act(() => conn.repair(roomId))}>Repair</button>}
          {!inCorridor && room === "Airlock" && (
            <button className="btn" style={{ ...hudBtn, borderColor: "var(--volt)" }}
              onClick={act(() => conn.airlockDoor(roomId, !view.systems?.airlockDoorOpen))}>
              {view.systems?.airlockDoorOpen ? "🔒 Close Airlock Door" : "🚪 Open Airlock Door"}
            </button>
          )}
          {room === "Space" && (
            <span className="faint" style={{ fontSize: 11, alignSelf: "center" }}>
              {view.systems?.airlockDoorOpen ? "Door is open — get back inside!" : "⚠ Door sealed — you're stuck outside!"}
            </span>
          )}
          {!inCorridor && atRoomCenter && (map.turretRooms || []).includes(room) && view.globalAttack && (
            <button 
              className="btn btn-hot" 
              style={{ ...hudBtn, opacity: view.globalAttack.warning ? 0.6 : 1 }} 
              disabled={view.globalAttack.warning}
              onClick={act(() => setTurretOpen(true))}
            >
              {view.globalAttack.warning ? `Charging Turret... ${view.globalAttack.warningSeconds}s ⚡` : "Control Turret ☄"}
            </button>
          )}
          
          {!onEnergy && room === "Helm" && (
            <button className="btn btn-gold" style={hudBtn} onClick={act(() => setHelmOpen(true))}>
              Use Helm Console ⎈
            </button>
          )}
          {isImpostor && <button className="btn" style={{ ...hudBtn, borderColor: "var(--violet)" }} onClick={() => setSabOpen(true)}>妨害 Sabotage</button>}

          {here.map((p) => (
            <span key={p.id} className="row gap-s" style={{ padding: "4px 8px", border: `1px solid ${p.idColor?.hex || "var(--line)"}`, alignItems: "center" }}>
              <span style={{ ...crewDot, width: 10, height: 10, background: p.idColor?.hex || "var(--dim)" }} />
              <span style={{ fontSize: 12, fontWeight: 700 }}>{p.name}</span>
              {isImpostor && p.plane === you.plane && (
                <button 
                  className="btn" 
                  style={{ ...miniBtn, opacity: (view.you?.cableCooldown ?? 0) > 0 ? 0.5 : 1 }} 
                  disabled={(view.you?.cableCooldown ?? 0) > 0} 
                  onClick={pull(p.id)}
                >
                  {(view.you?.cableCooldown ?? 0) > 0 ? `Pull (${view.you.cableCooldown}s)` : "Pull"}
                </button>
              )}
            </span>
          ))}
        </div>

        {/* small corner minimap — zoomed to your room + nearby rooms */}
        <div style={{ position: "absolute", top: 14, right: 14, width: 210, height: 170, zIndex: 40,
          filter: "drop-shadow(0 6px 14px rgba(0,0,0,0.7))", pointerEvents: "none" }}>
          <MiniMap view={view} compact local />
        </div>
        <div style={{ position: "absolute", top: 188, right: 14, zIndex: 40, fontSize: 10, color: "var(--dim)", fontFamily: "var(--impact)", letterSpacing: "0.1em", pointerEvents: "none" }}>
          [M] FULL MAP
        </div>

        {/* M: full detailed map overlay — sizes to the viewport so it always fits */}
        {mapOpen && (
          <div style={{ position: "absolute", inset: 0, zIndex: 120, display: "grid", placeItems: "center", padding: "8vmin", background: "rgba(5,4,9,0.78)", backdropFilter: "blur(3px)" }}
            onClick={() => setMapOpen(false)}>
            <div style={{ width: "min(70vw, 760px)", maxHeight: "72vh", display: "flex", flexDirection: "column", padding: 18, background: "rgba(13,11,20,0.95)", border: "2px solid var(--gold)", boxShadow: "0 16px 60px rgba(0,0,0,0.8)" }}
              onClick={(e) => e.stopPropagation()}>
              <div className="row" style={{ justifyContent: "space-between", marginBottom: 10, flex: "0 0 auto" }}>
                <span className="display" style={{ fontSize: 22, color: "var(--gold)" }}>SHIP MAP</span>
                <span className="faint" style={{ fontSize: 11 }}>[M] or [Esc] to close</span>
              </div>
              <div style={{ flex: "1 1 auto", minHeight: 0, display: "flex" }}><MiniMap view={view} /></div>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
const WIN_REASON_TEXT = {
  all_impostors_down: "Every impostor was ejected.",
  reached_location: "The crew reached the landing zone.",
  hull_destroyed: "The hull was torn apart.",
  impostors_parity: "The impostors reached parity.",
  sabotage_unresolved: "A sabotage went unresolved.",
};

function Results({ view, roomId, conn, profile, onLeave, onChange }) {
  const won = view.winner === "crew";
  const you = view.you || {};
  const iWon = (won && you.role !== "impostor") || (!won && you.role === "impostor");
  const players = view.players || [];
  const impostors = players.filter((p) => p.role === "impostor");
  // XP mirrors the backend rule: base 50 + 75 if your side won.
  const xpGain = 50 + (iWon ? 75 : 0);
  const [rematchSent, setRematchSent] = useState(false);
  const isHost = you.id === view.hostId;

  useEffect(() => {
    onChange?.();
  }, [onChange]);

  // If the host rematches, the room flips back to lobby — Play's phase switch
  // handles the screen change; we just fire the action.
  const leave = () => { conn.disconnect(); setView(null); setRoomId(null); setEvents([]); onRoomStatus?.(false); onChange?.(); };
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
          <button className="btn" style={{ width: "100%", fontSize: 15 }} onClick={onLeave}>Return to Lobby</button>
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
const sidePane = { background: "transparent", padding: "22px 16px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 4, pointerEvents: "none" };
const leftCard = { background: "rgba(13,11,20,0.72)", border: "1px solid var(--line)", borderRadius: 6, padding: "12px 14px", marginBottom: 12, boxShadow: "0 6px 18px rgba(0,0,0,0.6)", backdropFilter: "blur(2px)", pointerEvents: "auto" };
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

/* Helm Menu Modal Custom Styles */
const helmOverlay = { position: "fixed", inset: 0, zIndex: 250, display: "grid", placeItems: "center", background: "rgba(5,4,9,0.55)", pointerEvents: "auto" };
const helmPanel = {
  width: 440,
  maxWidth: "94vw",
  background: "rgba(10, 8, 16, 0.98)",
  border: "2.5px solid var(--gold)",
  padding: "24px 28px",
  boxShadow: "0 0 30px rgba(255, 170, 0, 0.2)",
  clipPath: "polygon(0 0, calc(100% - 20px) 0, 100% 20px, 100% 100%, 20px 100%, 0 calc(100% - 20px))"
};
const sliderStyle = {
  width: "100%",
  accentColor: "var(--gold)",
  cursor: "pointer",
  height: 8,
  background: "rgba(255,255,255,0.1)",
  borderRadius: 4
};
const barBg = {
  width: "100%",
  height: 14,
  background: "rgba(255,255,255,0.05)",
  borderRadius: 3,
  overflow: "hidden",
  border: "1px solid rgba(255,255,255,0.1)",
  marginTop: 4
};
const barFillYellow = {
  height: "100%",
  background: "var(--gold)",
  transition: "width 0.15s ease-out"
};
const barFillCyan = {
  height: "100%",
  background: "var(--volt)",
  transition: "width 0.15s ease-out"
};

export function HelmMenu({ view, roomId, conn, onClose }) {
  const targetLevel = view.systems?.engineLevel ?? 0;
  const currentSpeed = view.systems?.engineSpeed ?? 0;

  // percentages:
  const targetPct = (targetLevel / 5) * 100;
  const targetShieldPct = 100 - targetPct;

  const currentPct = (currentSpeed / 5) * 100;
  const currentShieldPct = 100 - currentPct;

  return (
    <div style={helmOverlay} onClick={onClose}>
      <div style={helmPanel} onClick={(e) => e.stopPropagation()}>
        {/* Title */}
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 16 }}>
          <span className="kanji" style={{ fontSize: 16, color: "var(--gold)", fontWeight: 900, letterSpacing: 2 }}>操舵</span>
          <span className="display" style={{ fontSize: 24, fontWeight: 900, color: "#fff", letterSpacing: 1 }}>HELM THROTTLE</span>
        </div>

        {/* Labels: Shields vs Engines */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, fontWeight: 700, marginBottom: 8 }}>
          <span style={{ color: "var(--volt)" }}>◀ SHIELDS · slow & safe</span>
          <span style={{ color: "var(--hot)" }}>ENGINES · fast & exposed ▶</span>
        </div>

        {/* The interactive control slider */}
        <div style={{ position: "relative", marginBottom: 24, padding: "8px 0" }}>
          <input 
            type="range" 
            min="0" 
            max="5" 
            step="1" 
            value={targetLevel}
            onChange={(e) => conn.setEngineLevel(roomId, parseInt(e.target.value))}
            style={sliderStyle}
          />
        </div>

        {/* SET (target) bar */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontWeight: 700, color: "var(--gold)" }}>
            <span>SET (target)</span>
            <span>{Math.round(targetPct)}% engines</span>
          </div>
          <div style={barBg}>
            <div style={{ ...barFillYellow, width: `${targetPct}%` }} />
          </div>
        </div>

        {/* ACTUAL bar */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontWeight: 700, color: "var(--volt)" }}>
            <span>ACTUAL</span>
            <span>{Math.round(currentPct)}% engines</span>
          </div>
          <div style={barBg}>
            <div style={{ ...barFillCyan, width: `${currentPct}%` }} />
          </div>
        </div>

        {/* Now status */}
        <div className="impactf" style={{ textAlign: "center", fontSize: 14, fontWeight: 700, color: "#fff", marginBottom: 14 }}>
          now <span style={{ color: "var(--volt)" }}>{Math.round(currentShieldPct)}% shields</span> / <span style={{ color: "var(--hot)" }}>{Math.round(currentPct)}% engines</span>
        </div>

        {/* Mechanics Description */}
        <div className="faint" style={{ fontSize: 11, lineHeight: 1.4, color: "var(--dim)", textAlign: "center", marginBottom: 20, padding: "0 8px" }}>
          Slowing down is quick (~5s); speeding up takes longer (~15s). During an attack, more shields = less hull damage.
        </div>

        {/* Done Button */}
        <button 
          className="btn btn-gold" 
          style={{ width: "100%", padding: "12px 0", fontSize: 13, fontWeight: 900 }} 
          onClick={onClose}
        >
          DONE (ESC)
        </button>
      </div>
    </div>
  );
}

const incomingBannerStyle = {
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  background: "rgba(22, 5, 8, 0.96)",
  borderBottom: "2px solid var(--hot)",
  padding: "8px 16px",
  textAlign: "center",
  zIndex: 110,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  boxShadow: "0 2px 15px rgba(255,42,71,0.25)",
  pointerEvents: "none"
};

export function TurretMenu({ view, roomId, conn, onClose }) {
  const [activeShips, setActiveShips] = useState([]); // Array of { slot, expiresAt }
  const currentSpeed = view.systems?.engineSpeed ?? 0;
  // Ships stay on screen long enough to actually hit. Higher engine speed makes
  // them a bit quicker, but never so fast you can't react (clamped 1.4s–3s).
  const lifetime = Math.max(1400, 3000 - currentSpeed * 320);

  useEffect(() => {
    if (!view.globalAttack) {
      onClose();
      return;
    }

    const interval = setInterval(() => {
      setActiveShips((ships) => {
        const now = Date.now();
        let updated = ships.filter((s) => s.expiresAt > now);
        // Keep the grid lively: aim for 2-3 ships visible, spawn reliably.
        if (updated.length < 3 && Math.random() < 0.7) {
          const activeSlots = new Set(updated.map((s) => s.slot));
          const emptySlots = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter((i) => !activeSlots.has(i));
          if (emptySlots.length > 0) {
            const slot = emptySlots[Math.floor(Math.random() * emptySlots.length)];
            updated.push({ slot, expiresAt: now + lifetime });
          }
        }
        return updated;
      });
    }, 400);

    return () => clearInterval(interval);
  }, [view.globalAttack, lifetime, onClose]);

  const onWhack = (slot) => {
    const ship = activeShips.find((s) => s.slot === slot);
    if (!ship) return;
    sfx.slash();
    conn.shootTurret(roomId);
    setActiveShips((ships) => ships.filter((s) => s.slot !== slot));
  };

  // Keyboard: QWE/ASD/ZXC map to the 3x3 grid, and the numpad (7-8-9 / 4-5-6 /
  // 1-2-3) maps the same way so either hand works.
  useEffect(() => {
    const KEYMAP = {
      KeyQ: 0, KeyW: 1, KeyE: 2, KeyA: 3, KeyS: 4, KeyD: 5, KeyZ: 6, KeyX: 7, KeyC: 8,
      Numpad7: 0, Numpad8: 1, Numpad9: 2, Numpad4: 3, Numpad5: 4, Numpad6: 5, Numpad1: 6, Numpad2: 7, Numpad3: 8,
    };
    const onKey = (e) => {
      const slot = KEYMAP[e.code];
      if (slot === undefined) return;
      e.preventDefault();
      onWhack(slot);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeShips]); // eslint-disable-line

  const shipsLeft = view.globalAttack?.shipsLeft ?? 0;

  return (
    <div style={helmOverlay} onClick={onClose}>
      <div style={turretPanel} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="kanji" style={{ fontSize: 16, color: "var(--hot)", fontWeight: 900, letterSpacing: 2 }}>防衛</span>
            <span className="display" style={{ fontSize: 24, fontWeight: 900, color: "#fff", letterSpacing: 1 }}>TURRET GRID</span>
          </div>
          <span className="impactf" style={{ fontSize: 13, color: "var(--hot)" }}>{shipsLeft} SHIPS LEFT</span>
        </div>

        <div style={whackGridStyle}>
          {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => {
            const activeShip = activeShips.find((s) => s.slot === i);
            const KEYS = ["Q", "W", "E", "A", "S", "D", "Z", "X", "C"];
            return (
              <div 
                key={i} 
                onClick={() => onWhack(i)}
                style={{
                  ...gridSlotStyle,
                  position: "relative",
                  borderColor: activeShip ? "var(--hot)" : "rgba(255,255,255,0.08)",
                  background: activeShip ? "rgba(255,42,71,0.12)" : "rgba(255,255,255,0.02)",
                  boxShadow: activeShip ? "0 0 16px rgba(255,42,71,0.25)" : "none"
                }}
              >
                <span style={{ position: "absolute", top: 3, left: 5, fontSize: 9, color: "rgba(255,255,255,0.3)", fontFamily: "var(--impact)" }}>{KEYS[i]}</span>
                {activeShip && (
                  <span 
                    className="impactf" 
                    style={{ 
                      fontSize: 24, 
                      color: "var(--hot)", 
                      animation: "shipPulse 0.4s ease-in-out infinite alternate" 
                    }}
                  >
                    ☄
                  </span>
                )}
              </div>
            );
          })}
        </div>

        <div className="faint" style={{ fontSize: 11, textAlign: "center", color: "var(--dim)", marginBottom: 20 }}>
          Current engine speed: <span style={{ color: "var(--gold)" }}>{Math.round(currentSpeed * 20)}%</span>.<br />
          Higher speed = ships disappear faster!
        </div>

        <button 
          className="btn btn-ghost" 
          style={{ width: "100%", padding: "10px 0", fontSize: 12 }} 
          onClick={onClose}
        >
          CLOSE CONSOLE (ESC)
        </button>
      </div>

      <style>{`
        @keyframes shipPulse {
          0% { transform: scale(0.85); opacity: 0.8; }
          100% { transform: scale(1.15); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

const turretPanel = {
  width: 360,
  maxWidth: "92vw",
  background: "rgba(8, 5, 12, 0.99)",
  border: "2.5px solid var(--hot)",
  padding: "24px 24px",
  boxShadow: "0 0 35px rgba(255, 42, 71, 0.2)",
  clipPath: "polygon(0 0, calc(100% - 20px) 0, 100% 20px, 100% 100%, 20px 100%, 0 calc(100% - 20px))"
};

const whackGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(3, 1fr)",
  gap: 12,
  marginBottom: 20,
  aspectRatio: "1"
};

const gridSlotStyle = {
  border: "2px solid",
  borderRadius: 8,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  transition: "all 0.15s ease",
  userSelect: "none"
};
