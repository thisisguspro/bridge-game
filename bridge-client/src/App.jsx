import { useEffect, useState, useCallback } from "react";
import * as api from "./api/backend.js";
import { initAudio } from "./api/audio.js";
import SignIn from "./screens/SignIn.jsx";
import Hangar from "./screens/Hangar.jsx";
import Locker from "./screens/Locker.jsx";
import Shop from "./screens/Shop.jsx";
import Wheels from "./screens/Wheels.jsx";
import Settings from "./screens/Settings.jsx";
import Play from "./screens/Play.jsx";
import NavRail from "./components/NavRail.jsx";

// Top-level client. Holds auth + the player profile, and routes between the
// home "hangar" (progression), the locker (cosmetics), and play (lobby+match).
export default function App() {
  const [booted, setBooted] = useState(false);
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [catalogue, setCatalogue] = useState(null);
  const [screen, setScreen] = useState("play");
  const [inRoom, setInRoom] = useState(false);

  const loadAll = useCallback(async () => {
    const [p, c] = await Promise.all([api.getProfile(), api.getCatalogue()]);
    setProfile(p); setCatalogue(c);
  }, []);

  // On boot, if we have a token, try to resume the session.
  useEffect(() => {
    (async () => {
      if (api.getToken()) {
        try { const m = await api.me(); setUser(m.user); await loadAll(); }
        catch { api.signOut(); }
      }
      setBooted(true);
    })();
    
    // Initialize audio on first click (browser policy)
    const initSfx = () => { initAudio(); document.removeEventListener("click", initSfx); };
    document.addEventListener("click", initSfx);
    return () => document.removeEventListener("click", initSfx);
  }, [loadAll]);

  const onSignedIn = async (u) => { setUser(u); await loadAll(); setScreen("play"); };
  const refreshProfile = useCallback(async () => { setProfile(await api.getProfile()); }, []);

  if (!booted) return <Boot />;
  if (!user) return <SignIn onSignedIn={onSignedIn} />;

  return (
    <div style={{ height: "100%", display: "flex", background: "var(--ink)" }}>
      {!inRoom && <NavRail screen={screen} setScreen={setScreen} user={user} profile={profile}
        onSignOut={() => { api.signOut(); setUser(null); setProfile(null); }} />}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        {screen === "hangar" && <Hangar user={user} profile={profile} catalogue={catalogue} />}
        {screen === "locker" && <Locker profile={profile} catalogue={catalogue} onChange={refreshProfile} />}
        {screen === "shop" && <Shop profile={profile} catalogue={catalogue} onChange={refreshProfile} />}
        {screen === "wheels" && <Wheels profile={profile} catalogue={catalogue} />}
        {screen === "settings" && <Settings />}
        {screen === "play" && <Play user={user} profile={profile} onRoomStatus={setInRoom} onChange={refreshProfile} />}
      </div>
    </div>
  );
}

function Boot() {
  return (
    <div style={{ height: "100%", display: "grid", placeItems: "center", background: "var(--ink)" }}>
      <div className="display" style={{ fontSize: 72, color: "var(--hot)", letterSpacing: "0.2em" }}>BRIDGE</div>
    </div>
  );
}
