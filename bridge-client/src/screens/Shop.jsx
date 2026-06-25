import { useEffect, useState, useCallback } from "react";
import * as api from "../api/backend.js";
import { SpeedLines, Particles, useImpact, KanjiFlash } from "../components/effects.jsx";

// Shop. Three storefronts: Credits (earned), Cash (real money / $1 test items via
// Stripe stub checkout), and Loot Boxes (server-rolled). Reads the real catalogue
// + wallet from the backend; never sees admin-only worth/dropWeight. Buying a
// credits item and opening a box are immediate; cash items run the Stripe stub
// checkout (create session -> simulate webhook -> item granted).
export default function Shop({ profile, catalogue, onChange }) {
  const { pop, layer } = useImpact();
  const [tab, setTab] = useState("credits");
  const [wallet, setWallet] = useState({ CREDITS: 0, PREMIUM: 0 });
  const [items, setItems] = useState([]);
  const [boxes, setBoxes] = useState([]);
  const [busy, setBusy] = useState(null);
  const [reveal, setReveal] = useState(null);     // box/cash reward reveal overlay
  const [flash, setFlash] = useState(null);
  const [note, setNote] = useState(null);

  const cosmeticsById = Object.fromEntries((catalogue?.cosmetics || []).map((c) => [c.id, c]));

  const refresh = useCallback(async () => {
    const [w, ci, pi, bx] = await Promise.all([
      api.getWallet(),
      api.listItems("CREDITS"),
      api.listItems("PREMIUM"),
      api.listBoxes(),
    ]);
    setWallet(w);
    setItems([...ci, ...pi]);
    setBoxes(bx);
  }, []);
  useEffect(() => { refresh().catch((e) => setNote(e.message)); }, [refresh]);

  const toast = (m) => { setNote(m); setTimeout(() => setNote(null), 2600); };

  const buyCredits = async (it, e) => {
    setBusy(it.id);
    try {
      const r = await api.buyItem(it.id);
      if (e) pop(e.clientX, e.clientY);
      setWallet((w) => ({ ...w, CREDITS: r.balance }));
      setFlash({ text: "入手", sub: `${it.name} acquired`, color: "var(--gold)" });
      await onChange?.();
    } catch (err) { toast(err.message); } finally { setBusy(null); }
  };

  const buyCash = async (it) => {
    setBusy(it.id);
    try {
      const session = await api.checkoutItems([it.id]);
      // STUB: with live Stripe this is a redirect to session.checkoutUrl. In dev,
      // we complete the purchase by sending the simulate-webhook body.
      if (session.devSimulate) {
        await api.devCompleteCheckout(session.devSimulate.body);
        setReveal({ item: it, kind: "cash", priceDisplay: session.priceDisplay });
        await refresh(); await onChange?.();
      } else if (session.checkoutUrl) {
        window.location.href = session.checkoutUrl; // live Stripe hosted checkout
      }
    } catch (err) { toast(err.message); } finally { setBusy(null); }
  };

  const openBox = async (box, e) => {
    if (wallet[box.currency] < box.price) return toast(`Not enough ${box.currency}.`);
    setBusy(box.id);
    try {
      if (e) pop(e.clientX, e.clientY);
      const r = await api.openBox(box.id);
      setWallet((w) => ({ ...w, [box.currency]: r.balance }));
      setReveal({ reward: r.reward, kind: "box", boxName: box.name });
      await onChange?.();
    } catch (err) { toast(err.message); } finally { setBusy(null); }
  };

  if (!catalogue) return <div style={wrap} />;
  const creditsItems = items.filter((i) => i.currency === "CREDITS");
  const cashItems = items.filter((i) => i.currency === "PREMIUM");

  return (
    <div style={wrap}>
      <SpeedLines hot />
      <Particles density={22} color="rgba(255,200,61,0.4)" />
      {layer}
      {flash && <KanjiFlash {...flash} onDone={() => setFlash(null)} />}
      {reveal && <RevealOverlay reveal={reveal} cosmeticsById={cosmeticsById} onClose={() => setReveal(null)} />}
      {note && <div style={toastStyle}>{note}</div>}

      <div style={{ position: "relative", zIndex: 2, height: "100%", display: "flex", flexDirection: "column" }}>
        {/* header: title + balances */}
        <div style={{ padding: "26px 36px 0", display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div>
            <div className="kanji" style={{ fontSize: 18, color: "var(--hot)", letterSpacing: "0.3em" }}>商店</div>
            <h1 className="display" style={{ fontSize: 64, margin: 0, lineHeight: 0.85 }}>SHOP</h1>
          </div>
          <div className="row gap-m">
            <Balance label="CREDITS" value={wallet.CREDITS} color="var(--volt)" kanji="信" />
            <Balance label="PRISMS" value={wallet.PREMIUM} color="var(--violet)" kanji="晶" />
          </div>
        </div>

        {/* tabs */}
        <div style={{ display: "flex", gap: 2, padding: "16px 36px 0", borderBottom: "2px solid var(--line)" }}>
          {[["credits", "Credits Store"], ["cash", "Cash Store"], ["boxes", "Loot Boxes"]].map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} style={{ ...tabBtn, ...(tab === k ? tabOn : null) }}>
              <span className="impactf" style={{ fontSize: 12 }}>{label.toUpperCase()}</span>
            </button>
          ))}
        </div>

        {/* body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "22px 36px 40px" }}>
          {tab === "credits" && (
            <Grid>
              {creditsItems.map((it) => (
                <ItemCard key={it.id} it={it} cosmetic={cosmeticsById[it.cosmeticId]} owned={isOwned(profile, it)} busy={busy === it.id}
                  cur="CREDITS" canAfford={wallet.CREDITS >= it.price} onBuy={(e) => buyCredits(it, e)} />
              ))}
            </Grid>
          )}
          {tab === "cash" && (
            <>
              <div className="panel" style={{ padding: "10px 16px", marginBottom: 16, borderColor: "var(--hot-deep)", display: "inline-block" }}>
                <span className="impactf" style={{ fontSize: 11, color: "var(--gold)" }}>TEST MODE</span>
                <span className="dim" style={{ fontSize: 13, marginLeft: 10 }}>Real-money items run through Stripe in test mode — no card is charged.</span>
              </div>
              <Grid>
                {cashItems.map((it) => (
                  <ItemCard key={it.id} it={it} cosmetic={cosmeticsById[it.cosmeticId]} owned={isOwned(profile, it)} busy={busy === it.id}
                    cur="cash" canAfford={true} onBuy={() => buyCash(it)} />
                ))}
              </Grid>
            </>
          )}
          {tab === "boxes" && (
            <Grid>
              {boxes.map((box) => (
                <BoxCard key={box.id} box={box} busy={busy === box.id} balance={wallet[box.currency]}
                  onOpen={(e) => openBox(box, e)} />
              ))}
            </Grid>
          )}
        </div>
      </div>
    </div>
  );
}

function isOwned(profile, it) {
  return !!it.cosmeticId && (profile?.owned || []).some((o) => o.id === it.cosmeticId);
}

function Balance({ label, value, color, kanji }) {
  return (
    <div className="panel" style={{ padding: "8px 16px", display: "flex", alignItems: "center", gap: 10 }}>
      <span className="kanji" style={{ fontSize: 18, color }}>{kanji}</span>
      <div>
        <div className="faint" style={{ fontSize: 9, letterSpacing: "0.12em" }}>{label}</div>
        <div className="display" style={{ fontSize: 24, lineHeight: 0.9, color }}>{(value ?? 0).toLocaleString()}</div>
      </div>
    </div>
  );
}

function Grid({ children }) {
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 14 }}>{children}</div>;
}

function ItemCard({ it, cosmetic, owned, busy, cur, canAfford, onBuy }) {
  const rc = rarityColor(it.rarity);
  const price = cur === "cash" ? `$${((it.priceCents || 0) / 100).toFixed(2)}` : it.price.toLocaleString();
  return (
    <div className="panel" style={{ padding: 14, position: "relative" }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: rc }} />
      <div style={{ height: 90, display: "grid", placeItems: "center", background: `radial-gradient(circle at 50% 40%, ${rc}22 0%, transparent 70%)`, border: "1px solid var(--line)" }}>
        <span className="kanji" style={{ fontSize: 34, color: rc }}>{glyphFor(cosmetic?.slot)}</span>
      </div>
      <div className="impactf" style={{ fontSize: 13, marginTop: 10 }}>{it.name}</div>
      <div style={{ fontSize: 10, fontWeight: 700, color: rc, letterSpacing: "0.08em" }}>{(it.rarity || "Common").toUpperCase()}</div>
      <div style={{ marginTop: 12 }}>
        {owned ? (
          <div className="impactf" style={{ fontSize: 12, color: "var(--gold)", textAlign: "center", padding: "10px 0" }}>OWNED</div>
        ) : (
          <button className={`btn ${cur === "cash" ? "btn-hot" : ""}`} style={{ width: "100%", fontSize: 14, opacity: canAfford ? 1 : 0.5 }}
            disabled={busy || !canAfford} onClick={onBuy}>
            {busy ? "…" : <>{cur === "cash" ? "Buy " : ""}<span style={{ color: cur === "cash" ? "inherit" : "var(--volt)" }}>{price}</span>{cur === "credits" ? " ¢" : ""}</>}
          </button>
        )}
      </div>
    </div>
  );
}

function BoxCard({ box, busy, balance, onOpen }) {
  const afford = balance >= box.price;
  return (
    <div className="panel panel-hot" style={{ padding: 16, position: "relative" }}>
      <div style={{ height: 110, display: "grid", placeItems: "center", background: "radial-gradient(circle at 50% 40%, rgba(255,45,77,0.18) 0%, transparent 70%)", border: "1px solid var(--line)" }}>
        <span className="kanji" style={{ fontSize: 48, color: "var(--hot)" }}>箱</span>
      </div>
      <div className="impactf" style={{ fontSize: 15, marginTop: 12 }}>{box.name}</div>
      <div className="col gap-s" style={{ marginTop: 8, marginBottom: 12 }}>
        {(box.odds || []).map((o, i) => (
          <div key={i} className="row" style={{ justifyContent: "space-between", fontSize: 11 }}>
            <span className="row gap-s"><span style={{ width: 6, height: 6, background: rarityColor(o.rarity), display: "inline-block" }} />{o.item}</span>
            <span className="faint">{o.chance}%</span>
          </div>
        ))}
      </div>
      <button className="btn btn-hot" style={{ width: "100%", fontSize: 15, opacity: afford ? 1 : 0.5 }} disabled={busy || !afford} onClick={onOpen}>
        {busy ? "OPENING…" : `Open · ${box.price.toLocaleString()} ${box.currency === "PREMIUM" ? "晶" : "信"}`}
      </button>
    </div>
  );
}

// Dramatic reveal for a box drop or a cash purchase.
function RevealOverlay({ reveal, cosmeticsById, onClose }) {
  const reward = reveal.reward || { item: reveal.item?.name, rarity: reveal.item?.rarity, cosmeticId: reveal.item?.cosmeticId };
  const rc = rarityColor(reward.rarity);
  const cosmetic = cosmeticsById[reward.cosmeticId];
  return (
    <div style={revealWrap} onClick={onClose}>
      <SpeedLines hot />
      <div style={{ position: "relative", textAlign: "center", animation: "revealpop 0.5s cubic-bezier(.2,.9,.2,1)" }}>
        <div className="kanji" style={{ fontSize: 22, color: rc, letterSpacing: "0.3em" }}>{reveal.kind === "box" ? "開封" : "購入"}</div>
        <div style={{ width: 220, height: 220, margin: "16px auto", display: "grid", placeItems: "center",
          background: `radial-gradient(circle, ${rc}33 0%, transparent 70%)`, border: `3px solid ${rc}`, boxShadow: `0 0 60px ${rc}66` }}>
          <span className="kanji" style={{ fontSize: 90, color: rc }}>{glyphFor(cosmetic?.slot)}</span>
        </div>
        <div className="display" style={{ fontSize: 52, color: "var(--paper)", lineHeight: 0.9 }}>{reward.item}</div>
        <div className="impactf" style={{ fontSize: 16, color: rc, letterSpacing: "0.15em", marginTop: 4 }}>{(reward.rarity || "").toUpperCase()}</div>
        {reward.newlyOwned === false && <div className="faint" style={{ marginTop: 8 }}>Duplicate — converted to spares.</div>}
        <button className="btn btn-hot" style={{ marginTop: 24 }} onClick={onClose}>Nice</button>
      </div>
      <style>{`@keyframes revealpop{0%{transform:scale(0.5) rotate(-4deg);opacity:0}100%{transform:scale(1) rotate(0);opacity:1}}`}</style>
    </div>
  );
}

function glyphFor(slot) {
  return { breather: "面", oxygenTank: "酸", weapon: "具", bandana: "帯", headpiece: "頭", body: "体", shoes: "靴", belt: "帯", border: "枠", victoryPose: "勝", emote: "笑" }[slot] || "✦";
}
function rarityColor(r) { return { Common: "var(--r-common)", Rare: "var(--r-rare)", Epic: "var(--r-epic)", Legendary: "var(--r-legendary)" }[r] || "var(--r-common)"; }

const wrap = { height: "100%", position: "relative", overflow: "hidden", background: "radial-gradient(120% 100% at 70% 0%, #221726 0%, var(--ink) 55%)" };
const tabBtn = { padding: "10px 16px", background: "transparent", color: "var(--dim)", borderBottom: "3px solid transparent" };
const tabOn = { color: "var(--paper)", borderBottomColor: "var(--hot)" };
const toastStyle = { position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 9999, background: "var(--hot)", color: "var(--ink)", padding: "12px 22px", fontWeight: 700, clipPath: "polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%)" };
const revealWrap = { position: "fixed", inset: 0, zIndex: 9998, display: "grid", placeItems: "center", background: "rgba(5,4,9,0.92)", cursor: "pointer" };
