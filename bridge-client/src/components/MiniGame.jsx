import { useEffect, useRef, useState } from "react";

// Task mini-games. When a player starts a task, the engine records the start time
// and the SERVER won't accept completion until `minSeconds` have elapsed — so
// these games are paced to take roughly that long, and we also gate the
// "Complete" callback on the server-min via a ready timer. Each game calls
// onSolved() when the player finishes the interaction AND the min time is up.
//
// Games: wire_connect, code_sequence, alignment, hold_timing (physical) and
// flux_route, phase_match (energy-plane variants — same skills, cyan theme).
export default function MiniGame({ task, energy, onSolved, onCancel }) {
  const min = task.minSeconds || 12;
  const startedRef = useRef(Date.now());
  const [elapsed, setElapsed] = useState(0);
  const [solvedInteraction, setSolvedInteraction] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setElapsed((Date.now() - startedRef.current) / 1000), 200);
    return () => clearInterval(t);
  }, []);
  const ready = elapsed >= min - 0.5;            // matches the server's grace
  const done = solvedInteraction && ready;
  useEffect(() => { if (done) onSolved(); }, [done]); // eslint-disable-line

  const accent = energy ? "var(--volt)" : "var(--gold)";
  const Game = GAMES[task.game] || WireConnect;

  return (
    <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div style={{ ...panel, borderColor: accent }} onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
          <span className="kanji" style={{ fontSize: 15, color: accent }}>{energy ? "霊務" : "作業"}</span>
          <span className="impactf faint" style={{ fontSize: 10 }}>{task.room}</span>
        </div>
        <div className="display" style={{ fontSize: 26, lineHeight: 0.9, marginBottom: 2 }}>{task.name}</div>
        <div className="faint" style={{ fontSize: 11, marginBottom: 14 }}>{GAME_LABELS[task.game] || "Complete the task"}</div>

        <Game accent={accent} onComplete={() => setSolvedInteraction(true)} solved={solvedInteraction} />

        {/* progress toward the server-enforced minimum */}
        <div style={{ marginTop: 16 }}>
          <div style={{ height: 6, background: "var(--ink)", border: "1px solid var(--line)", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${Math.min(100, (elapsed / min) * 100)}%`, background: accent, transition: "width 0.2s linear" }} />
          </div>
          <div className="row" style={{ justifyContent: "space-between", marginTop: 6 }}>
            <button className="btn btn-ghost" style={{ fontSize: 11, padding: "6px 12px" }} onClick={onCancel}>Cancel</button>
            <span className="impactf" style={{ fontSize: 11, color: done ? accent : "var(--dim)" }}>
              {solvedInteraction ? (ready ? "DONE" : `STABILIZING… ${Math.ceil(min - elapsed)}s`) : "IN PROGRESS"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

const GAME_LABELS = {
  wire_connect: "Drag each wire to its matching port.",
  code_sequence: "Repeat the highlighted sequence.",
  alignment: "Slide both rings into the green zone.",
  hold_timing: "Hold the button while the needle is in the band.",
  flux_route: "Route the flux through every node.",
  phase_match: "Match the phase to the target.",
};

/* ---------------- wire connect ---------------- */
// Drag a wire from a left port to its color-matching right port. Connections are
// DRAWN as curved wires so you can see what's linked; a live wire follows the
// cursor while you're mid-connection.
function WireConnect({ accent, onComplete }) {
  const colors = ["#ff2d4d", "#46e6ff", "#ffc83d", "#9b6cff"];
  const [rightOrder] = useState(() => shuffle([0, 1, 2, 3]));
  const [picked, setPicked] = useState(null);
  const [linked, setLinked] = useState({}); // leftIdx -> rightIdx
  const [cursor, setCursor] = useState(null); // {x,y} within the svg while dragging
  const boxRef = useRef(null);
  useEffect(() => { if (Object.keys(linked).length === 4) onComplete(); }, [linked]); // eslint-disable-line

  const W = 260, H = 200, padY = 26, gap = (H - padY * 2) / 3;
  const leftX = 40, rightX = W - 40;
  const leftY = (i) => padY + i * gap;
  const rightY = (i) => padY + i * gap;

  const link = (rightIdx) => {
    if (picked == null) return;
    if (rightOrder[rightIdx] === picked) setLinked((l) => ({ ...l, [picked]: rightIdx }));
    setPicked(null); setCursor(null);
  };
  const onMove = (e) => {
    if (picked == null || !boxRef.current) return;
    const r = boxRef.current.getBoundingClientRect();
    setCursor({ x: e.clientX - r.left, y: e.clientY - r.top });
  };
  const wirePath = (x1, y1, x2, y2) => {
    const mx = (x1 + x2) / 2;
    return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
  };

  return (
    <svg ref={boxRef} viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ display: "block", margin: "0 auto" }}
      onMouseMove={onMove} onMouseLeave={() => setCursor(null)}>
      {/* completed connections, drawn in their color */}
      {Object.entries(linked).map(([li, ri]) => (
        <path key={li} d={wirePath(leftX, leftY(+li), rightX, rightY(+ri))}
          stroke={colors[+li]} strokeWidth={4} fill="none" strokeLinecap="round" opacity={0.95} />
      ))}
      {/* live wire from the picked port to the cursor */}
      {picked != null && cursor && (
        <path d={wirePath(leftX, leftY(picked), cursor.x, cursor.y)}
          stroke={colors[picked]} strokeWidth={3} fill="none" strokeDasharray="6 5" opacity={0.8} />
      )}
      {/* left ports */}
      {colors.map((c, i) => (
        <g key={"L" + i} style={{ cursor: i in linked ? "default" : "pointer" }} onMouseDown={() => !(i in linked) && setPicked(i)}>
          <rect x={leftX - 22} y={leftY(i) - 12} width={28} height={24} rx={4} fill={c}
            opacity={i in linked ? 0.4 : 1} stroke={picked === i ? "#fff" : "#0d0b14"} strokeWidth={picked === i ? 3 : 2} />
          <circle cx={leftX} cy={leftY(i)} r={5} fill="#0d0b14" />
        </g>
      ))}
      {/* right ports (shuffled colors) */}
      {rightOrder.map((c, i) => {
        const isLinked = Object.values(linked).includes(i);
        return (
          <g key={"R" + i} style={{ cursor: "pointer" }} onMouseUp={() => link(i)} onMouseDown={() => link(i)}>
            <rect x={rightX - 6} y={rightY(i) - 12} width={28} height={24} rx={4} fill={colors[c]}
              opacity={isLinked ? 1 : 0.45} stroke="#0d0b14" strokeWidth={2} />
            <circle cx={rightX} cy={rightY(i)} r={5} fill="#0d0b14" />
          </g>
        );
      })}
    </svg>
  );
}

/* ---------------- code sequence (Simon) ---------------- */
function CodeSequence({ accent, onComplete }) {
  const [seq] = useState(() => Array.from({ length: 4 }, () => Math.floor(Math.random() * 4)));
  const [step, setStep] = useState(0);
  const [flash, setFlash] = useState(-1);
  const [showing, setShowing] = useState(true);
  useEffect(() => {
    // play the sequence once
    let i = 0; setShowing(true);
    const iv = setInterval(() => {
      setFlash(seq[i]); setTimeout(() => setFlash(-1), 300);
      i++; if (i >= seq.length) { clearInterval(iv); setTimeout(() => setShowing(false), 400); }
    }, 600);
    return () => clearInterval(iv);
  }, [seq]);
  const press = (n) => {
    if (showing) return;
    if (seq[step] === n) {
      const next = step + 1; setStep(next);
      setFlash(n); setTimeout(() => setFlash(-1), 150);
      if (next >= seq.length) onComplete();
    } else { setStep(0); } // wrong -> restart input
  };
  const cells = ["#ff2d4d", "#46e6ff", "#ffc83d", "#9b6cff"];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, width: 180, margin: "0 auto" }}>
      {cells.map((c, i) => (
        <button key={i} disabled={showing} onClick={() => press(i)}
          style={{ height: 64, background: c, opacity: flash === i ? 1 : 0.35, border: "2px solid var(--ink)", transition: "opacity 0.1s", cursor: showing ? "default" : "pointer" }} />
      ))}
      <div className="impactf faint" style={{ gridColumn: "1 / -1", textAlign: "center", fontSize: 10 }}>
        {showing ? "WATCH…" : `INPUT ${step}/${seq.length}`}
      </div>
    </div>
  );
}

/* ---------------- alignment (two sliders into zone) ---------------- */
function Alignment({ accent, onComplete }) {
  const [a, setA] = useState(15); const [b, setB] = useState(85);
  const inZone = (v) => v >= 45 && v <= 55;
  useEffect(() => { if (inZone(a) && inZone(b)) onComplete(); }, [a, b]); // eslint-disable-line
  const Slider = ({ v, set }) => (
    <div style={{ position: "relative", height: 26, marginBottom: 14 }}>
      <div style={{ position: "absolute", left: "45%", width: "10%", height: "100%", background: "rgba(70,230,255,0.18)", border: `1px solid ${accent}` }} />
      <input type="range" min="0" max="100" value={v} onChange={(e) => set(Number(e.target.value))}
        style={{ width: "100%", accentColor: inZone(v) ? accent : "var(--hot)" }} />
    </div>
  );
  return <div style={{ padding: "8px 16px" }}><Slider v={a} set={setA} /><Slider v={b} set={setB} /></div>;
}

/* ---------------- hold timing ---------------- */
function HoldTiming({ accent, onComplete }) {
  const [pos, setPos] = useState(0);
  const [charge, setCharge] = useState(0);
  const dir = useRef(1); const holding = useRef(false);
  const posRef = useRef(0); posRef.current = pos;
  useEffect(() => {
    let raf; const loop = () => {
      setPos((p) => { let n = p + dir.current * 1.6; if (n > 100) { n = 100; dir.current = -1; } if (n < 0) { n = 0; dir.current = 1; } return n; });
      setCharge((c) => {
        const inBand = posRef.current >= 40 && posRef.current <= 60;
        const nc = Math.max(0, Math.min(100, c + (holding.current && inBand ? 2.2 : holding.current ? -1.5 : -0.6)));
        if (nc >= 100) onComplete();
        return nc;
      });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop); return () => cancelAnimationFrame(raf);
  }, []); // eslint-disable-line
  return (
    <div style={{ padding: "4px 10px" }} onMouseDown={() => (holding.current = true)} onMouseUp={() => (holding.current = false)} onMouseLeave={() => (holding.current = false)}>
      <div style={{ position: "relative", height: 28, background: "var(--ink)", border: "1px solid var(--line)", marginBottom: 10 }}>
        <div style={{ position: "absolute", left: "40%", width: "20%", height: "100%", background: "rgba(255,200,61,0.18)", borderLeft: `2px solid ${accent}`, borderRight: `2px solid ${accent}` }} />
        <div style={{ position: "absolute", left: `${pos}%`, top: 0, width: 4, height: "100%", background: "#fff", transform: "translateX(-50%)" }} />
      </div>
      <div style={{ height: 14, background: "var(--ink)", border: "1px solid var(--line)" }}>
        <div style={{ height: "100%", width: `${charge}%`, background: accent, transition: "width 0.05s" }} />
      </div>
      <div className="impactf faint" style={{ textAlign: "center", fontSize: 10, marginTop: 6 }}>HOLD while the marker is in the band</div>
    </div>
  );
}

/* ---------------- energy: flux route (light each node) ---------------- */
function FluxRoute({ accent, onComplete }) {
  const [lit, setLit] = useState(new Set());
  const nodes = 6;
  useEffect(() => { if (lit.size === nodes) onComplete(); }, [lit]); // eslint-disable-line
  return (
    <div style={{ display: "flex", justifyContent: "center", gap: 10, padding: "16px 0" }}>
      {Array.from({ length: nodes }).map((_, i) => (
        <button key={i} onClick={() => setLit((s) => new Set(s).add(i))}
          style={{ width: 30, height: 30, borderRadius: "50%", background: lit.has(i) ? accent : "var(--ink-3)", border: `2px solid ${accent}`, boxShadow: lit.has(i) ? `0 0 12px ${accent}` : "none", cursor: "pointer" }} />
      ))}
    </div>
  );
}

/* ---------------- energy: phase match ---------------- */
function PhaseMatch({ accent, onComplete }) {
  const [target] = useState(() => 20 + Math.floor(Math.random() * 60));
  const [val, setVal] = useState(0);
  useEffect(() => { if (Math.abs(val - target) <= 3) onComplete(); }, [val, target]); // eslint-disable-line
  return (
    <div style={{ padding: "10px 16px" }}>
      <div style={{ position: "relative", height: 30, marginBottom: 8 }}>
        <div style={{ position: "absolute", left: `${target}%`, width: 3, height: "100%", background: accent, transform: "translateX(-50%)", boxShadow: `0 0 8px ${accent}` }} />
        <div style={{ position: "absolute", left: `${val}%`, top: 4, width: 12, height: 22, background: "#fff", transform: "translateX(-50%)" }} />
      </div>
      <input type="range" min="0" max="100" value={val} onChange={(e) => setVal(Number(e.target.value))} style={{ width: "100%", accentColor: accent }} />
      <div className="impactf faint" style={{ textAlign: "center", fontSize: 10, marginTop: 4 }}>Slide the marker onto the glowing line</div>
    </div>
  );
}

const GAMES = {
  wire_connect: WireConnect, code_sequence: CodeSequence, alignment: Alignment,
  hold_timing: HoldTiming, flux_route: FluxRoute, phase_match: PhaseMatch,
};

function shuffle(a) { const r = [...a]; for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; }

const overlay = { position: "fixed", inset: 0, zIndex: 320, display: "grid", placeItems: "center", background: "rgba(5,4,9,0.6)" };
const panel = { width: 360, maxWidth: "92vw", background: "rgba(13,11,20,0.97)", border: "2px solid var(--gold)", padding: "18px 20px", clipPath: "polygon(0 0,calc(100% - 16px) 0,100% 16px,100% 100%,16px 100%,0 calc(100% - 16px))" };
