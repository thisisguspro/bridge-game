import { useEffect, useRef, useState } from "react";
import * as backend from "../api/backend.js";

// Live in-match comms. Two parts:
//  1) RADIAL: hold the comms key (default C) to open an 8-slot wheel of the
//     player's bound voice commands; release on a slot (or click) to send it.
//     Sends through conn.voiceCommand — the engine scopes who hears it.
//  2) CAPTIONS: a stream of incoming `comm` events (the engine already delivers
//     only to valid recipients, enforcing proximity + "living never hear downed").
//
// Voice-command display labels + emojis mirror the engine's VOICE_COMMANDS.
const CMD = {
  SOS: { label: "SOS", emoji: "🆘" }, HELP_TASK: { label: "Help w/ Task", emoji: "🛠️" },
  SABOTAGE_HERE: { label: "Sabotage Here", emoji: "⚠️" }, REFILL_HERE: { label: "Refill Here", emoji: "🫧" },
  FOLLOW_ME: { label: "Follow Me", emoji: "👋" }, SUSPECT: { label: "Suspect!", emoji: "🤨" },
  CLEAR: { label: "Clear", emoji: "✅" }, ON_MY_WAY: { label: "On My Way", emoji: "🏃" },
  YES: { label: "Yes", emoji: "👍" }, NO: { label: "No", emoji: "👎" },
};

export function useComms({ view, roomId, conn, events }) {
  const [wheel, setWheel] = useState(null);        // bound comms slots (8)
  const [open, setOpen] = useState(false);
  const [captions, setCaptions] = useState([]);    // {id,text,emoji,by}
  const captionTimers = useRef({});
  const playersById = Object.fromEntries((view?.players || []).map((p) => [p.id, p]));

  // load the player's comms wheel once
  useEffect(() => {
    backend.getSettings().then((d) => setWheel(d.wheels?.comms || [])).catch(() => setWheel([]));
  }, []);

  // hold the comms key to open the radial
  useEffect(() => {
    const down = (e) => { if ((e.code === "KeyC") && !e.repeat) setOpen(true); };
    const up = (e) => { if (e.code === "KeyC") setOpen(false); };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, []);

  // turn incoming comm events into transient captions
  useEffect(() => {
    if (!events) return;
    for (const e of events) {
      if (e.type !== "comm") continue;
      const key = `${e.by}:${e.command}:${e.at ?? e.t ?? ""}`;
      if (captionTimers.current[key]) continue;
      const speaker = playersById[e.by];
      const meta = CMD[e.command] || { label: e.command, emoji: "💬" };
      let text = meta.label;
      if (e.param === speaker?.room || (typeof e.param === "string" && e.command.endsWith("_HERE"))) text += ` (${e.param})`;
      else if (e.command === "SUSPECT" || e.command === "CLEAR") { const t = playersById[e.param]; if (t) text += ` ${t.name}`; }
      const cap = { id: key, text, emoji: meta.emoji, by: speaker?.name || "Someone", color: speaker?.idColor?.hex || "var(--volt)" };
      setCaptions((c) => [...c.slice(-4), cap]);
      captionTimers.current[key] = setTimeout(() => {
        setCaptions((c) => c.filter((x) => x.id !== key));
      }, 5000);
    }
  }, [events]); // eslint-disable-line

  const fire = (cmdKey) => {
    if (!cmdKey) return;
    // commands that need a target/room: the engine resolves room from the
    // speaker; player-targeted ones (SUSPECT/CLEAR) use the nearest other pilot.
    let targetId = null;
    if (cmdKey === "SUSPECT" || cmdKey === "CLEAR") {
      const near = (view.players || []).find((p) => p.id !== view.you.id && p.room === view.you.room && p.plane === view.you.plane);
      targetId = near?.id || null;
    }
    conn.voiceCommand(roomId, cmdKey, targetId);
    setOpen(false);
  };

  return { wheel, open, setOpen, captions, fire };
}

// The radial overlay (rendered when `open`).
export function CommsRadial({ wheel, fire, onClose }) {
  const slots = wheel || [];
  const R = 130, cx = 170, cy = 170;
  return (
    <div style={overlay} onClick={onClose}>
      <svg viewBox="0 0 340 340" style={{ width: 340, maxWidth: "80vw" }} onClick={(e) => e.stopPropagation()}>
        <circle cx={cx} cy={cy} r={R + 30} fill="rgba(13,11,20,0.85)" stroke="var(--volt)" strokeWidth="2" />
        <circle cx={cx} cy={cy} r="40" fill="var(--ink-2)" stroke="var(--line)" strokeWidth="2" />
        <text x={cx} y={cy - 2} textAnchor="middle" className="kanji" fontSize="15" fill="var(--volt)">声</text>
        <text x={cx} y={cy + 14} textAnchor="middle" fontSize="8" fill="var(--dim)" fontFamily="Russo One">COMMS</text>
        {slots.map((cmd, i) => {
          if (!cmd) return null;
          const ang = (i / slots.length) * Math.PI * 2 - Math.PI / 2;
          const x = cx + Math.cos(ang) * R, y = cy + Math.sin(ang) * R;
          const meta = CMD[cmd] || { label: cmd, emoji: "💬" };
          return (
            <g key={i} style={{ cursor: "pointer" }} onClick={() => fire(cmd)}>
              <circle cx={x} cy={y} r="32" fill="var(--ink-3)" stroke="var(--volt)" strokeWidth="2" />
              <text x={x} y={y - 4} textAnchor="middle" fontSize="16">{meta.emoji}</text>
              <text x={x} y={y + 12} textAnchor="middle" fontSize="7.5" fill="var(--paper)" fontFamily="Rajdhani" fontWeight="700">{clip(meta.label)}</text>
            </g>
          );
        })}
      </svg>
      <div className="impactf faint" style={{ position: "absolute", bottom: "12%", fontSize: 11, letterSpacing: "0.12em" }}>CLICK A COMMAND · RELEASE C TO CLOSE</div>
    </div>
  );
}

// The caption stream (always rendered; shows recent incoming comms).
export function CaptionStream({ captions }) {
  return (
    <div style={{ position: "absolute", left: 20, bottom: 92, display: "flex", flexDirection: "column", gap: 6, pointerEvents: "none", maxWidth: 320 }}>
      {captions.map((c) => (
        <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", background: "rgba(13,11,20,0.85)", border: `1px solid ${c.color}`, animation: "capin 0.2s ease" }}>
          <span style={{ fontSize: 16 }}>{c.emoji}</span>
          <span style={{ fontSize: 13 }}><b style={{ color: c.color }}>{c.by}:</b> {c.text}</span>
        </div>
      ))}
      <style>{`@keyframes capin{from{transform:translateX(-12px);opacity:0}to{transform:none;opacity:1}}`}</style>
    </div>
  );
}

function clip(s) { s = String(s); return s.length > 9 ? s.slice(0, 8) + "…" : s; }
const overlay = { position: "fixed", inset: 0, zIndex: 300, display: "grid", placeItems: "center", background: "rgba(5,4,9,0.4)" };
