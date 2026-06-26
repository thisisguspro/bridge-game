import { useEffect, useState } from "react";

// The streamer-mode troll payload. Someone read a decoy join code off a stream
// and typed it in — instead of a game, they get this: an original anime-style
// "GOTCHA" screen with a bouncing chibi, looping forever (until they leave).
// Fully code-drawn, so there's zero copyright risk (no real rickroll video).
export default function TrollScreen({ onExit }) {
  const [t, setT] = useState(0);
  const [line, setLine] = useState(0);
  const LINES = [
    "ニセコード — NICE TRY!",
    "That code was a decoy. 😏",
    "You got bamboozled, friend.",
    "Tell the streamer their secret's safe.",
    "(There is no game here. Only vibes.)",
  ];
  useEffect(() => {
    let raf; const start = performance.now();
    const loop = (now) => { setT((now - start) / 1000); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    const li = setInterval(() => setLine((n) => (n + 1) % LINES.length), 2600);
    return () => { cancelAnimationFrame(raf); clearInterval(li); };
  }, []); // eslint-disable-line

  const bob = Math.sin(t * 3) * 14;          // vertical bounce
  const tilt = Math.sin(t * 3) * 8;          // wiggle
  const hue = (t * 60) % 360;                 // rainbow sweep
  const blink = Math.sin(t * 6) > 0.7;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 999, display: "grid", placeItems: "center", overflow: "hidden",
      background: `radial-gradient(circle at 50% 40%, hsl(${hue},70%,18%), #0a0612 70%)` }}>
      {/* sunburst rays */}
      <svg viewBox="0 0 800 800" style={{ position: "absolute", width: "140vmax", height: "140vmax", opacity: 0.25, transform: `rotate(${t * 20}deg)` }}>
        {Array.from({ length: 24 }).map((_, i) => (
          <polygon key={i} points="400,400 380,0 420,0" fill={i % 2 ? "#ff2d4d" : "#ffc83d"}
            transform={`rotate(${i * 15} 400 400)`} />
        ))}
      </svg>

      <div style={{ position: "relative", textAlign: "center", zIndex: 2 }}>
        {/* chibi: a simple code-drawn bouncing character */}
        <svg width="200" height="220" viewBox="0 0 200 220"
          style={{ transform: `translateY(${bob}px) rotate(${tilt}deg)`, filter: "drop-shadow(0 8px 20px rgba(0,0,0,0.5))" }}>
          {/* legs */}
          <rect x="78" y="150" width="16" height="40" rx="8" fill="#b03038" />
          <rect x="106" y="150" width="16" height="40" rx="8" fill="#b03038" />
          {/* body / vest */}
          <rect x="64" y="96" width="72" height="68" rx="20" fill="#e23b44" stroke="#1a1016" strokeWidth="4" />
          <rect x="90" y="104" width="20" height="52" rx="8" fill="#2a1014" />
          {/* arms waving */}
          <rect x="40" y="100" width="18" height="44" rx="9" fill="#e23b44"
            style={{ transform: `rotate(${Math.sin(t * 6) * 30 - 10}deg)`, transformOrigin: "49px 105px" }} />
          <rect x="142" y="100" width="18" height="44" rx="9" fill="#e23b44"
            style={{ transform: `rotate(${-Math.sin(t * 6) * 30 + 10}deg)`, transformOrigin: "151px 105px" }} />
          {/* head + helmet */}
          <circle cx="100" cy="64" r="40" fill="#ffe0c0" stroke="#1a1016" strokeWidth="4" />
          <path d="M60 56 a40 40 0 0 1 80 0 z" fill="#e23b44" stroke="#1a1016" strokeWidth="4" />
          <rect x="86" y="18" width="6" height="20" fill="#1a1016" />{/* antenna */}
          <circle cx="89" cy="16" r="5" fill="#ffc83d" />
          {/* eyes */}
          {blink
            ? (<><rect x="80" y="66" width="12" height="3" fill="#1a1016" /><rect x="108" y="66" width="12" height="3" fill="#1a1016" /></>)
            : (<><circle cx="86" cy="66" r="6" fill="#1a1016" /><circle cx="114" cy="66" r="6" fill="#1a1016" /></>)}
          {/* grin */}
          <path d="M84 80 q16 14 32 0" stroke="#1a1016" strokeWidth="4" fill="none" strokeLinecap="round" />
        </svg>

        <div className="display" style={{ fontSize: "clamp(48px,10vw,120px)", lineHeight: 0.85, marginTop: 10,
          color: "#fff", textShadow: `0 0 30px hsl(${hue},90%,60%)`, transform: `scale(${1 + Math.sin(t * 3) * 0.04})` }}>
          GOTCHA!
        </div>
        <div className="kanji" style={{ fontSize: 26, color: "#ffc83d", marginTop: 4 }}>引っかかった</div>
        <div className="impactf" style={{ fontSize: 16, marginTop: 18, color: "#fff", minHeight: 22 }}>{LINES[line]}</div>

        <button className="btn btn-hot" style={{ marginTop: 28, fontSize: 16, padding: "10px 28px" }} onClick={onExit}>
          Okay, you got me →
        </button>
      </div>
    </div>
  );
}
