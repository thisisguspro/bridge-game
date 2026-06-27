import { useEffect, useRef, useState } from "react";
import { KanjiFlash } from "./effects.jsx";

// Skill-based Task mini-games!
export default function MiniGame({ task, energy, onSolved, onCancel }) {
  const [solvedInteraction, setSolvedInteraction] = useState(false);
  const [showFlash, setShowFlash] = useState(false);
  
  useEffect(() => { 
    if (solvedInteraction && !showFlash) {
      setShowFlash(true);
      setTimeout(() => onSolved(), 1000); // Wait for kanji flash
    } 
  }, [solvedInteraction, showFlash]); // eslint-disable-line

  const accent = energy ? "var(--volt)" : "var(--gold)";
  const Game = GAMES[task.game] || PipeRouter;

  return (
    <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div style={{ ...panel, borderColor: accent, boxShadow: `0 0 50px ${accent}44, inset 0 0 20px ${accent}22` }} onClick={(e) => e.stopPropagation()}>
        {showFlash && <KanjiFlash text="完了" sub="TASK COMPLETE" color={accent} />}
        <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
          <span className="kanji" style={{ fontSize: 15, color: accent, textShadow: `0 0 10px ${accent}` }}>{energy ? "霊務" : "作業"}</span>
          <span className="impactf faint" style={{ fontSize: 10 }}>{task.room}</span>
        </div>
        <div className="display" style={{ fontSize: 32, lineHeight: 0.9, marginBottom: 2, textShadow: "0 0 8px rgba(255,255,255,0.4)" }}>{task.name}</div>
        <div className="faint" style={{ fontSize: 12, marginBottom: 20 }}>{GAME_LABELS[task.game] || "Complete the task"}</div>

        <Game accent={accent} onComplete={() => setTimeout(() => setSolvedInteraction(true), 350)} solved={solvedInteraction} />

        <div style={{ marginTop: 24 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <button className="btn btn-ghost" style={{ fontSize: 11, padding: "6px 12px" }} onClick={onCancel}>Abort</button>
            <span className="impactf" style={{ fontSize: 11, color: solvedInteraction ? accent : "var(--dim)", letterSpacing: "0.1em" }}>
              {solvedInteraction ? "DONE" : "IN PROGRESS"}
            </span>
          </div>
        </div>
        
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.2) 2px, rgba(0,0,0,0.2) 4px)", opacity: 0.5, mixBlendMode: "overlay" }} />
      </div>
    </div>
  );
}

const GAME_LABELS = {
  wire_connect: "Click to rotate pipes and route the power.",
  code_sequence: "Type the sequence rapidly using WASD.",
  alignment: "Keep the slider in the moving sweet spot.",
  hold_timing: "Tap repeatedly to keep the needle stabilized.",
  flux_route: "Shoot down enemy ships before they escape!",
  phase_match: "Keep the slider in the moving sweet spot.",
  turret_defense: "Shoot down enemy ships before they damage the hull!",
};

/* ---------------- Pipe Router ---------------- */
// A simple 3x3 grid where pipes must connect left to right
function PipeRouter({ accent, onComplete }) {
  // 0: straight (horizontal), 1: straight (vertical), 2: corner (L)
  // We'll just do a simpler game: 4 pipes in a row, all must be horizontal.
  const [pipes, setPipes] = useState(() => Array.from({ length: 4 }, () => Math.floor(Math.random() * 3) + 1));
  
  useEffect(() => {
    if (pipes.every(p => p === 0)) onComplete();
  }, [pipes]); // eslint-disable-line

  return (
    <div style={{ display: "flex", justifyContent: "center", gap: 10, padding: "20px 0", alignItems: "center" }}>
      <div style={{ width: 10, height: 10, background: accent, borderRadius: "50%", boxShadow: `0 0 10px ${accent}` }} />
      {pipes.map((rot, i) => (
        <div key={i} onClick={() => setPipes(p => { const np = [...p]; np[i] = (np[i] + 1) % 4; return np; })}
          style={{ width: 40, height: 40, background: "var(--ink-3)", border: "2px solid var(--line)", cursor: "pointer", position: "relative", transform: `rotate(${rot * 90}deg)`, transition: "transform 0.15s ease-in-out" }}>
          <div style={{ position: "absolute", top: 17, left: 0, right: 0, height: 6, background: accent }} />
        </div>
      ))}
      <div style={{ width: 10, height: 10, background: "var(--dim)", borderRadius: "50%" }} />
    </div>
  );
}

/* ---------------- Reflex Sequence (DDR style) ---------------- */
function ReflexSequence({ accent, onComplete }) {
  const chars = ["W", "A", "S", "D"];
  const [seq] = useState(() => Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]));
  const [step, setStep] = useState(0);

  useEffect(() => {
    const handleKey = (e) => {
      const key = e.key.toUpperCase();
      if (!chars.includes(key)) return;
      if (key === seq[step]) {
        const next = step + 1;
        setStep(next);
        if (next >= seq.length) onComplete();
      } else {
        setStep(0); // miss resets
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [step, seq, onComplete]);

  return (
    <div style={{ textAlign: "center", padding: "10px 0" }}>
      <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: 12 }}>
        {seq.map((c, i) => {
          const done = i < step;
          const current = i === step;
          return (
            <div key={i} style={{ 
              width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center",
              background: done ? accent : "var(--ink)", 
              border: `2px solid ${current ? accent : "var(--line)"}`,
              color: done ? "#000" : current ? accent : "var(--faint)",
              fontFamily: "var(--impact)", fontSize: 20,
              boxShadow: current ? `0 0 15px ${accent}` : "none",
              transform: current ? "scale(1.1)" : "scale(1)"
            }}>
              {c}
            </div>
          );
        })}
      </div>
      <div className="impactf faint" style={{ fontSize: 11 }}>TYPE THE SEQUENCE QUICKLY</div>
    </div>
  );
}

/* ---------------- Target Tracking ---------------- */
function TargetTracking({ accent, onComplete }) {
  const [target, setTarget] = useState(50);
  const [val, setVal] = useState(50);
  const [progress, setProgress] = useState(0);
  const targetRef = useRef(50);
  targetRef.current = target;
  
  useEffect(() => {
    let raf;
    let t = 0;
    const loop = () => {
      t += 0.05;
      // move target erratically
      if (Math.random() < 0.02) setTarget(Math.max(10, Math.min(90, targetRef.current + (Math.random() - 0.5) * 60)));
      else setTarget(p => p + Math.sin(t) * 1.5);

      setProgress(p => {
        const inZone = Math.abs(val - targetRef.current) < 15;
        return Math.max(0, Math.min(100, p + (inZone ? 1.0 : -0.5)));
      });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [val]);

  useEffect(() => {
    if (progress >= 100) {
      onComplete();
    }
  }, [progress, onComplete]);

  return (
    <div style={{ padding: "10px 16px" }}>
      <div style={{ position: "relative", height: 30, marginBottom: 8, background: "var(--ink)", border: "1px solid var(--line)" }}>
        {/* Sweet spot */}
        <div style={{ position: "absolute", left: `${target}%`, width: "30%", height: "100%", background: "rgba(255,255,255,0.1)", transform: "translateX(-50%)", borderLeft: `2px solid ${accent}`, borderRight: `2px solid ${accent}` }} />
        {/* Player cursor */}
        <div style={{ position: "absolute", left: `${val}%`, top: -4, bottom: -4, width: 6, background: "#fff", transform: "translateX(-50%)" }} />
      </div>
      <input type="range" min="0" max="100" value={val} onChange={(e) => setVal(Number(e.target.value))} style={{ width: "100%", accentColor: accent, marginBottom: 12 }} />
      <div style={{ height: 6, background: "var(--ink)", width: "100%" }}>
        <div style={{ height: "100%", width: `${progress}%`, background: accent, transition: "width 0.1s" }} />
      </div>
    </div>
  );
}

/* ---------------- Flappy Stabilizer ---------------- */
function FlappyStabilizer({ accent, onComplete }) {
  const [pos, setPos] = useState(50);
  const [progress, setProgress] = useState(0);
  const vRef = useRef(0);
  
  useEffect(() => {
    let raf;
    const loop = () => {
      vRef.current -= 0.15; // gravity pulls down (negative is down in our % space, wait. Let's make 0 top, 100 bottom)
      // Actually, let's say 0 is bottom, 100 is top.
      setPos(p => {
        let next = p + vRef.current;
        if (next < 0) { next = 0; vRef.current = 0; }
        if (next > 100) { next = 100; vRef.current = 0; }
        return next;
      });
      
      setProgress(p => {
        const inBand = posRef.current >= 40 && posRef.current <= 60;
        return Math.max(0, Math.min(100, p + (inBand ? 0.6 : -0.8)));
      });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (progress >= 100) {
      onComplete();
    }
  }, [progress, onComplete]);

  const posRef = useRef(50); posRef.current = pos;
  
  const tap = () => { vRef.current = 2.5; }; // Jump

  return (
    <div style={{ padding: "4px 10px" }} onMouseDown={tap}>
      <div style={{ position: "relative", height: 80, background: "var(--ink)", border: "1px solid var(--line)", marginBottom: 10, cursor: "pointer" }}>
        {/* Safe band */}
        <div style={{ position: "absolute", bottom: "40%", height: "20%", width: "100%", background: `${accent}33`, borderTop: `1px solid ${accent}`, borderBottom: `1px solid ${accent}` }} />
        {/* Needle */}
        <div style={{ position: "absolute", bottom: `${pos}%`, width: "100%", height: 4, background: "#fff", transform: "translateY(50%)" }} />
      </div>
      <div style={{ height: 10, background: "var(--ink)", border: "1px solid var(--line)" }}>
        <div style={{ height: "100%", width: `${progress}%`, background: accent, transition: "width 0.1s" }} />
      </div>
      <div className="impactf faint" style={{ textAlign: "center", fontSize: 10, marginTop: 6 }}>CLICK RAPIDLY TO STABILIZE</div>
    </div>
  );
}

/* ---------------- Turret Shooter ---------------- */
function TurretShooter({ accent, onComplete }) {
  const [ships, setShips] = useState([]);
  const [score, setScore] = useState(0);
  const [explosions, setExplosions] = useState([]);
  const idRef = useRef(0);

  // Spawn ships at random positions
  useEffect(() => {
    const spawn = setInterval(() => {
      const id = idRef.current++;
      const x = Math.random() * 80 + 10; // 10-90%
      const y = Math.random() * 60 + 10; // 10-70%
      const duration = 1500 + Math.random() * 1000; // 1.5-2.5s visible
      setShips(prev => [...prev, { id, x, y, spawnedAt: Date.now(), duration }]);
      // Auto-remove after duration
      setTimeout(() => setShips(prev => prev.filter(s => s.id !== id)), duration);
    }, 800);
    return () => clearInterval(spawn);
  }, []);

  useEffect(() => { if (score >= 5) onComplete(); }, [score, onComplete]);

  const shoot = (ship, e) => {
    e.stopPropagation();
    setScore(s => s + 1);
    setShips(prev => prev.filter(s => s.id !== ship.id));
    // explosion effect
    const ex = { id: ship.id, x: ship.x, y: ship.y };
    setExplosions(prev => [...prev, ex]);
    setTimeout(() => setExplosions(prev => prev.filter(e => e.id !== ex.id)), 500);
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: 200, background: 'radial-gradient(ellipse at 50% 50%, #0a0818 0%, #020108 100%)', border: '2px solid var(--line)', overflow: 'hidden', cursor: 'crosshair' }}>
      {/* Stars background */}
      {Array.from({length: 30}, (_, i) => (
        <div key={`star${i}`} style={{ position: 'absolute', left: `${(i * 37) % 100}%`, top: `${(i * 53) % 100}%`, width: 2, height: 2, background: '#fff', borderRadius: '50%', opacity: 0.3 + (i % 5) * 0.1 }} />
      ))}
      {/* Crosshair overlay */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: 'linear-gradient(transparent 49%, rgba(255,0,85,0.15) 49%, rgba(255,0,85,0.15) 51%, transparent 51%), linear-gradient(90deg, transparent 49%, rgba(255,0,85,0.15) 49%, rgba(255,0,85,0.15) 51%, transparent 51%)' }} />
      {/* Enemy ships */}
      {ships.map(ship => (
        <div key={ship.id} onClick={(e) => shoot(ship, e)}
          style={{ position: 'absolute', left: `${ship.x}%`, top: `${ship.y}%`, transform: 'translate(-50%,-50%)', cursor: 'crosshair', zIndex: 10, animation: 'shipFloat 0.5s ease-in-out infinite alternate' }}>
          <svg width="28" height="20" viewBox="0 0 28 20">
            <path d="M14 2 L26 10 L22 12 L14 18 L6 12 L2 10 Z" fill="none" stroke={accent} strokeWidth="2" />
            <path d="M14 6 L20 10 L14 14 L8 10 Z" fill={accent} opacity="0.6" />
          </svg>
        </div>
      ))}
      {/* Explosions */}
      {explosions.map(ex => (
        <div key={`ex${ex.id}`} style={{ position: 'absolute', left: `${ex.x}%`, top: `${ex.y}%`, transform: 'translate(-50%,-50%)', width: 40, height: 40, borderRadius: '50%', background: `radial-gradient(${accent}, transparent)`, animation: 'explode 0.5s forwards', pointerEvents: 'none', zIndex: 20 }} />
      ))}
      {/* Score */}
      <div style={{ position: 'absolute', bottom: 8, right: 12, fontFamily: 'var(--impact)', fontSize: 14, color: accent, letterSpacing: '0.1em' }}>{score}/5 TARGETS HIT</div>
      {/* HUD frame */}
      <div style={{ position: 'absolute', inset: 4, border: `1px solid ${accent}33`, pointerEvents: 'none' }} />
      <style>{`
        @keyframes shipFloat { 0% { transform: translate(-50%,-50%) translateY(-3px); } 100% { transform: translate(-50%,-50%) translateY(3px); } }
        @keyframes explode { 0% { transform: translate(-50%,-50%) scale(0.5); opacity: 1; } 100% { transform: translate(-50%,-50%) scale(2); opacity: 0; } }
      `}</style>
    </div>
  );
}

const GAMES = {
  wire_connect: PipeRouter, 
  code_sequence: ReflexSequence, 
  alignment: TargetTracking,
  hold_timing: FlappyStabilizer, 
  flux_route: TurretShooter, 
  phase_match: TargetTracking,
  turret_defense: TurretShooter,
};

const overlay = { position: "fixed", inset: 0, zIndex: 320, display: "grid", placeItems: "center", background: "rgba(5,4,9,0.8)", backdropFilter: "blur(4px)" };
const panel = { position: "relative", width: 400, maxWidth: "92vw", background: "rgba(13,11,20,0.9)", border: "2px solid var(--gold)", padding: "24px", clipPath: "polygon(0 0,calc(100% - 24px) 0,100% 24px,100% 100%,24px 100%,0 calc(100% - 24px))" };
