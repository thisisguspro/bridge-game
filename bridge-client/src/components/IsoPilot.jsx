// An isometric anime pilot model, drawn in SVG so it stays crisp and detailed.
// Reflects the player's ID color (breather + tank), loadout tints, role hint,
// and which way they're walking (facing flips + a subtle bob while moving).
// Rendered at a screen position by IsoStage; this component is just the figure.

export default function IsoPilot({ player, facing = "SE", moving = false, isYou = false, scale = 1, showSymbol = true, showLabel = false }) {
  const id = player.idColor?.hex || "#9aa";
  const shape = player.idColor?.shape || "circle";
  const colorName = player.idColor?.name;
  const suit = bodyTint(player.loadout?.body) ;
  const hair = headTint(player.loadout?.headpiece);
  const flip = facing === "SW" || facing === "NW"; // mirror for left-facing
  const back = facing === "NW" || facing === "NE"; // walking away from camera
  const onEnergy = player.plane === "energy";
  const eliminated = player.plane === "eliminated";

  return (
    <div style={{
      width: 64 * scale, height: 96 * scale, transform: `translate(-50%,-82%)`,
      position: "absolute", pointerEvents: "none",
      opacity: eliminated ? 0.25 : onEnergy ? 0.7 : 1,
      filter: isYou
        ? (onEnergy ? "drop-shadow(0 0 12px rgba(70,230,255,0.9))" : "drop-shadow(0 0 10px rgba(255,45,77,0.7))")
        : onEnergy ? "drop-shadow(0 0 8px rgba(70,230,255,0.6)) saturate(0.5)" : "drop-shadow(0 4px 4px rgba(0,0,0,0.5))",
    }}>
      {/* ground shadow (iso ellipse) */}
      <div style={{ position: "absolute", left: "50%", bottom: 2, width: 40 * scale, height: 16 * scale, transform: "translateX(-50%)", background: onEnergy ? "radial-gradient(ellipse, rgba(70,230,255,0.3) 0%, transparent 70%)" : "radial-gradient(ellipse, rgba(0,0,0,0.45) 0%, transparent 70%)" }} />
      <svg viewBox="0 0 64 96" width={64 * scale} height={96 * scale} style={{ position: "absolute", inset: 0, transform: flip ? "scaleX(-1)" : "none", animation: moving ? "pilotbob 0.5s ease-in-out infinite" : "none" }}>
        {/* O2 tank on back */}
        <rect x="38" y="34" width="13" height="30" rx="5" fill={id} stroke="#0d0b14" strokeWidth="2.5" opacity={back ? 1 : 0.95} />
        {/* legs — alternating stride while moving (code-drawn walk cycle) */}
        <rect x="24" y="64" width="7" height="20" rx="3" fill="#23202c" stroke="#0d0b14" strokeWidth="2"
          style={{ transformOrigin: "27px 64px", animation: moving ? "stepL 0.5s ease-in-out infinite" : "none" }} />
        <rect x="33" y="64" width="7" height="20" rx="3" fill="#23202c" stroke="#0d0b14" strokeWidth="2"
          style={{ transformOrigin: "36px 64px", animation: moving ? "stepR 0.5s ease-in-out infinite" : "none" }} />
        {/* torso / suit */}
        <path d="M20 44 q-2 -14 12 -15 q14 1 12 15 l-2 22 q-10 5 -20 0 z" fill={suit} stroke="#0d0b14" strokeWidth="2.5" />
        {/* chest ID flash */}
        <path d="M29 50 l3 -4 l3 4 l-3 4 z" fill={id} />
        {/* arms */}
        <rect x="14" y="46" width="7" height="20" rx="3.5" fill={suit} stroke="#0d0b14" strokeWidth="2" />
        <rect x="43" y="46" width="7" height="20" rx="3.5" fill={suit} stroke="#0d0b14" strokeWidth="2" />
        {/* head */}
        <circle cx="32" cy="28" r="15" fill={back ? hair : "#f3d9c6"} stroke="#0d0b14" strokeWidth="2.5" />
        {!back && <>
          {/* hair */}
          <path d="M18 26 q1 -18 14 -19 q13 1 14 19 q-7 -7 -14 -5 q-7 -2 -14 5 z" fill={hair} stroke="#0d0b14" strokeWidth="2" />
          {/* eyes — bold shonen */}
          <path d="M25 28 l5 -1.5 l0 4 z" fill="#0d0b14" />
          <path d="M39 28 l-5 -1.5 l0 4 z" fill="#0d0b14" />
          {/* breather — ID color */}
          <rect x="26" y="33" width="12" height="8" rx="4" fill={id} stroke="#0d0b14" strokeWidth="2" />
        </>}
        {back && <path d="M18 24 q1 -16 14 -17 q13 1 14 17 q-7 -5 -14 -4 q-7 -1 -14 4 z" fill={hair} stroke="#0d0b14" strokeWidth="2" />}
        <style>{`@keyframes stepL{0%,100%{transform:rotate(14deg)}50%{transform:rotate(-14deg)}} @keyframes stepR{0%,100%{transform:rotate(-14deg)}50%{transform:rotate(14deg)}}`}</style>
      </svg>

      {/* colorblind ID badge above the head: the player's symbol in their color,
          on a dark chip so it reads on any floor. Pairs color + shape so players
          are distinguishable without relying on color alone. */}
      {showSymbol && !eliminated && (
        <div style={{ position: "absolute", left: "50%", top: -6 * scale, transform: "translateX(-50%)",
          display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
          <svg viewBox="0 0 24 24" width={20 * scale} height={20 * scale}
            style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.8))" }}>
            <circle cx="12" cy="12" r="11" fill="rgba(13,11,20,0.85)" stroke={id} strokeWidth="2" />
            <g fill={id} stroke={id}>{symbolPath(shape)}</g>
          </svg>
          {showLabel && colorName && (
            <span style={{ fontSize: 9 * scale, fontWeight: 700, color: id, textShadow: "0 1px 2px #000",
              textTransform: "uppercase", letterSpacing: "0.04em" }}>{colorName}</span>
          )}
        </div>
      )}
    </div>
  );
}

// Small symbol glyphs (centered in a 24x24 box) keyed to ID_COLORS' shape names.
// Each is visually distinct so colorblind players can tell pilots apart.
function symbolPath(shape) {
  switch (shape) {
    case "triangle": return <polygon points="12,5 18,17 6,17" />;
    case "circle":   return <circle cx="12" cy="12" r="6" />;
    case "square":   return <rect x="7" y="7" width="10" height="10" />;
    case "star":     return <polygon points="12,4 14,10 20,10 15,14 17,20 12,16 7,20 9,14 4,10 10,10" />;
    case "diamond":  return <polygon points="12,4 19,12 12,20 5,12" />;
    case "hexagon":  return <polygon points="12,5 18,8.5 18,15.5 12,19 6,15.5 6,8.5" />;
    case "pentagon": return <polygon points="12,4 19,9.5 16,18 8,18 5,9.5" />;
    case "cross":    return <path d="M9 5 h6 v4 h4 v6 h-4 v4 h-6 v-4 h-4 v-6 h4 z" />;
    case "heart":    return <path d="M12 19 C4 13 6 6 12 9 C18 6 20 13 12 19 Z" />;
    case "crescent": return <path d="M16 4 a8 8 0 1 0 0 16 a6 6 0 1 1 0 -16 z" />;
    case "arrow":    return <polygon points="5,12 13,12 13,7 19,12 13,17 13,12" />;
    case "clover":   return <path d="M12 12 m-4 -4 a3 3 0 1 1 4 4 a3 3 0 1 1 4 -4 a3 3 0 1 1 -4 4 a3 3 0 1 1 -4 -4 z" />;
    case "spade":    return <path d="M12 4 C6 10 6 14 9 14 C7 14 7 18 12 16 C17 18 17 14 15 14 C18 14 18 10 12 4 Z" />;
    case "club":     return <circle cx="12" cy="9" r="3.5" />;
    case "sun":      return <g><circle cx="12" cy="12" r="4" /><polygon points="12,2 13,6 11,6" /><polygon points="12,22 13,18 11,18" /><polygon points="2,12 6,11 6,13" /><polygon points="22,12 18,11 18,13" /></g>;
    case "anchor":   return <path d="M12 5 a2 2 0 1 1 0 0.1 M12 7 v11 M7 14 a5 5 0 0 0 10 0" stroke="currentColor" strokeWidth="2" fill="none" />;
    case "shell":    return <path d="M12 5 a7 7 0 0 1 0 14 q-6 -2 -6 -7 a6 6 0 0 1 6 -7 z" />;
    case "leaf":     return <path d="M6 18 C6 8 18 6 18 6 C18 16 8 18 6 18 Z" />;
    case "bolt":     return <polygon points="13,3 6,13 11,13 9,21 18,10 12,10" />;
    case "moon":     return <path d="M16 4 a8 8 0 1 0 0 16 a6 6 0 1 1 0 -16 z" />;
    default:         return <circle cx="12" cy="12" r="6" />;
  }
}

function bodyTint(id) { return ({ body_jumpsuit: "#3a4a6a", body_ronin: "#6a2740", body_flight: "#4a3a6a" })[id] || "#33405e"; }
function headTint(id) { return ({ head_cap: "#22303f", head_halo: "#ffe08a", head_visor: "#2a4a55" })[id] || "#3a2f48"; }
