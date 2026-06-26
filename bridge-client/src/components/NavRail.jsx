// Vertical nav rail: identity at top, the three destinations, sign-out at the
// bottom. The level chip is a small recurring progression cue.
export default function NavRail({ screen, setScreen, user, profile, onSignOut }) {
  const items = [
    { id: "play", label: "Play", kanji: "出撃" },
    { id: "hangar", label: "Hangar", kanji: "格納" },
    { id: "locker", label: "Locker", kanji: "装備" },
    { id: "shop", label: "Shop", kanji: "商店" },
    { id: "wheels", label: "Wheels", kanji: "輪" },
    { id: "settings", label: "Options", kanji: "設定" },
  ];
  return (
    <div style={rail}>
      <div style={{ textAlign: "center" }}>
        <div className="display" style={{ fontSize: 30, color: "var(--hot)", letterSpacing: "0.12em", lineHeight: 1 }}>BR</div>
        <div style={{ height: 2, background: "var(--hot)", margin: "8px 6px 18px" }} />
      </div>

      <div className="col gap-s" style={{ flex: 1 }}>
        {items.map((it) => {
          const on = screen === it.id;
          return (
            <button key={it.id} onClick={() => setScreen(it.id)} style={{ ...tab, ...(on ? tabOn : null) }}>
              <span className="kanji" style={{ fontSize: 18, opacity: on ? 1 : 0.5 }}>{it.kanji}</span>
              <span className="impactf" style={{ fontSize: 10, letterSpacing: "0.1em", marginTop: 4 }}>{it.label.toUpperCase()}</span>
              {on && <span style={tabBar} />}
            </button>
          );
        })}
      </div>

      <div style={{ textAlign: "center" }}>
        {profile && (
          <div style={lvlChip} title={`${profile.xp} XP`}>
            <div className="faint" style={{ fontSize: 8, letterSpacing: "0.15em" }}>LV</div>
            <div className="display" style={{ fontSize: 26, color: "var(--gold)", lineHeight: 0.9 }}>{profile.level}</div>
          </div>
        )}
        <div className="impactf" style={{ fontSize: 10, color: "var(--paper)", marginTop: 8, maxWidth: 56, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user?.name}</div>
        <button className="faint" style={signout} onClick={onSignOut} title="Sign out">⏻</button>
      </div>
    </div>
  );
}

const rail = { width: 76, background: "var(--ink-2)", borderRight: "2px solid var(--line)", display: "flex", flexDirection: "column", padding: "16px 8px", zIndex: 5 };
const tab = { position: "relative", display: "flex", flexDirection: "column", alignItems: "center", padding: "12px 0", color: "var(--paper)", background: "transparent" };
const tabOn = { background: "var(--ink-3)" };
const tabBar = { position: "absolute", left: -8, top: 6, bottom: 6, width: 3, background: "var(--hot)" };
const lvlChip = { display: "inline-flex", flexDirection: "column", alignItems: "center", padding: "6px 10px", border: "2px solid var(--gold)", background: "rgba(255,200,61,0.08)", clipPath: "polygon(6px 0,100% 0,calc(100% - 6px) 100%,0 100%)" };
const signout = { marginTop: 10, fontSize: 18, background: "transparent", padding: 4 };
