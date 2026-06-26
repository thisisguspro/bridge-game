import { useEffect, useRef, useState } from "react";
import { playSound } from "../util/sound.js";

// Base emote set mirrored from the server's EMOTES (key -> emoji/label/kanji).
// Owned cosmetic emotes could extend this later; this is the always-available set.
export const EMOTE_LIST = [
  { key: "WAVE", emoji: "👋", label: "Wave" },
  { key: "LAUGH", emoji: "😂", label: "Laugh" },
  { key: "CRY", emoji: "😭", label: "Cry" },
  { key: "ANGRY", emoji: "😡", label: "Angry" },
  { key: "SHOCK", emoji: "😱", label: "Shock" },
  { key: "SMUG", emoji: "😏", label: "Smug" },
  { key: "HEART", emoji: "💖", label: "Heart" },
  { key: "SWEAT", emoji: "😅", label: "Nervous" },
  { key: "THINK", emoji: "🤔", label: "Think" },
  { key: "SLEEP", emoji: "😴", label: "Bored" },
  { key: "SALUTE", emoji: "🫡", label: "Salute" },
  { key: "SPARKLE", emoji: "✨", label: "Sparkle" },
  { key: "SKULL", emoji: "💀", label: "Dead" },
  { key: "POINT", emoji: "👉", label: "You!" },
  { key: "SUS", emoji: "🤨", label: "Sus" },
  { key: "GG", emoji: "🎉", label: "GG" },
];

// Hook: tracks live emote bubbles (per player id) from comm/emote events, plays
// the emote's sound cue, and exposes an opener + fire() for the wheel.
export function useEmotes({ roomId, conn, events }) {
  const [open, setOpen] = useState(false);
  const [bubbles, setBubbles] = useState({}); // playerId -> { emoji, id }
  const timers = useRef({});

  useEffect(() => {
    if (!events) return;
    for (const e of events) {
      if (e.type !== "comm" || e.kind !== "emote") continue;
      const key = `${e.from}:${e.emote}:${e.at ?? e.t ?? ""}`;
      if (timers.current[key]) continue;
      timers.current[key] = true;
      setBubbles((b) => ({ ...b, [e.from]: { emoji: e.emoji || "✨", id: key } }));
      if (e.sound) playSound(e.sound);
      setTimeout(() => {
        setBubbles((b) => { const n = { ...b }; if (n[e.from]?.id === key) delete n[e.from]; return n; });
        delete timers.current[key];
      }, 2600);
    }
  }, [events]); // eslint-disable-line

  const fire = (emoteKey) => { if (emoteKey) conn.emote(roomId, emoteKey); setOpen(false); };
  return { open, setOpen, bubbles, fire };
}

// The radial-ish emote picker (grid). Opened by hold-Z or the button.
export function EmoteWheel({ onFire, onClose }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 210, display: "grid", placeItems: "center", background: "rgba(5,4,9,0.45)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 64px)", gap: 10, padding: 18,
        background: "rgba(13,11,20,0.96)", border: "2px solid var(--volt)" }}>
        {EMOTE_LIST.map((em) => (
          <button key={em.key} title={em.label} onClick={() => onFire(em.key)}
            style={{ width: 64, height: 64, fontSize: 28, background: "var(--ink-2)", border: "1px solid var(--line)",
              cursor: "pointer", display: "grid", placeItems: "center" }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--volt)")}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--line)")}>
            {em.emoji}
          </button>
        ))}
      </div>
    </div>
  );
}

// A single floating emote bubble (rendered above a player by IsoStage).
export function EmoteBubble({ emoji }) {
  return (
    <div style={{ position: "absolute", left: "50%", top: -46, transform: "translateX(-50%)",
      fontSize: 26, animation: "emotePop 0.3s ease-out", pointerEvents: "none",
      filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.6))" }}>
      <div style={{ background: "rgba(255,255,255,0.95)", borderRadius: 16, padding: "2px 8px", lineHeight: 1 }}>{emoji}</div>
    </div>
  );
}
