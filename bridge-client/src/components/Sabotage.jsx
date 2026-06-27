import { useEffect, useState } from "react";

// Sabotage UI, two halves:
//  • SabotageMenu  — impostor-only radial/list of the six sabotages, gated by the
//    shared global cooldown the view exposes (view.you.sabotageCooldown).
//  • SabotageAlerts — everyone sees active sabotages: label, fuse countdown,
//    resolve progress, and the rooms where they're fixed. If you're standing in a
//    resolve room you get a Resolve button (crew, physical plane).
//
// Display metadata mirrors the engine's SABOTAGE definitions.
const SAB = {
  LIFE_SUPPORT:    { label: "Life Support Offline", emoji: "🫧", desc: "Refills disabled until fixed." },
  REACTOR_MELTDOWN:{ label: "Reactor Meltdown",     emoji: "☢️", desc: "Fix before the fuse or impostors win." },
  COMMS_BLACKOUT:  { label: "Comms Blackout",       emoji: "📡", desc: "Comms scrambled." },
  ATTRACT_ATTACKERS:{ label: "Position Leaked",     emoji: "🎯", desc: "Attacks come faster & harder." },
  LIGHTS_OUT:      { label: "Lights Out",           emoji: "🌑", desc: "Crew sight dimmed." },
  EMP_OUTAGE:      { label: "EMP Power Outage",     emoji: "⚡", desc: "Task completion frozen." },
};
const ORDER = ["LIFE_SUPPORT", "COMMS_BLACKOUT", "LIGHTS_OUT", "ATTRACT_ATTACKERS", "REACTOR_MELTDOWN", "EMP_OUTAGE"];

export function SabotageMenu({ view, roomId, conn, onClose }) {
  const cd = view.you?.sabotageCooldown || 0;
  const active = new Set((view.sabotages || []).map((s) => s.kind));
  const ready = cd <= 0;
  return (
    <div style={overlay} onClick={onClose}>
      <div style={menu} onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div className="row" style={{ alignItems: "baseline", gap: 10 }}>
            <span className="kanji" style={{ fontSize: 18, color: "var(--violet)" }}>妨害</span>
            <span className="display" style={{ fontSize: 28 }}>SABOTAGE</span>
          </div>
          {!ready && <span className="impactf" style={{ fontSize: 13, color: "var(--hot)" }}>COOLDOWN {cd}s</span>}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {ORDER.map((k) => {
            const meta = SAB[k];
            const isActive = active.has(k);
            const disabled = !ready || isActive;
            return (
              <button key={k} disabled={disabled} onClick={() => { conn.sabotage(roomId, k); onClose(); }}
                style={{ ...sabBtn, opacity: disabled ? 0.4 : 1, borderColor: isActive ? "var(--volt)" : "var(--violet)" }}>
                <span style={{ fontSize: 22 }}>{meta.emoji}</span>
                <div style={{ textAlign: "left" }}>
                  <div className="impactf" style={{ fontSize: 12 }}>{meta.label}</div>
                  <div className="faint" style={{ fontSize: 10 }}>{isActive ? "Already active" : meta.desc}</div>
                </div>
              </button>
            );
          })}
        </div>
        <button className="btn btn-ghost" style={{ marginTop: 14, width: "100%", fontSize: 12 }} onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

// Always-on alert strip for active sabotages (all players see these).
export function SabotageAlerts({ view, roomId, conn }) {
  const sabs = view.sabotages || [];
  const you = view.you || {};
  const myRoom = you.room;
  const canResolve = you.plane === "physical";
  // local clock so fuse timers tick smoothly
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 500); return () => clearInterval(t); }, []);

  if (!sabs.length) return null;
  return (
    <div style={{ position: "absolute", bottom: 85, left: "50%", transform: "translateX(-50%)", display: "flex", flexDirection: "column", gap: 8, zIndex: 50, width: 360, maxWidth: "80%" }}>
      {sabs.map((s) => {
        const meta = SAB[s.kind] || { label: s.kind, emoji: "⚠️" };
        const fuse = s.expiresAt ? Math.max(0, Math.round(s.expiresAt - (view.now ?? 0))) : null;
        const hereCanFix = canResolve && (s.resolveRooms || []).includes(myRoom);
        return (
          <div key={s.kind} className="panel panel-hot" style={{ padding: "10px 14px", background: "rgba(28,8,16,0.94)" }}>
            <div className="row" style={{ alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 22 }}>{meta.emoji}</span>
              <div className="grow">
                <div className="impactf" style={{ fontSize: 13, color: "var(--hot)" }}>{meta.label}</div>
                <div className="faint" style={{ fontSize: 11 }}>
                  Fix at: {(s.resolveRooms || []).join(", ")} · {s.resolved}/{s.needed} done
                </div>
              </div>
              {fuse != null && <span className="display" style={{ fontSize: 26, color: fuse <= 10 ? "var(--hot)" : "var(--gold)" }}>{fuse}s</span>}
            </div>
            {hereCanFix && (
              <button className="btn btn-hot" style={{ width: "100%", marginTop: 8, fontSize: 13 }} onClick={() => conn.resolveSabotage(roomId, s.kind)}>
                Resolve here ({s.resolved}/{s.needed})
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

const overlay = { position: "fixed", inset: 0, zIndex: 250, display: "grid", placeItems: "center", background: "rgba(5,4,9,0.55)" };
const menu = { width: 420, maxWidth: "92vw", background: "rgba(13,11,20,0.97)", border: "2px solid var(--violet)", padding: "18px 20px", clipPath: "polygon(0 0,calc(100% - 16px) 0,100% 16px,100% 100%,16px 100%,0 calc(100% - 16px))" };
const sabBtn = { display: "flex", alignItems: "center", gap: 10, padding: "12px 12px", background: "var(--ink-3)", border: "2px solid var(--violet)", textAlign: "left" };
