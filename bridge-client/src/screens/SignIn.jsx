import { useState } from "react";
import * as api from "../api/backend.js";
import { SpeedLines, Particles } from "../components/effects.jsx";

// Sign-in. The backend's Google OAuth is stubbed in dev, so we collect a call
// sign (name) and an optional email (the configured superadmin email unlocks
// admin powers) and exchange them for a real session token.
export default function SignIn({ onSignedIn }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const submit = async () => {
    if (!name.trim()) { setErr("Enter a call sign to launch."); return; }
    if (!password.trim()) { setErr("Enter a password."); return; }
    setBusy(true); setErr(null);
    try { const { user } = await api.signIn({ name: name.trim(), email: email.trim() || undefined, password }); onSignedIn(user); }
    catch (e) { setErr(e.message || "Couldn't reach the fleet servers. Are they running on :4000?"); }
    finally { setBusy(false); }
  };

  return (
    <div style={wrap}>
      <SpeedLines hot />
      <Particles density={36} />
      <div style={{ position: "relative", zIndex: 2, textAlign: "center", margin: "auto", padding: "40px 20px", width: "100%", maxWidth: 500 }}>
        <div className="kanji" style={{ fontSize: 22, color: "var(--hot)", letterSpacing: "0.4em", marginBottom: 4 }}>艦橋</div>
        <h1 className="display" style={{ fontSize: "clamp(80px,16vw,180px)", margin: 0, lineHeight: 0.82,
          background: "linear-gradient(180deg,#fff 0%,#ffd0d8 60%,var(--hot) 100%)",
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", textShadow: "0 0 40px rgba(255,45,77,0.3)" }}>
          BRIDGE
        </h1>
        <div className="impactf dim" style={{ letterSpacing: "0.35em", marginTop: 2, marginBottom: 36, fontSize: 13 }}>
          HIDDEN-TRAITOR BRIDGE COMMAND
        </div>

        <div className="panel panel-hot" style={{ padding: 28, width: 360, margin: "0 auto", textAlign: "left", background: "var(--ink-2)" }}>
          <div className="tag" style={{ marginBottom: 18 }}><span>Launch sequence</span></div>
          <label style={lbl}>Call sign</label>
          <input style={input} value={name} maxLength={20} placeholder="e.g. Akira"
            onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} autoFocus />
          <label style={lbl}>Email <span className="faint">(optional)</span></label>
          <input style={input} value={email} placeholder="for admin / saved progress"
            onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
          <label style={lbl}>Password</label>
          <input style={input} type="password" value={password} placeholder="Secure your account"
            onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
          {err && <div style={{ color: "var(--hot)", fontSize: 13, marginTop: 12, fontWeight: 600 }}>{err}</div>}
          <button className="btn btn-hot" style={{ width: "100%", marginTop: 20, fontSize: 18 }} disabled={busy} onClick={submit}>
            {busy ? "Launching…" : "Launch"}
          </button>
        </div>
        <div className="faint" style={{ marginTop: 18, fontSize: 12 }}>Backend · localhost:4000 &nbsp;•&nbsp; Game · localhost:5000</div>
      </div>
    </div>
  );
}

const wrap = { height: "100%", position: "relative", display: "flex", flexDirection: "column", background: "radial-gradient(120% 90% at 70% 10%, #241626 0%, var(--ink) 60%)", overflowY: "auto" };
const lbl = { display: "block", fontFamily: "var(--impact)", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--dim)", margin: "0 0 6px" };
const input = { width: "100%", background: "var(--ink)", border: "2px solid var(--line)", color: "var(--paper)", padding: "11px 12px", fontFamily: "var(--body)", fontSize: 15, fontWeight: 600, marginBottom: 16, outline: "none" };
