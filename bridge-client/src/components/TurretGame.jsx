import { useEffect, useRef, useState } from "react";

// Whack-a-mole turret defense. Enemy spaceships pop up in random cells of a grid;
// click one to blast it — each successful click calls onHit() (which fires a real
// shootPlane to the server). Server still enforces the per-shot cooldown, so
// mashing empty cells does nothing. Ships auto-despawn after a moment if missed.
const COLS = 3, ROWS = 3, CELLS = COLS * ROWS;
const SHIP = "🛸";
const BOOM = "💥";

export default function TurretGame({ onHit, planesDowned = 0 }) {
  const [active, setActive] = useState({});   // cellIndex -> true (ship present)
  const [boom, setBoom] = useState({});       // cellIndex -> true (explosion flash)
  const timers = useRef([]);

  // spawn loop: periodically pop a ship into a random empty cell
  useEffect(() => {
    let alive = true;
    const spawn = () => {
      if (!alive) return;
      setActive((a) => {
        const empty = [];
        for (let i = 0; i < CELLS; i++) if (!a[i]) empty.push(i);
        if (!empty.length) return a;
        const cell = empty[Math.floor(Math.random() * empty.length)];
        // auto-despawn this ship if not clicked in time
        const t = setTimeout(() => setActive((x) => { const n = { ...x }; delete n[cell]; return n; }), 1100 + Math.random() * 700);
        timers.current.push(t);
        return { ...a, [cell]: true };
      });
      const next = 360 + Math.random() * 520; // spawn cadence
      const t2 = setTimeout(spawn, next);
      timers.current.push(t2);
    };
    const t0 = setTimeout(spawn, 300);
    timers.current.push(t0);
    return () => { alive = false; timers.current.forEach(clearTimeout); timers.current = []; };
  }, []);

  const hit = (cell) => {
    if (!active[cell]) return;             // empty cell — ignore (no wasted shot)
    setActive((a) => { const n = { ...a }; delete n[cell]; return n; });
    setBoom((b) => ({ ...b, [cell]: true }));
    setTimeout(() => setBoom((b) => { const n = { ...b }; delete n[cell]; return n; }), 200);
    onHit();                               // fire a real shot at the server
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
      <div className="impactf" style={{ fontSize: 11, color: "var(--volt)" }}>BLAST THE SHIPS! — downed {planesDowned}</div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${COLS}, 56px)`, gap: 6 }}>
        {Array.from({ length: CELLS }).map((_, i) => (
          <button key={i} onClick={() => hit(i)}
            style={{ width: 56, height: 56, fontSize: 30, lineHeight: 1, cursor: "crosshair",
              background: boom[i] ? "rgba(255,200,61,0.3)" : "rgba(20,18,30,0.9)",
              border: `2px solid ${active[i] ? "var(--hot)" : "var(--line)"}`,
              borderRadius: 8, transition: "border-color 0.1s", display: "grid", placeItems: "center",
              transform: active[i] ? "scale(1.05)" : "scale(1)" }}>
            {boom[i] ? BOOM : active[i] ? SHIP : ""}
          </button>
        ))}
      </div>
      <div className="faint" style={{ fontSize: 10 }}>Click ships fast — empty clicks waste nothing, but cooldown limits fire rate.</div>
    </div>
  );
}
