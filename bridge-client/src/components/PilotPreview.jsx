import IsoPilot from "./IsoPilot.jsx";

// A stylized SVG pilot that reflects the equipped loadout. Not final art — a
// readable mannequin that changes with the costume (body color, headpiece,
// breather/tank shapes, ID color on breather+tank) so the locker feels alive.
export default function PilotPreview({ loadout = {}, catalogue }) {
  // Create a dummy player object to feed IsoPilot
  const dummyPlayer = {
    idColor: { hex: "#ff2d4d", name: "Red" }, // Default for preview
    loadout: loadout,
    plane: "physical"
  };

  return (
    <div style={{ position: "relative", width: "100%", maxWidth: 260, height: 320, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={ring} />
      <div style={{ position: "relative", width: 64, height: 96, transform: "scale(2.5)", transformOrigin: "center bottom", marginTop: 80 }}>
        <IsoPilot player={dummyPlayer} facing="SE" moving={false} isYou={false} scale={1} />
      </div>
      <div style={{ position: "absolute", bottom: -10, textAlign: "center", width: "100%" }}>
        <span className="kanji" style={{ fontSize: 12, color: "var(--hot)" }}>識別色</span>
        <span className="faint" style={{ fontSize: 11, marginLeft: 8 }}>Body type determines the base model</span>
      </div>
    </div>
  );
}

const ring = { position: "absolute", inset: "15% 15%", borderRadius: "50%", background: "radial-gradient(circle, rgba(255,45,77,0.10) 0%, transparent 65%)", border: "1px dashed rgba(255,45,77,0.25)" };
