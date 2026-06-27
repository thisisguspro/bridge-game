import { useEffect, useRef, useState } from "react";
import * as backend from "../api/backend.js";

// Onboarding helpers for the live match:
//  • useControls — wires the player's key bindings to real actions (WASD move,
//    E interact, F pull, Q sabotage) AND computes which contextual hints apply
//    right now. Reads the two settings toggles (showControlHints, showTips).
//  • ControlHints — the lower-corner cluster of key-caps you can press *now*.
//  • TipBubble — a rotating gameplay tip (dismissable; respects showTips).
//
// Movement: the engine uses continuous setDestination; holding WASD steers the
// player by nudging a destination point in that direction each frame, which
// composes cleanly with click-to-move.

const DEFAULT_BINDS = {
  moveUp: "KeyW", moveDown: "KeyS", moveLeft: "KeyA", moveRight: "KeyD",
  interact: "KeyE", useTool: "KeyF", sabotage: "KeyQ", commsWheel: "KeyC",
};

export function useControls({ view, roomId, conn, onOpenTask, onOpenSabotage, onOpenThrottle, onOpenTurret, taskOpen }) {
  const [binds, setBinds] = useState(DEFAULT_BINDS);
  const [showHints, setShowHints] = useState(true);
  const [showTips, setShowTips] = useState(true);
  const held = useRef(new Set());
  const viewRef = useRef(view); viewRef.current = view;

  // load bindings + toggles from settings once
  useEffect(() => {
    backend.getSettings().then((d) => {
      if (d.settings?.controls) setBinds({ ...DEFAULT_BINDS, ...d.settings.controls });
      if (d.settings?.accessibility) {
        setShowHints(d.settings.accessibility.showControlHints !== false);
        setShowTips(d.settings.accessibility.showTips !== false);
      }
    }).catch(() => {});
  }, []);

  // keyboard handling: discrete actions on keydown, movement via held keys
  useEffect(() => {
    const code2action = Object.fromEntries(Object.entries(binds).map(([a, c]) => [c, a]));
    const down = (e) => {
      // ignore when typing in an input or when a task mini-game owns the keyboard
      if (e.target && /input|textarea/i.test(e.target.tagName)) return;
      const action = code2action[e.code];
      if (!action) return;
      const v = viewRef.current; if (!v || v.phase !== "active") return;
      if (["moveUp", "moveDown", "moveLeft", "moveRight"].includes(action)) {
        held.current.add(action); return; // movement handled in the rAF loop
      }
      if (taskOpen) return; // the task mini-game has its own controls
      e.preventDefault();
      if (action === "interact") doInteract(v, roomId, conn, onOpenTask, onOpenThrottle, onOpenTurret);
      else if (action === "useTool") doUseTool(v, roomId, conn);
      else if (action === "sabotage" && v.you?.role === "impostor") onOpenSabotage?.();
    };
    const up = (e) => { const a = code2action[e.code]; if (a) held.current.delete(a); };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [binds, roomId, conn, taskOpen, onOpenTask, onOpenSabotage, onOpenThrottle, onOpenTurret]);

  // movement loop: while a WASD key is held, push the destination in that dir
  useEffect(() => {
    let raf;
    const loop = () => {
      const v = viewRef.current;
      if (v && v.phase === "active" && v.you && v.you.x != null && held.current.size && !taskOpen) {
        let dx = 0, dy = 0;
        if (held.current.has("moveUp")) dy -= 1;
        if (held.current.has("moveDown")) dy += 1;
        if (held.current.has("moveLeft")) dx -= 1;
        if (held.current.has("moveRight")) dx += 1;
        if (dx || dy) {
          // iso world: screen-up is world (-x,-y); map intuitive WASD to world axes
          // Project the destination well ahead in the held direction so the player
          // glides at full engine speed (a short lookahead used to throttle them
          // far below the bots — this is the real "players feel slow" fix).
          const LOOK = 9000;
          const wx = v.you.x + (dx + dy) * LOOK;
          const wy = v.you.y + (dy - dx) * LOOK;
          conn.setDestination(roomId, wx, wy);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [roomId, conn, taskOpen]);

  const hints = computeHints(view, binds, taskOpen);
  return { binds, showHints, showTips, hints };
}

// --- action resolvers (mirror what the HUD buttons do) ---
const INTERACT_RANGE = 1500; // scaled for huge rooms

function nearestTask(v) {
  const you = v.you || {};
  if (you.x == null) return null;
  let best = null, bestD = INTERACT_RANGE;
  for (const t of (you.tasks || [])) {
    if (t.done || t.room !== you.room || t.x == null) continue;
    const d = Math.hypot(t.x - you.x, t.y - you.y);
    if (d <= bestD) { best = t; bestD = d; }
  }
  return best;
}

function doInteract(v, roomId, conn, onOpenTask, onOpenThrottle, onOpenTurret) {
  const you = v.you || {};
  const room = you.room;
  // 1) a task marker you're standing near
  const task = nearestTask(v);
  if (task) { conn.startTask(roomId, task.id); onOpenTask?.(task); return; }
  // 2) a turret in this room: man it (or open its fire panel if already manned)
  if ((v.map?.turretRooms || []).includes(room)) {
    if (v.yourTurret === room) { onOpenTurret?.(); }
    else { conn.enterTurret(roomId); onOpenTurret?.(); }
    return;
  }
  // 3) the Helm throttle (interactable when you're in the Helm)
  if (room === (v.helm?.room || v.map?.spawnRoom) && onOpenThrottle) { onOpenThrottle(); return; }
  // 4) station actions
  if ((v.map?.refillRooms || []).includes(room)) { conn.refill(roomId); return; }
  if ((v.map?.repairRooms || []).includes(room)) { conn.repair(roomId); return; }
}
function doUseTool(v, roomId, conn) {
  const you = v.you || {};
  if (you.role !== "impostor") return;
  // pull a same-room, same-plane crew member
  const prey = (v.players || []).find((p) => p.id !== you.id && p.room === you.room && p.plane === you.plane && p.role !== "impostor");
  if (prey) conn.detachCable(roomId, prey.id);
}

// --- which hints apply right now ---
function computeHints(view, binds, taskOpen) {
  if (!view || view.phase !== "active") return [];
  const you = view.you || {};
  const room = you.room;
  const out = [];
  const key = (code) => prettyKey(code);

  if (taskOpen) {
    out.push({ key: "▣", label: "Complete the mini-game" });
    out.push({ key: "Esc", label: "Cancel task" });
    return out;
  }

  // movement is always available (WASD only — click-to-move removed)
  out.push({ key: `${key(binds.moveUp)}${key(binds.moveLeft)}${key(binds.moveDown)}${key(binds.moveRight)}`, label: "Move", combo: true });

  // contextual: only when you're standing near the relevant thing
  const task = nearestTask(view);
  if (task) out.push({ key: key(binds.interact), label: `Do task: ${task.name}`, hot: true });
  else if ((view.map?.turretRooms || []).includes(room)) out.push({ key: key(binds.interact), label: view.yourTurret === room ? "Fire turret" : "Man turret", hot: true });
  else if (room === (view.helm?.room || view.map?.spawnRoom)) out.push({ key: key(binds.interact), label: "Throttle / power", hot: true });
  else if ((view.map?.refillRooms || []).includes(room)) out.push({ key: key(binds.interact), label: "Refill O₂", hot: true });
  else if ((view.map?.repairRooms || []).includes(room)) out.push({ key: key(binds.interact), label: "Repair hull", hot: true });

  // impostor tools
  if (you.role === "impostor" && you.plane !== "eliminated") {
    const prey = (view.players || []).find((p) => p.id !== you.id && p.room === room && p.plane === you.plane && p.role !== "impostor");
    if (prey) out.push({ key: key(binds.useTool), label: `Pull ${prey.name}`, danger: true });
    const cd = you.sabotageCooldown || 0;
    out.push({ key: key(binds.sabotage), label: cd > 0 ? `Sabotage (${cd}s)` : "Sabotage", danger: true, disabled: cd > 0 });
  }

  // comms always
  out.push({ key: `Hold ${key(binds.commsWheel)}`, label: "Comms wheel" });
  return out;
}

export function ControlHints({ hints }) {
  if (!hints || !hints.length) return null;
  return (
    <div style={{ position: "absolute", left: 16, bottom: 96, display: "flex", flexDirection: "column", gap: 6, pointerEvents: "none", zIndex: 60 }}>
      <div className="impactf faint" style={{ fontSize: 9, letterSpacing: "0.16em", marginBottom: 2 }}>CONTROLS</div>
      {hints.map((h, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, opacity: h.disabled ? 0.45 : 1 }}>
          <kbd style={{
            fontFamily: "var(--impact)", fontSize: 11, minWidth: 22, padding: "3px 7px", textAlign: "center",
            background: "rgba(13,11,20,0.9)", color: h.danger ? "var(--violet)" : h.hot ? "var(--gold)" : "var(--paper)",
            border: `2px solid ${h.danger ? "var(--violet)" : h.hot ? "var(--gold)" : "var(--line)"}`,
            boxShadow: "0 2px 0 rgba(0,0,0,0.4)", letterSpacing: h.combo ? "0.05em" : 0,
          }}>{h.key}</kbd>
          <span style={{ fontSize: 12, color: "var(--paper)", textShadow: "0 1px 3px #000" }}>{h.label}</span>
        </div>
      ))}
    </div>
  );
}

// Rotating gameplay tips. Pulls a relevant tip for your role/state, rotates every
// ~12s, dismissable. Only shown when showTips is on.
const TIPS_CREW = [
  "Tasks generate power. Power runs oxygen, engines, and shields.",
  "Engines on = shields off. Burn toward the landing, then cut engines to repair.",
  "Stay in pairs — a lone crew member is easy to cable-pull.",
  "If you're pulled to the energy plane you're still in play. Keep doing tasks.",
  "Call a vote on anyone you saw acting suspiciously. Majority ejects.",
  "Resolve sabotages fast — some have a fuse that ends the match if it runs out.",
];
const TIPS_IMP = [
  "Catch a crew member alone, then F to cable-pull them to the energy plane.",
  "A second pull on the energy plane eliminates them for good.",
  "Sabotage to split the crew and force them away from tasks.",
  "Reactor Meltdown has a fuse — if crew can't reach it in time, you win.",
  "Blend in: stand near tasks and move with the group.",
];

export function TipBubble({ view, enabled }) {
  const role = view?.you?.role;
  const [idx, setIdx] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const tips = role === "impostor" ? TIPS_IMP : TIPS_CREW;
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % tips.length), 12000);
    return () => clearInterval(t);
  }, [enabled, tips.length]);
  if (!enabled || dismissed || !view || view.phase !== "active") return null;
  return (
    <div style={{ position: "absolute", bottom: 100, right: 16, zIndex: 55, maxWidth: 360, width: "min(360px, 50%)",
      display: "flex", alignItems: "center", gap: 11, padding: "11px 15px",
      background: "rgba(13,11,20,0.94)", border: "1px solid var(--volt)", backdropFilter: "blur(4px)",
      boxShadow: "0 4px 16px rgba(0,0,0,0.5)" }}>
      <span className="kanji" style={{ fontSize: 18, color: "var(--volt)", flexShrink: 0 }}>助</span>
      <span style={{ fontSize: 14.5, lineHeight: 1.35, flex: 1 }}>{tips[idx]}</span>
      <button onClick={() => setDismissed(true)} style={{ background: "none", border: "none", color: "var(--dim)", cursor: "pointer", fontSize: 16, lineHeight: 1 }}>×</button>
    </div>
  );
}

function prettyKey(code) {
  if (!code) return "?";
  return code.replace(/^Key/, "").replace(/^Digit/, "").replace("ArrowUp", "↑").replace("ArrowDown", "↓")
    .replace("ArrowLeft", "←").replace("ArrowRight", "→").replace("Space", "␣").replace("ControlLeft", "Ctrl").replace("Tab", "Tab");
}
