import { useMemo, useState } from "react";
import * as api from "../api/backend.js";
import { SpeedLines, useImpact } from "../components/effects.jsx";
import PilotPreview from "../components/PilotPreview.jsx";

// Locker / cosmetics. Pick a slot, see what you own vs. what's still locked,
// and equip. Equipping requires owning the item AND the slot being unlocked by
// level (the backend enforces both; we mirror it in the UI). Real equip/unequip
// calls hit the backend and we refresh the profile via onChange.
export default function Locker({ profile, catalogue, onChange }) {
  const { pop, layer } = useImpact();
  const [slot, setSlot] = useState("body");
  const [busy, setBusy] = useState(null);

  if (!profile || !catalogue) return <div style={wrap} />;

  const slots = catalogue.slots || [];
  const owned = new Set((profile.owned || []).map((c) => c.id));
  const loadout = profile.loadout || {};
  const bySlot = useMemo(() => {
    const m = {};
    for (const c of catalogue.cosmetics || []) (m[c.slot] ||= []).push(c);
    return m;
  }, [catalogue]);

  const activeSlotDef = slots.find((s) => s.key === slot) || slots[0];
  const slotUnlocked = profile.level >= (activeSlotDef?.unlockLevel || 1);
  const items = bySlot[slot] || [];

  const onEquip = async (item, e) => {
    if (!owned.has(item.id) || !slotUnlocked) return;
    setBusy(item.id);
    try {
      await api.equip(item.id);
      if (e) pop(e.clientX, e.clientY);
      await onChange();
    } catch (err) { console.error(err); }
    finally { setBusy(null); }
  };
  const onUnequip = async () => {
    if (activeSlotDef?.alwaysFilled) return;
    setBusy("unequip");
    try { await api.unequip(slot); await onChange(); } catch (e) { console.error(e); } finally { setBusy(null); }
  };

  return (
    <div style={wrap}>
      <SpeedLines />
      {layer}
      <div style={{ position: "relative", zIndex: 2, height: "100%", display: "grid", gridTemplateColumns: "minmax(280px, 360px) 1fr" }}>
        {/* LEFT: pilot preview */}
        <div style={previewCol}>
          <div className="tag" style={{ marginBottom: 14 }}><span>Loadout</span></div>
          <PilotPreview loadout={loadout} catalogue={catalogue} />
          <div className="col gap-s" style={{ marginTop: 18, width: "100%" }}>
            {slots.filter((s) => loadout[s.key]).map((s) => {
              const c = (catalogue.cosmetics || []).find((x) => x.id === loadout[s.key]);
              return (
                <div key={s.key} className="row" style={equipRow} onClick={() => setSlot(s.key)}>
                  <span className="faint" style={{ fontSize: 10, width: 70, letterSpacing: "0.08em" }}>{s.label.toUpperCase()}</span>
                  <span style={{ fontWeight: 700, fontSize: 13 }}>{c?.name || loadout[s.key]}</span>
                  {s.carriesIdColor && <span className="kanji" style={{ marginLeft: "auto", fontSize: 11, color: "var(--volt)" }} title="Carries your ID color">識</span>}
                </div>
              );
            })}
          </div>
        </div>

        {/* RIGHT: slot tabs + grid */}
        <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div style={tabsRow}>
            {slots.map((s) => {
              const locked = profile.level < (s.unlockLevel || 1);
              const on = s.key === slot;
              return (
                <button key={s.key} onClick={() => setSlot(s.key)} style={{ ...slotTab, ...(on ? slotTabOn : null) }} title={locked ? `Unlocks at level ${s.unlockLevel}` : s.label}>
                  <span className="impactf" style={{ fontSize: 11, letterSpacing: "0.06em" }}>{s.label.toUpperCase()}</span>
                  {locked && <span style={{ fontSize: 10, marginLeft: 6, color: "var(--faint)" }}>🔒{s.unlockLevel}</span>}
                </button>
              );
            })}
          </div>

          <div style={{ padding: "18px 28px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div className="display" style={{ fontSize: 38, lineHeight: 0.9 }}>{activeSlotDef?.label}</div>
              {!slotUnlocked && <div style={{ color: "var(--hot)", fontWeight: 700, fontSize: 13 }}>Reach level {activeSlotDef.unlockLevel} to equip this slot.</div>}
              {slotUnlocked && activeSlotDef?.carriesIdColor && <div className="dim" style={{ fontSize: 13 }}>Always worn · carries your per-match ID color.</div>}
            </div>
            {slotUnlocked && !activeSlotDef?.alwaysFilled && loadout[slot] && (
              <button className="btn btn-ghost" onClick={onUnequip} disabled={busy === "unequip"}>Unequip</button>
            )}
          </div>

          <div style={grid}>
            {items.map((item) => {
              const isOwned = owned.has(item.id);
              const isEquipped = loadout[slot] === item.id;
              const canEquip = isOwned && slotUnlocked && !isEquipped;
              return (
                <button key={item.id} onClick={(e) => canEquip && onEquip(item, e)} disabled={busy === item.id}
                  style={{ ...card, ...(isEquipped ? cardEquipped : null), ...(!isOwned ? cardLocked : null), cursor: canEquip ? "pointer" : "default" }}>
                  <div style={{ ...rarityBar, background: rarityColor(item.rarity) }} />
                  <div style={cardArt(item.rarity)}>
                    <span className="kanji" style={{ fontSize: 30, opacity: isOwned ? 0.9 : 0.25, color: rarityColor(item.rarity) }}>{glyphFor(item.slot)}</span>
                  </div>
                  <div className="impactf" style={{ fontSize: 12, marginTop: 8, color: isOwned ? "var(--paper)" : "var(--faint)" }}>{item.name}</div>
                  <div className="row" style={{ justifyContent: "space-between", marginTop: 4 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", color: rarityColor(item.rarity) }}>{(item.rarity || "Common").toUpperCase()}</span>
                    {!isOwned && <span className="faint" style={{ fontSize: 10 }}>{sourceLabel(item.source)}</span>}
                  </div>
                  {isEquipped && <div style={equippedFlag} className="impactf">EQUIPPED</div>}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function glyphFor(slot) {
  return { breather: "面", oxygenTank: "酸", weapon: "具", bandana: "帯", headpiece: "頭", body: "体", shoes: "靴", belt: "帯", border: "枠", victoryPose: "勝", emote: "笑" }[slot] || "✦";
}
function rarityColor(r) { return { Common: "var(--r-common)", Rare: "var(--r-rare)", Epic: "var(--r-epic)", Legendary: "var(--r-legendary)" }[r] || "var(--r-common)"; }
function sourceLabel(s) { return { level: "LEVEL REWARD", box: "LOOT BOX", starter: "STARTER", code: "CODE" }[s] || "LOCKED"; }

const wrap = { height: "100%", position: "relative", overflow: "hidden", background: "radial-gradient(120% 100% at 20% 0%, #211726 0%, var(--ink) 55%)" };
const previewCol = { borderRight: "2px solid var(--line)", padding: "28px 24px", display: "flex", flexDirection: "column", alignItems: "center", background: "var(--ink-2)", overflowY: "auto" };
const equipRow = { gap: 10, padding: "8px 10px", border: "1px solid var(--line)", background: "var(--ink)", cursor: "pointer" };
const tabsRow = { display: "flex", flexWrap: "wrap", gap: 2, padding: "16px 28px 0", borderBottom: "2px solid var(--line)" };
const slotTab = { padding: "9px 14px", background: "transparent", color: "var(--dim)", borderBottom: "3px solid transparent" };
const slotTabOn = { color: "var(--paper)", borderBottomColor: "var(--hot)" };
const grid = { flex: 1, overflowY: "auto", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 12, padding: "0 28px 28px" };
const card = { position: "relative", textAlign: "left", background: "var(--ink-3)", border: "2px solid var(--line)", padding: 12, clipPath: "polygon(0 0,calc(100% - 10px) 0,100% 10px,100% 100%,10px 100%,0 calc(100% - 10px))", transition: "transform .08s, border-color .12s" };
const cardEquipped = { borderColor: "var(--gold)", boxShadow: "0 0 0 1px rgba(255,200,61,0.3)" };
const cardLocked = { opacity: 0.6 };
const cardArt = (r) => ({ height: 78, display: "grid", placeItems: "center", background: `radial-gradient(circle at 50% 40%, ${rarityColor(r)}22 0%, transparent 70%)`, border: "1px solid var(--line)" });
const rarityBar = { position: "absolute", top: 0, left: 0, right: 0, height: 3 };
const equippedFlag = { position: "absolute", bottom: -2, right: -2, background: "var(--gold)", color: "var(--ink)", fontSize: 9, letterSpacing: "0.08em", padding: "2px 7px" };
