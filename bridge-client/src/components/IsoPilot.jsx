import React from "react";
import ColorblindSymbol from "./ColorblindSymbol.jsx";

// An isometric anime pilot model, drawn in SVG so it stays crisp and detailed.
// Reflects the player's ID color (breather + tank), loadout tints, role hint,
// and which way they're walking (facing flips + a subtle bob while moving).
// Rendered at a screen position by IsoStage; this component is just the figure.

export default function IsoPilot({ player, facing = "SE", moving = false, isYou = false, scale = 1, showColorblind = false }) {
  const id = player.idColor?.hex || "#9aa";
  const suit = bodyTint(player.loadout?.body) ;
  const hair = headTint(player.loadout?.headpiece);
  const flip = facing === "SW" || facing === "NW"; // mirror for left-facing
  const back = facing === "NW" || facing === "NE"; // walking away from camera
  const onEnergy = player.plane === "energy";
  const eliminated = player.plane === "eliminated";

  // Emote logic
  const emote = player.emote ? player.emote : eliminated ? '💀' : null;

  return (
    <div style={{
      width: 64 * scale, height: 96 * scale, transform: `translate(-50%,-82%)`,
      position: "absolute", pointerEvents: "none",
      opacity: eliminated ? 0.25 : onEnergy ? 0.5 : 1,
      filter: isYou
        ? (onEnergy ? "hue-rotate(180deg) brightness(1.5) drop-shadow(0 0 16px rgba(70,230,255,0.9))" : "drop-shadow(0 0 10px rgba(255,200,61,0.8))")
        : onEnergy ? "hue-rotate(180deg) brightness(1.5) drop-shadow(0 0 10px rgba(70,230,255,0.6))" : "drop-shadow(0 4px 4px rgba(0,0,0,0.5))",
      animation: onEnergy ? "ghostFloat 2s ease-in-out infinite" : undefined,
    }}>
      {/* ground shadow (iso ellipse) */}
      <div style={{ position: "absolute", left: "50%", bottom: 2, width: 40 * scale, height: 16 * scale, transform: "translateX(-50%)", background: onEnergy ? "radial-gradient(ellipse, rgba(70,230,255,0.4) 0%, transparent 70%)" : "radial-gradient(ellipse, rgba(0,0,0,0.6) 0%, transparent 70%)" }} />
      
      {showColorblind && (
        <div style={{ position: "absolute", top: -20, left: "50%", transform: "translateX(-50%)", zIndex: 10 }}>
          <ColorblindSymbol colorName={player?.idColor?.name} colorHex={player?.idColor?.hex} size={20 * scale} />
        </div>
      )}
      {/* Anime emote bubble */}
      {emote && (
        <div style={{ position: "absolute", top: -28 * scale, left: "50%", transform: "translateX(-50%)", fontSize: 18 * scale, zIndex: 15, animation: "emotePopIn 0.3s ease-out", pointerEvents: "none", filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.6))" }}>
          {emote}
        </div>
      )}

      <svg viewBox="0 0 64 96" width="100%" height="100%" style={{
        transform: flip ? "scaleX(-1)" : "none",
        transformOrigin: "50% 85%",
        animation: moving ? "pilotWalking 0.4s infinite alternate ease-in-out" : "pilotBreathe 2.5s infinite ease-in-out"
      }}>
        {/* tank */}
        <rect x="18" y="24" width="28" height="30" rx="5" fill={id} stroke="#0d0b14" strokeWidth="2.5" opacity={back ? 1 : 0.95} />
        {/* legs */}
        <rect x="24" y="64" width="7" height="20" rx="3" fill="#23202c" stroke="#0d0b14" strokeWidth="2" className={moving ? "legLeft" : ""} />
        <rect x="33" y="64" width="7" height="20" rx="3" fill="#23202c" stroke="#0d0b14" strokeWidth="2" className={moving ? "legRight" : ""} />
        {/* torso / suit */}
        <path d="M20 44 q-2 -14 12 -15 q14 1 12 15 l-2 22 q-10 5 -20 0 z" fill={suit} stroke="#0d0b14" strokeWidth="2.5" />
        {/* chest ID flash */}
        <path d="M29 50 l3 -4 l3 4 l-3 4 z" fill={id} />
        {/* arms */}
        <rect x="14" y="46" width="7" height="20" rx="3.5" fill={suit} stroke="#0d0b14" strokeWidth="2" className={moving ? "armLeft" : ""} />
        <rect x="43" y="46" width="7" height="20" rx="3.5" fill={suit} stroke="#0d0b14" strokeWidth="2" className={moving ? "armRight" : ""} />
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
      <style>{`
        @keyframes pilotBreathe {
          0%, 100% { transform: scaleY(1) scaleX(1); }
          50% { transform: scaleY(1.015) scaleX(0.99); }
        }
        @keyframes pilotWalking {
          0%, 100% { transform: translateY(0px) scaleY(1); }
          50% { transform: translateY(-3px) scaleY(0.97); }
        }
        @keyframes ghostFloat {
          0%, 100% { transform: translate(-50%,-82%) translateY(0); }
          50% { transform: translate(-50%,-82%) translateY(-6px); }
        }
        @keyframes emotePopIn {
          0% { transform: translateX(-50%) scale(0) translateY(8px); opacity: 0; }
          60% { transform: translateX(-50%) scale(1.2) translateY(-2px); opacity: 1; }
          100% { transform: translateX(-50%) scale(1) translateY(0); opacity: 1; }
        }
        .legLeft { animation: legSwop 0.4s infinite alternate ease-in-out; transform-origin: top center; transform-box: fill-box; }
        .legRight { animation: legSwop 0.4s infinite alternate-reverse ease-in-out; transform-origin: top center; transform-box: fill-box; }
        .armLeft { animation: armSwop 0.4s infinite alternate ease-in-out; transform-origin: top center; transform-box: fill-box; }
        .armRight { animation: armSwop 0.4s infinite alternate-reverse ease-in-out; transform-origin: top center; transform-box: fill-box; }
        @keyframes legSwop {
          0% { transform: translateY(0) rotate(15deg); }
          100% { transform: translateY(-4px) rotate(-15deg); }
        }
        @keyframes armSwop {
          0% { transform: rotate(-15deg); }
          100% { transform: rotate(15deg); }
        }
      `}</style>
    </div>
  );
}

function bodyTint(id) { return ({ body_jumpsuit: "#3a4a6a", body_ronin: "#6a2740", body_flight: "#4a3a6a", body_mecha: "#445566" })[id] || "#33405e"; }
function headTint(id) { return ({ head_cap: "#22303f", head_halo: "#ffe08a", head_visor: "#2a4a55" })[id] || "#3a2f48"; }
