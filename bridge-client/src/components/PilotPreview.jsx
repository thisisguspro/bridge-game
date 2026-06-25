// A stylized SVG pilot that reflects the equipped loadout. Not final art — a
// readable mannequin that changes with the costume (body color, headpiece,
// breather/tank shapes, ID color on breather+tank) so the locker feels alive.
export default function PilotPreview({ loadout = {}, catalogue }) {
  const byId = Object.fromEntries((catalogue?.cosmetics || []).map((c) => [c.id, c]));
  const bodyItem = byId[loadout.body];
  const headItem = byId[loadout.headpiece];
  const breatherItem = byId[loadout.breather];
  const tankItem = byId[loadout.oxygenTank];

  // ID color stand-in (per-match in real games; here a fixed signature hue).
  const idColor = "#ff2d4d";
  const suitColor = bodyTint(bodyItem?.id);

  return (
    <div style={{ position: "relative", width: "100%", maxWidth: 260 }}>
      <div style={ring} />
      <svg viewBox="0 0 200 280" style={{ position: "relative", width: "100%", filter: "drop-shadow(0 12px 24px rgba(0,0,0,0.5))" }}>
        {/* back tank (O2) */}
        <g>
          <rect x="118" y="96" width="26" height="60" rx="8" fill={idColor} opacity="0.9" />
          <rect x="122" y="100" width="18" height="52" rx="6" fill="#1a1620" opacity="0.5" />
          <rect x="124" y="150" width="14" height="10" rx="3" fill="#2a2533" />
          {tankItem?.rarity === "Epic" && <rect x="116" y="92" width="30" height="6" rx="3" fill="var(--r-epic)" />}
        </g>

        {/* body / suit */}
        <path d="M70 150 q-6 -34 30 -38 q36 4 30 38 l-4 70 q-26 10 -52 0 z" fill={suitColor} stroke="#0d0b14" strokeWidth="3" />
        {/* chest emblem */}
        <path d="M92 140 l8 -10 l8 10 l-8 8 z" fill={idColor} />
        {/* arms */}
        <rect x="56" y="120" width="16" height="62" rx="8" fill={suitColor} stroke="#0d0b14" strokeWidth="3" />
        <rect x="128" y="120" width="16" height="62" rx="8" fill={suitColor} stroke="#0d0b14" strokeWidth="3" />

        {/* head */}
        <circle cx="100" cy="78" r="34" fill="#f3d9c6" stroke="#0d0b14" strokeWidth="3" />
        {/* hair / headpiece */}
        {headItem ? (
          <path d="M64 70 q4 -42 36 -44 q32 2 36 44 q-18 -16 -36 -12 q-18 -4 -36 12 z" fill={headTint(headItem.id)} stroke="#0d0b14" strokeWidth="3" />
        ) : (
          <path d="M66 72 q2 -38 34 -40 q32 2 34 40 q-16 -14 -34 -11 q-18 -3 -34 11 z" fill="#2a2230" stroke="#0d0b14" strokeWidth="3" />
        )}
        {/* eyes — bold shonen */}
        <path d="M84 80 l10 -3 l0 7 z" fill="#0d0b14" />
        <path d="M116 80 l-10 -3 l0 7 z" fill="#0d0b14" />

        {/* breather (mouth/nose) — carries ID color */}
        <g>
          <rect x="84" y="90" width="32" height="18" rx="9" fill={idColor} stroke="#0d0b14" strokeWidth="3" />
          <circle cx="92" cy="99" r="3" fill="#0d0b14" opacity="0.6" />
          <circle cx="108" cy="99" r="3" fill="#0d0b14" opacity="0.6" />
          {breatherItem?.rarity === "Epic" && <path d="M84 108 l8 8 l8 -8 z" fill="var(--r-epic)" />}
        </g>

        {/* hose tank->breather */}
        <path d="M118 120 q-30 -2 -10 -16" fill="none" stroke={idColor} strokeWidth="4" opacity="0.7" />
      </svg>
      <div style={{ textAlign: "center", marginTop: 6 }}>
        <span className="kanji" style={{ fontSize: 12, color: idColor }}>識別色</span>
        <span className="faint" style={{ fontSize: 11, marginLeft: 8 }}>ID color shown per match</span>
      </div>
    </div>
  );
}

// Body color shifts with the costume so changes are visible.
function bodyTint(id) {
  return { body_jumpsuit: "#3a4a6a", body_ronin: "#6a2740", body_flight: "#4a3a6a" }[id] || "#33405e";
}
function headTint(id) {
  return { head_cap: "#22303f", head_halo: "#ffe08a", head_visor: "#2a4a55" }[id] || "#3a2f48";
}

const ring = { position: "absolute", inset: "8% 14%", borderRadius: "50%", background: "radial-gradient(circle, rgba(255,45,77,0.10) 0%, transparent 65%)", border: "1px dashed rgba(255,45,77,0.25)" };
