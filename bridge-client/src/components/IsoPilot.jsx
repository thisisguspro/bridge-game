// Sleek android-cowboy, drawn in SVG: humanlike but clearly robotic — metal
// chassis with panel seams, a glowing visor band for eyes, a brimmed hat, and
// ID-colored accents (chest core, hat band, boots). Western frontier on a
// future train. Reflects ID color, facing, role, walk bob.

function shade(hex, amt = 0.6) {
  const h = hex.replace("#", "");
  const r = Math.round(parseInt(h.slice(0, 2), 16) * amt);
  const g = Math.round(parseInt(h.slice(2, 4), 16) * amt);
  const b = Math.round(parseInt(h.slice(4, 6), 16) * amt);
  return `rgb(${r},${g},${b})`;
}

export default function IsoPilot({ player, facing = "SE", moving = false, isYou = false, scale = 1, showSymbol = true, showLabel = false }) {
  const id = player.idColor?.hex || "#e0a93a";
  const shape = player.idColor?.shape || "circle";
  const colorName = player.idColor?.name;
  const idDark = shade(id, 0.6);
  // metal chassis tones (brushed steel / gunmetal, warm under saloon light)
  const steel = "#9a9488";
  const steelDark = "#5f5a51";
  const steelShadow = "#403c35";
  const hat = "#3a2417";       // dark felt cowboy hat
  const hatDark = "#241509";
  const flip = facing === "SW" || facing === "NW";
  const back = facing === "NW" || facing === "NE";
  const onEnergy = player.plane === "energy"; // (handled as a drone elsewhere)
  const eliminated = player.plane === "eliminated";
  const OUT = "#1a120a"; // dark outline (wood-ink, not pure black)

  return (
    <div style={{
      width: 72 * scale, height: 108 * scale, transform: "translate(-50%,-84%)",
      position: "absolute", pointerEvents: "none",
      opacity: eliminated ? 0.25 : 1,
      filter: isYou
        ? "drop-shadow(0 0 12px rgba(224,169,58,0.85))"
        : "drop-shadow(0 4px 4px rgba(0,0,0,0.6))",
    }}>
      {/* ground shadow */}
      <div style={{ position: "absolute", left: "50%", bottom: 2, width: 46 * scale, height: 16 * scale, transform: "translateX(-50%)", background: "radial-gradient(ellipse, rgba(0,0,0,0.5) 0%, transparent 70%)" }} />

      <svg viewBox="0 0 72 108" width={72 * scale} height={108 * scale}
        style={{ position: "absolute", inset: 0, transform: flip ? "scaleX(-1)" : "none", animation: moving ? "pilotbob 0.45s ease-in-out infinite" : "none" }}>

        {/* ---- power-cell backpack (the "battery") ---- */}
        <rect x="43" y="40" width="13" height="26" rx="3" fill={steelDark} stroke={OUT} strokeWidth="3" opacity={back ? 1 : 0.95} />
        <rect x="46" y="44" width="7" height="5" rx="1" fill={id} />
        <rect x="46" y="52" width="7" height="3" rx="1" fill={id} opacity="0.7" />

        {/* ---- legs: armored with ID-trim boots ---- */}
        <g style={{ transformOrigin: "27px 70px", animation: moving ? "stepL 0.45s ease-in-out infinite" : "none" }}>
          <rect x="23" y="66" width="11" height="27" rx="3" fill={steel} stroke={OUT} strokeWidth="3" />
          <rect x="23" y="66" width="4" height="27" fill={steelShadow} />
          <rect x="22" y="76" width="13" height="3" fill={steelDark} />
          <rect x="21" y="89" width="15" height="10" rx="2" fill={steelDark} stroke={OUT} strokeWidth="3" />
          <rect x="21" y="89" width="15" height="3" fill={id} />
        </g>
        <g style={{ transformOrigin: "45px 70px", animation: moving ? "stepR 0.45s ease-in-out infinite" : "none" }}>
          <rect x="38" y="66" width="11" height="27" rx="3" fill={steel} stroke={OUT} strokeWidth="3" />
          <rect x="38" y="66" width="4" height="27" fill={steelShadow} />
          <rect x="37" y="76" width="13" height="3" fill={steelDark} />
          <rect x="36" y="89" width="15" height="10" rx="2" fill={steelDark} stroke={OUT} strokeWidth="3" />
          <rect x="36" y="89" width="15" height="3" fill={id} />
        </g>

        {/* ---- torso: armored chest plate + chest core + bandolier ---- */}
        <path d="M21 44 Q21 37 36 37 Q51 37 51 44 L51 68 Q36 73 21 68 Z" fill={steel} stroke={OUT} strokeWidth="3" />
        <path d="M21 44 Q21 37 36 37 L36 70 Q28 69 21 68 Z" fill={steelShadow} opacity="0.55" />
        {/* bandolier strap with bullet studs */}
        <path d="M23 42 L49 64" stroke={hatDark} strokeWidth="4" />
        <circle cx="29" cy="48" r="1.3" fill={id} /><circle cx="35" cy="53" r="1.3" fill={id} /><circle cx="41" cy="58" r="1.3" fill={id} />
        {/* glowing chest core (battery indicator) */}
        <circle cx="36" cy="53" r="5.5" fill={idDark} stroke={OUT} strokeWidth="2.5" />
        <circle cx="36" cy="53" r="2.6" fill={id} />
        <circle cx="34.5" cy="51.5" r="1" fill="#fff" opacity="0.85" />

        {/* ---- arms: pistons + gloved metal hands ---- */}
        <g style={{ transformOrigin: "21px 46px", animation: moving ? "armL 0.45s ease-in-out infinite" : "none" }}>
          <rect x="14" y="44" width="9" height="24" rx="4" fill={steel} stroke={OUT} strokeWidth="3" />
          <rect x="14" y="44" width="3.5" height="24" fill={steelShadow} />
          <circle cx="18.5" cy="68" r="4" fill={steelDark} stroke={OUT} strokeWidth="2.5" />
        </g>
        <g style={{ transformOrigin: "51px 46px", animation: moving ? "armR 0.45s ease-in-out infinite" : "none" }}>
          <rect x="49" y="44" width="9" height="24" rx="4" fill={steel} stroke={OUT} strokeWidth="3" />
          <circle cx="53.5" cy="68" r="4" fill={steelDark} stroke={OUT} strokeWidth="2.5" />
        </g>

        {/* ---- neck joint ---- */}
        <rect x="32" y="31" width="8" height="8" fill={steelDark} stroke={OUT} strokeWidth="2.5" />

        {/* ---- HEAD: robotic, with a glowing visor for eyes ---- */}
        <g>
          {/* metal skull */}
          <rect x="22" y="12" width="28" height="22" rx="8" fill={steel} stroke={OUT} strokeWidth="3" />
          <rect x="22" y="12" width="10" height="22" rx="8" fill={steelShadow} opacity="0.5" />
          {/* cheek/jaw seam */}
          <path d="M25 28 H47" stroke={steelShadow} strokeWidth="1.5" />
          {/* side audio pods */}
          <rect x="19" y="20" width="4" height="8" rx="2" fill={steelDark} stroke={OUT} strokeWidth="2" />
          <rect x="49" y="20" width="4" height="8" rx="2" fill={steelDark} stroke={OUT} strokeWidth="2" />

          {!back ? (
            <>
              {/* glowing visor band (the eyes) */}
              <rect x="25" y="19" width="22" height="7" rx="3.5" fill="#0d0a06" stroke={OUT} strokeWidth="2" />
              <rect x="27" y="20.5" width="18" height="4" rx="2" fill={id} />
              {/* two bright optic dots */}
              <circle cx="31" cy="22.5" r="1.8" fill="#fff" />
              <circle cx="41" cy="22.5" r="1.8" fill="#fff" />
              {/* faint mouth grille */}
              <rect x="32" y="29" width="8" height="2.5" rx="1" fill={steelDark} />
              <line x1="34" y1="29" x2="34" y2="31.5" stroke={OUT} strokeWidth="0.6" />
              <line x1="36" y1="29" x2="36" y2="31.5" stroke={OUT} strokeWidth="0.6" />
              <line x1="38" y1="29" x2="38" y2="31.5" stroke={OUT} strokeWidth="0.6" />
            </>
          ) : (
            <rect x="25" y="18" width="22" height="10" rx="3" fill={steelShadow} />
          )}

          {/* ---- COWBOY HAT ---- */}
          {/* brim */}
          <ellipse cx="36" cy="13" rx="22" ry="5.5" fill={hat} stroke={OUT} strokeWidth="3" />
          <ellipse cx="36" cy="12" rx="22" ry="4.5" fill={hatDark} opacity="0.4" />
          {/* crown */}
          <path d="M26 13 Q26 1 36 1 Q46 1 46 13 Z" fill={hat} stroke={OUT} strokeWidth="3" />
          <path d="M26 13 Q26 1 36 1 L36 13 Z" fill={hatDark} opacity="0.45" />
          {/* ID-colored hat band */}
          <rect x="26" y="9" width="20" height="3.5" fill={id} />
          <circle cx="36" cy="10.7" r="1.6" fill={idDark} stroke={OUT} strokeWidth="0.8" />
        </g>
      </svg>

      {/* colorblind symbol badge — a sheriff-ish star plate above the hat */}
      {showSymbol && !eliminated && (
        <div style={{ position: "absolute", left: "50%", top: -10 * scale, transform: "translateX(-50%)", display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
          <svg viewBox="0 0 24 24" width={20 * scale} height={20 * scale} style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.9))" }}>
            <circle cx="12" cy="12" r="11" fill="rgba(26,18,10,0.92)" stroke={id} strokeWidth="2.5" />
            <g fill={id} stroke={id}>{symbolPath(shape)}</g>
          </svg>
          {showLabel && colorName && (
            <span style={{ fontSize: 9 * scale, fontWeight: 800, color: id, textShadow: "0 1px 2px #000", textTransform: "uppercase", letterSpacing: "0.04em" }}>{colorName}</span>
          )}
        </div>
      )}

      <style>{`
        @keyframes pilotbob{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}
        @keyframes stepL{0%,100%{transform:rotate(12deg)}50%{transform:rotate(-12deg)}}
        @keyframes stepR{0%,100%{transform:rotate(-12deg)}50%{transform:rotate(12deg)}}
        @keyframes armL{0%,100%{transform:rotate(-9deg)}50%{transform:rotate(13deg)}}
        @keyframes armR{0%,100%{transform:rotate(9deg)}50%{transform:rotate(-13deg)}}
      `}</style>
    </div>
  );
}

// symbol glyphs for the colorblind ID badge
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
    case "bolt": return <polygon points="13,3 6,13 11,13 9,21 18,10 12,10" />;
    case "moon": return <path d="M16 4 a8 8 0 1 0 0 16 a6 6 0 1 1 0 -16 z" />;
    default: return <circle cx="12" cy="12" r="6" />;
  }
}
