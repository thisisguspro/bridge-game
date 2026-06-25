// An isometric anime pilot model, drawn in SVG so it stays crisp and detailed.
// Reflects the player's ID color (breather + tank), loadout tints, role hint,
// and which way they're walking (facing flips + a subtle bob while moving).
// Rendered at a screen position by IsoStage; this component is just the figure.

export default function IsoPilot({ player, facing = "SE", moving = false, isYou = false, scale = 1 }) {
  const id = player.idColor?.hex || "#9aa";
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
        {/* legs */}
        <rect x="24" y="64" width="7" height="20" rx="3" fill="#23202c" stroke="#0d0b14" strokeWidth="2" />
        <rect x="33" y="64" width="7" height="20" rx="3" fill="#23202c" stroke="#0d0b14" strokeWidth="2" />
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
      </svg>
    </div>
  );
}

function bodyTint(id) { return ({ body_jumpsuit: "#3a4a6a", body_ronin: "#6a2740", body_flight: "#4a3a6a" })[id] || "#33405e"; }
function headTint(id) { return ({ head_cap: "#22303f", head_halo: "#ffe08a", head_visor: "#2a4a55" })[id] || "#3a2f48"; }
