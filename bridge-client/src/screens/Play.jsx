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
import TrollScreen from "../components/TrollScreen.jsx";
import TurretGame from "../components/TurretGame.jsx";
import { useEmotes, EmoteWheel } from "../components/Emotes.jsx";
import { playSound } from "../util/sound.js";
import { SOUND_EVENTS } from "../util/soundEvents.js";
import { isDecoyCode, makeDecoyCode } from "../util/troll.js";
import * as api from "../api/backend.js";

// Play: connects to the game server, hosts the lobby, then renders the live
// match driven by the server's per-player "state" stream. Classic mode focus —
// no event/mode pickers here. Real Socket.IO throughout.
export default function Play({ user, profile, onMatchActiveChange }) {
  const [conn, setConn] = useState(null);
  const [connected, setConnected] = useState(false);
  const [view, setView] = useState(null);     // redacted match view from server
  const [roomId, setRoomId] = useState(null);
  const [error, setError] = useState(null);
  const [joinCode, setJoinCode] = useState("");
  const [troll, setTroll] = useState(false);
  const [streamerMode, setStreamerMode] = useState(false);
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
          // play a sound cue for recognized gameplay events (silent if no file)
          const cue = SOUND_EVENTS[e.type];
          if (cue) { seenEvents.current.add(key); playSound(cue); }
          if (e.type === "player_eliminated") {
            seenEvents.current.add(key);
            setFlash({ text: "追放", sub: "PILOT EJECTED", color: "var(--hot)" });
          }
          if ((e.type === "player_left" || e.type === "player_surrendered") && e.name) {
            seenEvents.current.add(key);
            const verb = e.type === "player_surrendered" ? "surrendered" : "left the ship";
            setFlash({ text: "離脱", sub: `${e.name} ${verb}`, color: "var(--dim)" });
          }
        }
        if (seenEvents.current.size > 200) seenEvents.current = new Set();
      },
      onError: (m) => { setError(m); setTimeout(() => setError(null), 2600); },
      onConnect: () => setConnected(true),
      onDisconnect: () => setConnected(false),
    });
    setConn(c);
    // load the player's streamer-mode preference (affects lobby code display)
    api.getSettings?.().then((s) => setStreamerMode(!!s?.privacy?.streamerMode)).catch(() => {});
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
    const code = joinCode.trim().toUpperCase();
    // Streamer-mode decoy: a code with a "forbidden" char is a stream troll bait.
    if (isDecoyCode(code)) { setTroll(true); return; }
    const res = await conn.joinRoom(code, user.name);
    if (res.error) return setError(res.error);
    setRoomId(res.roomId);
  };
  const joinRandom = async () => {
    const res = await conn.joinRandom(user.name);
    if (res.error) return setError(res.error);
    setRoomId(res.roomId);
  };

  const inMatch = view && (view.phase === "active" || view.phase === "draft" || view.phase === "ended");
  // Tell the shell when we're in actual gameplay (active/draft) so it can hide the
  // nav rail; the lobby and results keep it. Cleared on unmount.
  const gameplay = view && (view.phase === "active" || view.phase === "draft");
  useEffect(() => { onMatchActiveChange?.(!!gameplay); }, [gameplay, onMatchActiveChange]);
  useEffect(() => () => onMatchActiveChange?.(false), []); // eslint-disable-line

  return (
    <div style={wrap}>
      {troll && <TrollScreen onExit={() => { setTroll(false); setJoinCode(""); }} />}
      <SpeedLines hot={inMatch} />
      {flash && <KanjiFlash {...flash} onDone={() => setFlash(null)} />}
      {error && <div style={toast}>{error}</div>}

      <div style={{ position: "relative", zIndex: 2, height: "100%" }}>
        {!roomId && <LobbyEntry connected={connected} joinCode={joinCode} setJoinCode={setJoinCode}
          onCreate={create} onJoinCode={joinByCode} onRandom={joinRandom} />}
        {roomId && !inMatch && <LobbyRoom view={view} roomId={roomId} conn={conn} isHost={view?.you?.id === view?.hostId} streamerMode={streamerMode} />}
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
function LobbyRoom({ view, roomId, conn, isHost, streamerMode }) {
  const players = view?.players || [];
  const min = view?.map?.minPlayers || 5;
  const enough = players.length >= min;
  // Streamer mode: don't show the real code on screen. Show a believable DECOY
  // (which routes anyone who types it to the troll), and let the host briefly
  // reveal the real code with a button.
  const [revealed, setRevealed] = useState(false);
  const [decoy] = useState(() => makeDecoyCode());
  useEffect(() => {
    if (!revealed) return;
    const t = setTimeout(() => setRevealed(false), 4000); // reveal for 4s
    return () => clearTimeout(t);
  }, [revealed]);
  const showReal = !streamerMode || revealed;
  const shownCode = showReal ? roomId : decoy;

  return (
    <div style={{ padding: "32px 40px", height: "100%", display: "grid", gridTemplateColumns: "1fr 340px", gap: 24 }}>
      <div>
        <div className="tag"><span>Briefing room</span></div>
        <div className="row" style={{ alignItems: "baseline", gap: 16, marginTop: 10 }}>
          <span className="display" style={{ fontSize: 30 }}>JOIN CODE</span>
          <span className="display" style={{ fontSize: 64, letterSpacing: "0.1em",
            color: showReal ? "var(--hot)" : "var(--dim)", filter: showReal ? "none" : "blur(0px)" }}>{shownCode}</span>
          {streamerMode && (
            <button className="btn btn-ghost" style={{ fontSize: 12, padding: "6px 12px" }}
              onClick={() => setRevealed((r) => !r)}>{revealed ? "Hide" : "Reveal"}</button>
          )}
        </div>
        {streamerMode
          ? <div className="dim" style={{ marginBottom: 20 }}>🔒 Streamer mode on — the code shown is a <b>decoy</b>. Use Reveal to read the real one, or share it privately. {players.length}/{view?.map?.maxPlayers} aboard.</div>
          : <div className="dim" style={{ marginBottom: 20 }}>Share this code with your squad. {players.length}/{view?.map?.maxPlayers} aboard.</div>}

        {/* HOST CONTROLS pinned at the top so they don't shift as the roster grows
            and shrinks while people join/leave. */}
        {isHost && (
          <div style={{ marginBottom: 20, padding: "14px 16px", border: "2px solid var(--line)", background: "rgba(13,11,20,0.5)" }}>
            <button className="btn btn-hot" style={{ width: "100%", fontSize: 18, marginBottom: 12 }} disabled={!enough}
              onClick={() => conn.startDraft(roomId)}>
              {enough ? "Begin Perk Draft →" : `Need ${min - players.length} more pilot${min - players.length === 1 ? "" : "s"}`}
            </button>
            {players.length < (view?.map?.maxPlayers || 99) && (
              <div>
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
          </div>
        )}
        {!isHost && <div className="impactf dim" style={{ marginBottom: 20, letterSpacing: "0.1em" }}>WAITING FOR HOST TO LAUNCH…</div>}

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
      </div>

      <div className="panel" style={{ padding: 18, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14 }}>
        <div className="kanji" style={{ fontSize: 28, color: "var(--volt)", opacity: 0.8 }}>待機</div>
        <div className="display" style={{ fontSize: 22, textAlign: "center" }}>STANDING BY</div>
        <div style={{ fontSize: 52, fontWeight: 800, color: "var(--hot)", lineHeight: 1 }}>{players.length}<span className="faint" style={{ fontSize: 22 }}>/{view?.map?.maxPlayers}</span></div>
        <div className="faint" style={{ fontSize: 12, textAlign: "center" }}>pilots aboard</div>
        <div className="faint" style={{ fontSize: 11, textAlign: "center", marginTop: 6, opacity: 0.7 }}>
          The ship layout is revealed when the match begins — every voyage is different.
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
function Match({ view, roomId, conn, events }) {
  const { pop, layer } = useImpact();
  const [voteOpen, setVoteOpen] = useState(false);
  const [sabOpen, setSabOpen] = useState(false);
  const [escOpen, setEscOpen] = useState(false);
  const [activeTask, setActiveTask] = useState(null);
  const [throttleOpen, setThrottleOpen] = useState(false);
  const comms = useComms({ view, roomId, conn, events });
  const emotes = useEmotes({ roomId, conn, events });
  const ctrl = useControls({
    view, roomId, conn,
    taskOpen: !!activeTask,
    onOpenTask: (t) => setActiveTask(t),
    onOpenSabotage: () => setSabOpen(true),
    onOpenThrottle: () => setThrottleOpen(true),
  });
  // Esc closes whatever interactable is open FIRST (minigame, throttle, wheels,
  // sabotage menu); only if nothing is open does it open the pause/options menu.
  // V = vote, Z = emote wheel. Ignored while typing.
  useEffect(() => {
    const onKey = (e) => {
      if (e.target && /input|textarea/i.test(e.target.tagName)) return;
      if (e.code === "Escape") {
        e.preventDefault();
        if (activeTask) { setActiveTask(null); return; }
        if (throttleOpen) { setThrottleOpen(false); return; }
        if (sabOpen) { setSabOpen(false); return; }
        if (comms.open) { comms.setOpen(false); return; }
        if (emotes.open) { emotes.setOpen(false); return; }
        if (voteOpen) { setVoteOpen(false); return; }
        setEscOpen((o) => !o);
      }
      else if (e.code === "KeyV" && !activeTask) { e.preventDefault(); setVoteOpen((o) => !o); }
      else if (e.code === "KeyZ" && !activeTask) { e.preventDefault(); emotes.setOpen((o) => !o); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeTask, throttleOpen, sabOpen, comms, emotes, voteOpen]);
  const you = view.you || {};
  const room = you.room;
  const map = view.map || {};
  const here = (view.players || []).filter((p) => p.room === room && p.id !== you.id);
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
          <div className="impactf faint" style={{ fontSize: 11, letterSpacing: "0.12em", marginBottom: 6 }}>POWER BALANCE</div>
          <div className="row gap-s" style={{ alignItems: "center" }}>
            <Sys on={view.systems?.oxygenOn} label="O₂" />
            <span className="faint" style={{ fontSize: 10 }}>SHLD</span>
            <div style={{ flex: 1, height: 10, background: "var(--ink)", border: "1px solid var(--line)", position: "relative" }}>
              <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${(1 - (view.systems?.allocation ?? 0.5)) * 100}%`, background: "var(--volt)", opacity: 0.8 }} />
              <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: `${(view.systems?.allocation ?? 0.5) * 100}%`, background: "var(--gold)", opacity: 0.8 }} />
            </div>
            <span className="faint" style={{ fontSize: 10 }}>ENG</span>
          </div>
          <div className="faint" style={{ fontSize: 10, marginTop: 4 }}>
            {Math.round((1 - (view.systems?.allocation ?? 0.5)) * 100)}% shields · {Math.round((view.systems?.allocation ?? 0.5) * 100)}% engines{view.systems?.ramping ? " · adjusting…" : ""}
          </div>
        </div>

        {/* TASK TRACKER: shows every assigned task + which room it's in, so players
            know where to walk. The one in your current room is highlighted and is
            startable from the bottom bar / E key. Impostors see fake tasks too (to
            blend in), matching how the engine assigns them. */}
        {(you.tasks || []).length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div className="impactf faint" style={{ fontSize: 11, letterSpacing: "0.12em", marginBottom: 6 }}>
              YOUR TASKS{isImpostor && <span style={{ color: "var(--violet)", marginLeft: 6 }}>(cover)</span>}
            </div>
            <div className="col" style={{ gap: 5 }}>
              {(you.tasks || []).map((t) => {
                const hereNow = t.room === room && !t.done;
                return (
                  <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5,
                    padding: "4px 8px", border: `1px solid ${hereNow ? "var(--gold)" : "var(--line)"}`,
                    background: hereNow ? "rgba(255,200,61,0.08)" : "transparent", opacity: t.done ? 0.45 : 1 }}>
                    <span style={{ color: t.done ? "var(--volt)" : hereNow ? "var(--gold)" : "var(--dim)" }}>{t.done ? "✓" : "◆"}</span>
                    <span style={{ flex: 1, textDecoration: t.done ? "line-through" : "none" }}>{t.name}</span>
                    <span className="impactf" style={{ fontSize: 9, color: hereNow ? "var(--gold)" : "var(--dim)" }}>{t.room}</span>
                  </div>
                );
              })}
            </div>
            <div className="faint" style={{ fontSize: 10, marginTop: 5 }}>Walk to a task's room, then press E (or the button below).</div>
          </div>
        )}
      </div>

      {/* CENTER: the isometric playfield (click to move) with a floating HUD */}
      <div style={{ position: "relative", overflow: "hidden" }}>
        <IsoStage view={view} emoteBubbles={emotes.bubbles} />

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
            <button className="btn" style={{ fontSize: 13, padding: "8px 14px", borderColor: "var(--gold)" }} onClick={() => emotes.setOpen(true)}>😊 EMOTE</button>
            <button className="btn btn-hot" style={{ fontSize: 13, padding: "8px 16px" }} onClick={() => setVoteOpen(true)}>
              投票 EJECT VOTE
              {view.you?.myVote && <span style={{ marginLeft: 8, fontSize: 10 }}>● VOTED</span>}
            </button>
          </div>
        </div>

        {/* incoming comms captions */}
        <CaptionStream captions={comms.captions} />
        {comms.open && <CommsRadial wheel={comms.wheel} fire={comms.fire} onClose={() => comms.setOpen(false)} />}
        {emotes.open && <EmoteWheel onFire={emotes.fire} onClose={() => emotes.setOpen(false)} />}

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

        {/* ATTACK WARNING: 10s heads-up (like a sabotage alert) — rush to Helm + turrets. */}
        {view.attackWarning && (
          <div style={{ position: "absolute", top: 40, left: "50%", transform: "translateX(-50%)", zIndex: 75,
            display: "flex", alignItems: "center", gap: 12, padding: "10px 20px",
            background: "rgba(40,6,10,0.95)", border: "2px solid var(--hot)", animation: "pulse 1s infinite",
            boxShadow: "0 0 30px rgba(255,45,77,0.5)" }}>
            <span className="kanji" style={{ fontSize: 22, color: "var(--hot)" }}>警告</span>
            <div>
              <div className="display" style={{ fontSize: 18, lineHeight: 1, color: "var(--hot)" }}>ATTACK INBOUND · {view.attackWarning.secondsLeft}s</div>
              <div className="impactf" style={{ fontSize: 11 }}>Get to the Helm (shields up!) and man the turrets</div>
            </div>
          </div>
        )}

        {/* HELM throttle: an interactable — walk to the Helm, press E to open this
            modal, adjust the SHIELDS↔ENGINES balance, Esc to close. The ship ramps
            to the new setting gradually. */}
        {throttleOpen && room === view.helm?.room && !onEnergy && (
          <div style={{ position: "fixed", inset: 0, zIndex: 220, display: "grid", placeItems: "center", background: "rgba(5,4,9,0.55)" }}
            onClick={(e) => { if (e.target === e.currentTarget) setThrottleOpen(false); }}>
            <div style={{ width: 420, maxWidth: "90vw", padding: "22px 24px", background: "rgba(13,11,20,0.98)", border: "2px solid var(--gold)",
              clipPath: "polygon(0 0,calc(100% - 16px) 0,100% 16px,100% 100%,16px 100%,0 calc(100% - 16px))" }}>
              <div className="kanji" style={{ fontSize: 16, color: "var(--gold)" }}>操舵</div>
              <div className="display" style={{ fontSize: 26, marginBottom: 14, color: "var(--gold)" }}>HELM THROTTLE</div>
              <div className="row" style={{ justifyContent: "space-between", fontSize: 11, marginBottom: 4 }}>
                <span className="faint" style={{ color: "var(--volt)" }}>◀ SHIELDS · slow & safe</span>
                <span className="faint" style={{ color: "var(--gold)" }}>ENGINES · fast & exposed ▶</span>
              </div>
              <input type="range" min={0} max={100} value={Math.round((view.systems?.targetAllocation ?? 0.5) * 100)}
                onChange={(e) => conn.setAllocation(roomId, Number(e.target.value) / 100)}
                style={{ width: "100%", accentColor: "var(--gold)", margin: "8px 0", height: 24 }} />
              <div style={{ textAlign: "center", fontSize: 13, margin: "6px 0" }}>
                <b style={{ color: "var(--volt)" }}>{Math.round((1 - (view.systems?.allocation ?? 0.5)) * 100)}%</b> shields
                &nbsp;/&nbsp;
                <b style={{ color: "var(--gold)" }}>{Math.round((view.systems?.allocation ?? 0.5) * 100)}%</b> engines
                {view.systems?.ramping && <span className="faint"> · ramping…</span>}
              </div>
              <div className="faint" style={{ fontSize: 11, textAlign: "center", marginTop: 6 }}>
                Slowing down is quick (~5s); speeding up takes longer (~15s). During an attack, more shields = less hull damage.
              </div>
              <button className="btn btn-ghost" style={{ width: "100%", marginTop: 14, fontSize: 13 }} onClick={() => setThrottleOpen(false)}>Done (Esc)</button>
            </div>
          </div>
        )}

        {/* in-game ESC menu: resume / surrender (with confirm). Replaces the nav
            rail, which is hidden during a match. */}
        {escOpen && <EscMenu onResume={() => setEscOpen(false)}
          onSurrender={() => { conn.surrender(roomId); setEscOpen(false); }} />}

        {/* ATTACK WAVE: banner + turret combat. Shows when enemy planes are inbound. */}
        {view.attack && (
          <div style={{ position: "absolute", top: 70, left: "50%", transform: "translateX(-50%)", zIndex: 70,
            display: "flex", alignItems: "center", gap: 14, padding: "10px 18px",
            background: "rgba(40,6,10,0.92)", border: "2px solid var(--hot)", boxShadow: "0 0 24px rgba(255,45,77,0.4)" }}>
            <span className="kanji" style={{ fontSize: 20, color: "var(--hot)" }}>襲来</span>
            <div>
              <div className="display" style={{ fontSize: 20, lineHeight: 1, color: "var(--hot)" }}>ENEMY WAVE</div>
              <div className="impactf" style={{ fontSize: 12 }}>{view.attack.planesLeft} / {view.attack.swarmSize} planes left · {view.attack.secondsLeft}s</div>
            </div>
            <div style={{ width: 120, height: 8, background: "var(--ink)", border: "1px solid var(--hot)" }}>
              <div style={{ height: "100%", width: `${100 - (view.attack.planesLeft / view.attack.swarmSize) * 100}%`, background: "var(--hot)" }} />
            </div>
          </div>
        )}

        {/* TURRET controls: appear when you're standing in a turret room. Man it,
            then fire at the swarm. One pilot per turret (server-enforced). */}
        {(map.turretRooms || []).includes(room) && !onEnergy && (
          <div style={{ position: "absolute", top: 150, left: "50%", transform: "translateX(-50%)", zIndex: 70,
            display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "12px 18px",
            background: "rgba(13,11,20,0.94)", border: "2px solid var(--volt)" }}>
            <div className="impactf" style={{ fontSize: 12, color: "var(--volt)" }}>{room}{view.yourTurret === room ? " · MANNED" : ""}</div>
            {view.yourTurret === room ? (
              <>
                {view.attack
                  ? <TurretGame planesDowned={view.planesDowned} onHit={() => conn.shootPlane(roomId)} />
                  : <div className="faint" style={{ fontSize: 12, padding: "8px 0" }}>No incoming wave. Stay manned — ships will come.</div>}
                <button className="btn btn-ghost" style={{ fontSize: 11, padding: "4px 10px" }} onClick={() => conn.leaveTurret(roomId)}>Leave turret</button>
              </>
            ) : (
              <button className="btn" style={{ fontSize: 14, padding: "8px 18px", borderColor: "var(--volt)" }}
                onClick={() => conn.enterTurret(roomId)}>Man this turret</button>
            )}
          </div>
        )}

        {/* AIRLOCK distress: all living crew see who's trapped outside banging for help. */}
        {(view.airlock?.distress || []).length > 0 && !onEnergy && (
          <div style={{ position: "absolute", top: 116, left: "50%", transform: "translateX(-50%)", zIndex: 72,
            padding: "8px 16px", background: "rgba(40,6,10,0.92)", border: "2px solid var(--hot)" }}>
            <span className="impactf" style={{ fontSize: 12, color: "var(--hot)" }}>
              🆘 {view.airlock.distress.map((d) => d.name).join(", ")} trapped outside the airlock!
            </span>
          </div>
        )}

        {/* AIRLOCK controls: appear in the airlock room. Go outside / come in,
            solder (outside), bang for help (trapped), impostor lock, crew unlock. */}
        {room === view.airlock?.room && !onEnergy && (
          <div style={{ position: "absolute", top: 150, left: "50%", transform: "translateX(-50%)", zIndex: 70,
            display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "12px 18px",
            background: "rgba(13,11,20,0.94)", border: `2px solid ${view.airlock.locked ? "var(--hot)" : "var(--volt)"}` }}>
            <div className="impactf" style={{ fontSize: 12, color: view.airlock.locked ? "var(--hot)" : "var(--volt)" }}>
              AIRLOCK {view.airlock.locked ? "· LOCKED 🔒" : ""}{view.airlock.youOutside ? " · YOU'RE OUTSIDE" : ""}
            </div>
            {!view.airlock.youOutside ? (
              <div className="row gap-s" style={{ flexWrap: "wrap", justifyContent: "center" }}>
                <button className="btn" style={{ fontSize: 13, padding: "8px 14px", borderColor: "var(--volt)" }}
                  disabled={view.airlock.locked} onClick={() => conn.goOutside(roomId)}>Go outside ↗</button>
                {view.airlock.locked && <button className="btn" style={{ fontSize: 13, padding: "8px 14px", borderColor: "var(--gold)" }}
                  onClick={() => conn.unlockAirlock(roomId)}>Unlock door 🔓</button>}
                {isImpostor && !view.airlock.locked && <button className="btn" style={{ fontSize: 13, padding: "8px 14px", borderColor: "var(--violet)" }}
                  onClick={() => conn.lockAirlock(roomId)}>Lock door 🔒</button>}
              </div>
            ) : (
              <div className="col" style={{ gap: 6, alignItems: "center" }}>
                <div className="faint" style={{ fontSize: 11, color: "var(--hot)" }}>⚠ Oxygen burning fast out here</div>
                <div className="row gap-s">
                  <button className="btn" style={{ fontSize: 13, padding: "8px 14px", borderColor: "var(--gold)" }}
                    onClick={() => conn.solderOutside(roomId)}>Solder hull 🔧</button>
                  <button className="btn" style={{ fontSize: 13, padding: "8px 14px", borderColor: "var(--volt)" }}
                    disabled={view.airlock.locked} onClick={() => conn.comeInside(roomId)}>Come in ↙</button>
                </div>
                {view.airlock.locked && <button className="btn btn-hot" style={{ fontSize: 14, padding: "8px 18px" }}
                  onClick={() => conn.bangDoor(roomId)}>🆘 BANG FOR HELP</button>}
              </div>
            )}
          </div>
        )}

        {/* bottom floating action bar — slim. Tasks are now in-world ('!' markers,
            press E). This bar only shows contextual actions for where you are. */}
        {((map.refillRooms || []).includes(room) || (map.repairRooms || []).includes(room) || isImpostor || here.length > 0) && (
          <div style={hudBar}>
            {(map.refillRooms || []).includes(room) && <button className="btn" style={hudBtn} onClick={act(() => conn.refill(roomId))}>Refill O₂</button>}
            {(map.repairRooms || []).includes(room) && <button className="btn" style={hudBtn} onClick={act(() => conn.repair(roomId))}>Repair</button>}
            {isImpostor && <button className="btn" style={{ ...hudBtn, borderColor: "var(--violet)" }} onClick={() => setSabOpen(true)}>妨害 Sabotage</button>}
            {here.map((p) => (
              <span key={p.id} className="row gap-s" style={{ padding: "4px 8px", border: `1px solid ${p.idColor?.hex || "var(--line)"}`, alignItems: "center" }}>
                <span style={{ ...crewDot, width: 10, height: 10, background: p.idColor?.hex || "var(--dim)" }} />
                <span style={{ fontSize: 12, fontWeight: 700 }}>{p.name}</span>
                {isImpostor && p.plane === you.plane && <button className="btn" style={miniBtn} onClick={act(() => conn.detachCable(roomId, p.id))}>Pull</button>}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* RIGHT: minimap */}
      <div style={{ ...sidePane, borderLeft: "2px solid var(--line)", borderRight: "none" }}>
        <MiniMap view={view} compact />
        <div className="faint" style={{ fontSize: 12, marginTop: 14 }}>WASD to move. Walk to a yellow ❗ and press E to do a task. Visit the Helm to set the throttle.</div>
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

  // Pull the unlock ladder + cosmetics so we can show what the NEXT level grants
  // and a progress bar projecting the XP just earned this match.
  const [ladder, setLadder] = useState(null);
  const [cosmeticsById, setCosmeticsById] = useState({});
  useEffect(() => {
    api.getCatalogue?.().then((c) => {
      setLadder(c?.ladder || {});
      const map = {}; for (const cz of (c?.cosmetics || [])) map[cz.id] = cz; setCosmeticsById(map);
    }).catch(() => {});
  }, []);

  // progression math (projected with this match's XP)
  let prog = null;
  if (profile && profile.nextLevelAt != null) {
    const bandStart = profile.nextLevelAt - profile.xpToNext;          // xp at start of this level
    const projectedXp = profile.xp + xpGain;
    const pct = Math.max(0, Math.min(100, ((projectedXp - bandStart) / (profile.nextLevelAt - bandStart)) * 100)) || 0;
    const willLevel = projectedXp >= profile.nextLevelAt;
    const nextLvl = profile.level + 1;
    const nextDef = ladder ? ladder[nextLvl] : null;
    prog = { pct, willLevel, nextLvl, nextDef, remaining: Math.max(0, profile.nextLevelAt - projectedXp) };
  }

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
          {profile && prog && (
            <div className="panel" style={{ padding: 16, marginBottom: 24 }}>
              <div className="row" style={{ justifyContent: "space-between", fontSize: 13, marginBottom: 8 }}>
                <span className="impactf">LV {profile.level}</span>
                <span className="impactf" style={{ color: prog.willLevel ? "var(--gold)" : "var(--dim)" }}>
                  {prog.willLevel ? "LEVEL UP!" : `LV ${prog.nextLvl}`}
                </span>
              </div>
              {/* progress bar toward the next level (projected with this match's XP) */}
              <div style={{ height: 12, background: "var(--ink)", border: "1px solid var(--line)", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${prog.pct}%`, background: prog.willLevel ? "var(--gold)" : "linear-gradient(90deg,var(--volt),var(--gold))", transition: "width 0.6s ease" }} />
              </div>
              <div className="faint" style={{ fontSize: 11, marginTop: 6 }}>
                {prog.willLevel
                  ? `You've reached Level ${prog.nextLvl}! New rewards unlocked.`
                  : `${prog.remaining.toLocaleString()} XP to Level ${prog.nextLvl}`}
              </div>
              {/* what the next level unlocks */}
              {prog.nextDef && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
                  <div className="impactf faint" style={{ fontSize: 10, letterSpacing: "0.12em", marginBottom: 6 }}>LV {prog.nextLvl} UNLOCKS</div>
                  <div className="impactf" style={{ fontSize: 12, color: "var(--paper)", marginBottom: 6 }}>{prog.nextDef.note || "New gear"}</div>
                  <div className="col gap-s">
                    {(prog.nextDef.grants || []).map((id) => (
                      <div key={id} className="row gap-s" style={{ fontSize: 12, fontWeight: 600 }}>
                        <span style={{ width: 6, height: 6, background: "var(--gold)", display: "inline-block" }} />
                        <span>{cosmeticsById[id]?.name || id}</span>
                      </div>
                    ))}
                    {(prog.nextDef.slots || []).map((s) => (
                      <div key={s} className="row gap-s" style={{ fontSize: 12, fontWeight: 600, color: "var(--volt)" }}>
                        <span style={{ width: 6, height: 6, background: "var(--volt)", display: "inline-block" }} />
                        <span>New slot: {s}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
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
function EscMenu({ onResume, onSurrender }) {
  const [confirmSurrender, setConfirmSurrender] = useState(false);
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 400, display: "grid", placeItems: "center", background: "rgba(5,4,9,0.7)", backdropFilter: "blur(3px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onResume(); }}>
      <div style={{ width: 320, maxWidth: "90vw", background: "rgba(13,11,20,0.98)", border: "2px solid var(--line)", padding: "22px 22px 18px",
        clipPath: "polygon(0 0,calc(100% - 16px) 0,100% 16px,100% 100%,16px 100%,0 calc(100% - 16px))" }}>
        <div className="kanji" style={{ fontSize: 18, color: "var(--volt)", marginBottom: 2 }}>一時停止</div>
        <div className="display" style={{ fontSize: 30, lineHeight: 0.9, marginBottom: 18 }}>PAUSED</div>
        <button className="btn" style={{ width: "100%", marginBottom: 10, padding: "12px", fontSize: 14, borderColor: "var(--volt)" }} onClick={onResume}>Resume (Esc)</button>
        {!confirmSurrender ? (
          <button className="btn btn-hot" style={{ width: "100%", padding: "12px", fontSize: 14 }} onClick={() => setConfirmSurrender(true)}>Surrender</button>
        ) : (
          <div style={{ border: "1px solid var(--hot)", padding: "12px", marginTop: 4 }}>
            <div style={{ fontSize: 13, marginBottom: 10 }}>Surrender for real? You'll leave the match and your team plays on without you.</div>
            <div className="row gap-s">
              <button className="btn btn-ghost" style={{ flex: 1, fontSize: 13, padding: "8px" }} onClick={() => setConfirmSurrender(false)}>Cancel</button>
              <button className="btn btn-hot" style={{ flex: 1, fontSize: 13, padding: "8px" }} onClick={onSurrender}>Yes, surrender</button>
            </div>
          </div>
        )}
        <div className="faint" style={{ fontSize: 10, marginTop: 14, textAlign: "center" }}>Esc to resume · V to vote · WASD to move</div>
      </div>
    </div>
  );
}

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
