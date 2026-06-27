// Retro 90s OVA-style anime pilot, drawn in SVG: bold black outlines, flat
// cel-shaded color blocks with hard shadow tones, big expressive eyes with
// highlights, and dramatic spiky hair. Reflects the player's ID color (suit
// trim + tank), facing, role, and walk bob. Rendered by IsoStage.

// cel shading: return a darker "shadow" tone of a hex for the hard cel split
function shade(hex, amt = 0.62) {
  const h = hex.replace("#", "");
  const r = Math.round(parseInt(h.slice(0, 2), 16) * amt);
  const g = Math.round(parseInt(h.slice(2, 4), 16) * amt);
  const b = Math.round(parseInt(h.slice(4, 6), 16) * amt);
  return `rgb(${r},${g},${b})`;
}

export default function IsoPilot({ player, facing = "SE", moving = false, isYou = false, scale = 1, showSymbol = true, showLabel = false }) {
  const id = player.idColor?.hex || "#46e6ff";
  const shape = player.idColor?.shape || "circle";
  const colorName = player.idColor?.name;
  const suit = player.loadout?.body ? bodyTint(player.loadout.body) : "#2a2740";
  const suitDark = shade(suit, 0.6);
  const hair = player.loadout?.headpiece ? headTint(player.loadout.headpiece) : "#1a1622";
  const hairDark = shade(typeof hair === "string" && hair.startsWith("#") ? hair : "#1a1622", 0.6);
  const idDark = shade(id, 0.6);
  const flip = facing === "SW" || facing === "NW";
  const back = facing === "NW" || facing === "NE";
  const onEnergy = player.plane === "energy";
  const eliminated = player.plane === "eliminated";
  const OUT = "#0a0810"; // bold outline color

  return (
    <div style={{
      width: 70 * scale, height: 104 * scale, transform: "translate(-50%,-84%)",
      position: "absolute", pointerEvents: "none",
      opacity: eliminated ? 0.25 : onEnergy ? 0.72 : 1,
      filter: isYou
        ? (onEnergy ? "drop-shadow(0 0 14px rgba(70,230,255,0.95))" : "drop-shadow(0 0 12px rgba(255,45,120,0.85))")
        : onEnergy ? "drop-shadow(0 0 9px rgba(70,230,255,0.6)) saturate(0.5)" : "drop-shadow(0 4px 4px rgba(0,0,0,0.6))",
    }}>
      {/* ground shadow */}
      <div style={{ position: "absolute", left: "50%", bottom: 2, width: 44 * scale, height: 16 * scale, transform: "translateX(-50%)", background: onEnergy ? "radial-gradient(ellipse, rgba(70,230,255,0.35) 0%, transparent 70%)" : "radial-gradient(ellipse, rgba(0,0,0,0.5) 0%, transparent 70%)" }} />

      <svg viewBox="0 0 70 104" width={70 * scale} height={104 * scale}
        style={{ position: "absolute", inset: 0, transform: flip ? "scaleX(-1)" : "none", animation: moving ? "pilotbob 0.45s ease-in-out infinite" : "none" }}>

        {/* ---- O2 tank on back ---- */}
        <rect x="41" y="40" width="14" height="30" rx="6" fill={id} stroke={OUT} strokeWidth="3" opacity={back ? 1 : 0.95} />
        <rect x="41" y="40" width="6" height="30" rx="3" fill={idDark} stroke="none" opacity={back ? 0.9 : 0.85} />

        {/* ---- legs (cel-shaded boots) ---- */}
        <g style={{ transformOrigin: "26px 70px", animation: moving ? "stepL 0.45s ease-in-out infinite" : "none" }}>
          <rect x="22" y="68" width="11" height="26" rx="4" fill={suit} stroke={OUT} strokeWidth="3" />
          <rect x="22" y="68" width="4" height="26" fill={suitDark} />
          <rect x="20" y="90" width="15" height="9" rx="3" fill={id} stroke={OUT} strokeWidth="3" />
        </g>
        <g style={{ transformOrigin: "40px 70px", animation: moving ? "stepR 0.45s ease-in-out infinite" : "none" }}>
          <rect x="37" y="68" width="11" height="26" rx="4" fill={suit} stroke={OUT} strokeWidth="3" />
          <rect x="37" y="68" width="4" height="26" fill={suitDark} />
          <rect x="35" y="90" width="15" height="9" rx="3" fill={id} stroke={OUT} strokeWidth="3" />
        </g>

        {/* ---- torso: flight suit with cel shadow + chest emblem ---- */}
        <path d="M20 44 Q20 36 35 36 Q50 36 50 44 L50 70 Q35 76 20 70 Z" fill={suit} stroke={OUT} strokeWidth="3" />
        <path d="M20 44 Q20 36 35 36 L35 72 Q27 71 20 70 Z" fill={suitDark} opacity="0.55" />
        {/* ID-colored chest light / emblem */}
        <circle cx="35" cy="52" r="6" fill={id} stroke={OUT} strokeWidth="2.5" />
        <circle cx="33" cy="50" r="2" fill="#fff" opacity="0.8" />

        {/* ---- arms ---- */}
        <g style={{ transformOrigin: "20px 46px", animation: moving ? "armL 0.45s ease-in-out infinite" : "none" }}>
          <rect x="13" y="44" width="10" height="26" rx="5" fill={suit} stroke={OUT} strokeWidth="3" />
          <rect x="13" y="44" width="4" height="26" fill={suitDark} />
        </g>
        <g style={{ transformOrigin: "50px 46px", animation: moving ? "armR 0.45s ease-in-out infinite" : "none" }}>
          <rect x="47" y="44" width="10" height="26" rx="5" fill={suit} stroke={OUT} strokeWidth="3" />
        </g>

        {/* ---- neck ---- */}
        <rect x="31" y="30" width="8" height="9" fill={shade("#f3d9c6", 0.85)} stroke={OUT} strokeWidth="2.5" />

        {/* ---- HEAD: big anime head, cel-shaded skin ---- */}
        <g>
          {/* skin base */}
          <path d="M18 18 Q18 4 35 4 Q52 4 52 18 Q52 32 35 34 Q18 32 18 18 Z" fill="#fbe3cf" stroke={OUT} strokeWidth="3" />
          {/* cel shadow on one side of face */}
          <path d="M18 18 Q18 4 35 4 L35 34 Q18 32 18 18 Z" fill="#e8b89a" opacity="0.45" />

          {!back ? (
            <>
              {/* ---- big anime eyes ---- */}
              {/* left eye */}
              <ellipse cx="28" cy="20" rx="4.5" ry="6" fill="#fff" stroke={OUT} strokeWidth="2" />
              <ellipse cx="28.5" cy="21" rx="3" ry="4.2" fill={id} />
              <circle cx="28.5" cy="22" r="1.6" fill={OUT} />
              <circle cx="27" cy="19" r="1.4" fill="#fff" />
              {/* right eye */}
              <ellipse cx="42" cy="20" rx="4.5" ry="6" fill="#fff" stroke={OUT} strokeWidth="2" />
              <ellipse cx="41.5" cy="21" rx="3" ry="4.2" fill={id} />
              <circle cx="41.5" cy="22" r="1.6" fill={OUT} />
              <circle cx="40" cy="19" r="1.4" fill="#fff" />
              {/* brows */}
              <path d="M24 13 Q28 11 32 13" stroke={OUT} strokeWidth="2" fill="none" strokeLinecap="round" />
              <path d="M38 13 Q42 11 46 13" stroke={OUT} strokeWidth="2" fill="none" strokeLinecap="round" />
              {/* small nose + mouth */}
              <path d="M35 24 l-1.5 3 h3 z" fill="#e0a884" opacity="0.6" />
              <path d="M31 29 Q35 32 39 29" stroke={OUT} strokeWidth="1.8" fill="none" strokeLinecap="round" />
              {/* blush (cute OVA touch) */}
              <ellipse cx="24" cy="26" rx="3" ry="1.6" fill="#ff7a9c" opacity="0.4" />
              <ellipse cx="46" cy="26" rx="3" ry="1.6" fill="#ff7a9c" opacity="0.4" />
            </>
          ) : (
            // back of head
            <path d="M18 20 Q18 8 35 8 Q52 8 52 20 Z" fill={hairDark} />
          )}

          {/* ---- HAIR: spiky 90s OVA bangs over the forehead ---- */}
          <path d="M16 18 Q14 2 35 2 Q56 2 54 18 Q50 10 44 12 L46 4 Q40 9 38 11 L38 2 Q34 9 32 11 L30 3 Q26 10 24 12 L26 5 Q19 9 16 18 Z"
            fill={typeof hair === "string" && hair.startsWith("#") ? hair : "#1a1622"} stroke={OUT} strokeWidth="3" strokeLinejoin="round" />
          <path d="M16 18 Q14 2 35 2 L35 11 Q30 9 24 12 L26 5 Q19 9 16 18 Z" fill={hairDark} opacity="0.5" />
          {/* hair shine streak (cel highlight) */}
          <path d="M30 4 Q40 4 44 9" stroke="#fff" strokeWidth="1.6" fill="none" opacity="0.5" strokeLinecap="round" />
        </g>
      </svg>

      {/* colorblind symbol badge above head */}
      {showSymbol && !eliminated && (
        <div style={{ position: "absolute", left: "50%", top: -8 * scale, transform: "translateX(-50%)", display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
          <svg viewBox="0 0 24 24" width={20 * scale} height={20 * scale} style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.9))" }}>
            <circle cx="12" cy="12" r="11" fill="rgba(10,8,16,0.9)" stroke={id} strokeWidth="2.5" />
            <g fill={id} stroke={id}>{symbolPath(shape)}</g>
          </svg>
          {showLabel && colorName && (
            <span style={{ fontSize: 9 * scale, fontWeight: 800, color: id, textShadow: "0 1px 2px #000", textTransform: "uppercase", letterSpacing: "0.04em" }}>{colorName}</span>
          )}
        </div>
      )}

      <style>{`
        @keyframes pilotbob{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}
        @keyframes stepL{0%,100%{transform:rotate(13deg)}50%{transform:rotate(-13deg)}}
        @keyframes stepR{0%,100%{transform:rotate(-13deg)}50%{transform:rotate(13deg)}}
        @keyframes armL{0%,100%{transform:rotate(-10deg)}50%{transform:rotate(14deg)}}
        @keyframes armR{0%,100%{transform:rotate(10deg)}50%{transform:rotate(-14deg)}}
      `}</style>
    </div>
  );
}

function bodyTint(body) {
  const map = { default: "#2a2740", crimson: "#7a1a2e", azure: "#1a3a6a", jade: "#1a5a3a", violet: "#3a1a5a", gold: "#6a5a1a" };
  return map[body] || "#2a2740";
}
function headTint(hp) {
  const map = { default: "#1a1622", blonde: "#d9b15a", pink: "#e85a9c", silver: "#b8c0d0", teal: "#2aa0a0", red: "#c0303a" };
  return map[hp] || "#1a1622";
}

// symbol glyphs for the colorblind ID badge (unchanged set)
function symbolPath(shape) {
  switch (shape) {
    case "triangle": return <polygon points="12,5 18,17 6,17" />;
    case "circle": return <circle cx="12" cy="12" r="6" />;
    case "square": return <rect x="7" y="7" width="10" height="10" />;
    case "star": return <polygon points="12,4 14,10 20,10 15,14 17,20 12,16 7,20 9,14 4,10 10,10" />;
    case "diamond": return <polygon points="12,4 19,12 12,20 5,12" />;
    case "hexagon": return <polygon points="12,5 18,8.5 18,15.5 12,19 6,15.5 6,8.5" />;
    case "pentagon": return <polygon points="12,4 19,9.5 16,18 8,18 5,9.5" />;
    case "cross": return <path d="M9 5 h6 v4 h4 v6 h-4 v4 h-6 v-4 h-4 v-6 h4 z" />;
    case "heart": return <path d="M12 19 C4 13 6 6 12 9 C18 6 20 13 12 19 Z" />;
    case "crescent": return <path d="M16 4 a8 8 0 1 0 0 16 a6 6 0 1 1 0 -16 z" />;
    case "arrow": return <polygon points="5,12 13,12 13,7 19,12 13,17 13,12" />;
    case "clover": return <path d="M12 12 m-4 -4 a3 3 0 1 1 4 4 a3 3 0 1 1 4 -4 a3 3 0 1 1 -4 4 a3 3 0 1 1 -4 -4 z" />;
    case "spade": return <path d="M12 4 C6 10 6 14 9 14 C7 14 7 18 12 16 C17 18 17 14 15 14 C18 14 18 10 12 4 Z" />;
    case "club": return <circle cx="12" cy="9" r="3.5" />;
    case "sun": return <g><circle cx="12" cy="12" r="4" /><polygon points="12,2 13,6 11,6" /><polygon points="12,22 13,18 11,18" /><polygon points="2,12 6,11 6,13" /><polygon points="22,12 18,11 18,13" /></g>;
    case "anchor": return <path d="M12 5 a2 2 0 1 1 0 0.1 M12 7 v11 M7 14 a5 5 0 0 0 10 0" stroke="currentColor" strokeWidth="2" fill="none" />;
    case "shell": return <path d="M12 5 a7 7 0 0 1 0 14 q-6 -2 -6 -7 a6 6 0 0 1 6 -7 z" />;
    case "leaf": return <path d="M6 18 C6 8 18 6 18 6 C18 16 8 18 6 18 Z" />;
    case "bolt": return <polygon points="13,3 6,13 11,13 9,21 18,10 12,10" />;
    case "moon": return <path d="M16 4 a8 8 0 1 0 0 16 a6 6 0 1 1 0 -16 z" />;
    default: return <circle cx="12" cy="12" r="6" />;
  }
}
