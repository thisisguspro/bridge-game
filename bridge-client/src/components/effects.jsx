import { useEffect, useRef, useState, useCallback } from "react";

// Ambient diagonal speed-lines layer (CSS-driven). `hot` tints it red.
export function SpeedLines({ hot = false }) {
  return <div className={`speedlines${hot ? " hot" : ""}`} aria-hidden="true" />;
}

// Fires a radial impact burst at a screen point. Use the hook for imperative pops.
export function useImpact() {
  const [bursts, setBursts] = useState([]);
  const pop = useCallback((x, y) => {
    const id = Math.random().toString(36).slice(2);
    setBursts((b) => [...b, { id, x, y }]);
    setTimeout(() => setBursts((b) => b.filter((z) => z.id !== id)), 550);
  }, []);
  const layer = (
    <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 9999 }} aria-hidden="true">
      {bursts.map((b) => (
        <div key={b.id} className="impact-burst" style={{ left: b.x, top: b.y }} />
      ))}
    </div>
  );
  return { pop, layer };
}

// A big kanji/word that slams in then fades — for level-ups, victories, etc.
export function KanjiFlash({ text, sub, color = "var(--hot)", onDone }) {
  useEffect(() => { const t = setTimeout(() => onDone && onDone(), 1600); return () => clearTimeout(t); }, [onDone]);
  return (
    <div style={overlay} aria-live="assertive">
      <div className="slam">
        <div className="kanji" style={{ fontSize: "clamp(64px,16vw,200px)", color, lineHeight: 0.9, textShadow: "0 6px 0 rgba(0,0,0,0.5)" }}>{text}</div>
        {sub && <div className="impactf" style={{ textAlign: "center", letterSpacing: "0.3em", marginTop: 10, color: "var(--paper)" }}>{sub}</div>}
      </div>
      <style>{`
        .slam { animation: slam 1.6s cubic-bezier(.2,.8,.2,1) forwards; text-align:center; }
        @keyframes slam {
          0% { transform: scale(2.4) rotate(-6deg); opacity: 0; filter: blur(8px); }
          18% { transform: scale(1) rotate(-3deg); opacity: 1; filter: blur(0); }
          70% { transform: scale(1.02) rotate(-3deg); opacity: 1; }
          100% { transform: scale(1.1) rotate(-3deg); opacity: 0; }
        }
      `}</style>
    </div>
  );
}
const overlay = { position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9998, pointerEvents: "none" };

// Floating ember/particle field on a canvas — drifting upward motes for energy.
export function Particles({ density = 40, color = "rgba(255,80,110,0.6)" }) {
  const ref = useRef(null);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const ctx = cv.getContext("2d");
    let raf, w, h, parts = [];
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const resize = () => { w = cv.width = cv.offsetWidth; h = cv.height = cv.offsetHeight; };
    resize();
    parts = Array.from({ length: density }, () => ({
      x: Math.random() * w, y: Math.random() * h,
      r: Math.random() * 2 + 0.6, v: Math.random() * 0.5 + 0.15, drift: (Math.random() - 0.5) * 0.3,
    }));
    const tick = () => {
      ctx.clearRect(0, 0, w, h);
      for (const p of parts) {
        p.y -= p.v; p.x += p.drift;
        if (p.y < -4) { p.y = h + 4; p.x = Math.random() * w; }
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = color; ctx.fill();
      }
      if (!reduced) raf = requestAnimationFrame(tick);
    };
    tick();
    window.addEventListener("resize", resize);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, [density, color]);
  return <canvas ref={ref} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 1 }} aria-hidden="true" />;
}

// Screen-shake hook: call shake() to jolt a wrapped element. Returns a style to
// spread onto the container and the trigger fn. Heavy-flair for impactful events.
export function useScreenShake() {
  const [shaking, setShaking] = useState(false);
  const shake = useCallback(() => { setShaking(false); requestAnimationFrame(() => setShaking(true)); }, []);
  const style = shaking ? { animation: "screenshake 0.4s cubic-bezier(.36,.07,.19,.97)" } : undefined;
  const onAnimationEnd = () => setShaking(false);
  return { shake, style, onAnimationEnd };
}

// A one-shot sparkle burst at center screen (cel-style 4-point stars). Mount it
// with a key to replay. Auto-cleans via onDone.
export function SparkleBurst({ color = "var(--volt)", onDone }) {
  useEffect(() => { const t = setTimeout(() => onDone && onDone(), 800); return () => clearTimeout(t); }, [onDone]);
  const stars = Array.from({ length: 10 }, (_, i) => {
    const ang = (i / 10) * Math.PI * 2, dist = 60 + (i % 3) * 40;
    return { x: Math.cos(ang) * dist, y: Math.sin(ang) * dist, d: (i % 4) * 0.05 };
  });
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 90, display: "grid", placeItems: "center" }} aria-hidden="true">
      {stars.map((s, i) => (
        <svg key={i} width="28" height="28" viewBox="0 0 24 24"
          style={{ position: "absolute", animation: `sparkfly 0.8s ease-out ${s.d}s forwards`, ["--dx"]: `${s.x}px`, ["--dy"]: `${s.y}px` }}>
          <path d="M12 0 L14 10 L24 12 L14 14 L12 24 L10 14 L0 12 L10 10 Z" fill={color} />
        </svg>
      ))}
    </div>
  );
}
