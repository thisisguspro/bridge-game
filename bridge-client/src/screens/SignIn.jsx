import { useState } from "react";
import * as api from "../api/backend.js";
import { SpeedLines, Particles } from "../components/effects.jsx";

// Sign-in. The backend's Google OAuth is stubbed in dev, so we collect a call
// sign (name) and an optional email (the configured superadmin email unlocks
// admin powers) and exchange them for a real session token.
export default function SignIn({ onSignedIn }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [showTos, setShowTos] = useState(false);
  const [tosChecked, setTosChecked] = useState(false);
  const [nameNotice, setNameNotice] = useState(null);

  const doSignIn = async (acceptedTos) => {
    setBusy(true); setErr(null);
    try {
      const res = await api.signIn({ name: name.trim(), email: email.trim() || undefined, acceptedTos });
      // If the backend changed the name (PG-13 policy), tell the player before entering.
      if (res.nameChanged && res.user?.name) {
        setNameNotice(res.user.name);
        setShowTos(false);
        return; // hold here; player taps "Continue" on the notice
      }
      onSignedIn(res.user);
    } catch (e) {
      if (e.tosRequired) { setShowTos(true); }
      else setErr(e.message || "Couldn't reach the fleet servers. Are they running on :4000?");
    } finally { setBusy(false); }
  };

  const submit = async () => {
    if (!name.trim()) { setErr("Enter a call sign to launch."); return; }
    await doSignIn(false); // first attempt; backend asks for ToS if it's a new account
  };
  const acceptTos = async () => { if (!tosChecked) return; await doSignIn(true); };

  // After a forced rename, let the player acknowledge then enter.
  if (nameNotice) {
    return (
      <div style={wrap}>
        <SpeedLines hot />
        <div style={{ position: "relative", zIndex: 2, textAlign: "center" }}>
          <div className="panel panel-hot" style={{ padding: 28, width: 380, margin: "0 auto", background: "var(--ink-2)" }}>
            <div className="kanji" style={{ fontSize: 20, color: "var(--hot)", marginBottom: 6 }}>改名</div>
            <div className="display" style={{ fontSize: 26, marginBottom: 12 }}>NAME ADJUSTED</div>
            <p style={{ fontSize: 14, lineHeight: 1.5 }}>
              The call sign you chose didn't pass our family-friendly naming rules, so the system assigned you:
            </p>
            <div className="display" style={{ fontSize: 30, color: "var(--gold)", margin: "12px 0" }}>{nameNotice}</div>
            <p className="faint" style={{ fontSize: 12, marginBottom: 18 }}>You can change cosmetics and more later — but keep names PG-13.</p>
            <button className="btn btn-hot" style={{ width: "100%", fontSize: 16 }}
              onClick={async () => { const u = await api.me().catch(() => null); onSignedIn(u?.user || { name: nameNotice }); }}>
              Continue →
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={wrap}>
      <SpeedLines hot />
      <Particles density={36} />
      {showTos && <TosModal checked={tosChecked} setChecked={setTosChecked} onAccept={acceptTos} onCancel={() => setShowTos(false)} busy={busy} />}
      <div style={{ position: "relative", zIndex: 2, textAlign: "center" }}>
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
          {err && <div style={{ color: "var(--hot)", fontSize: 13, marginTop: 12, fontWeight: 600 }}>{err}</div>}
          <button className="btn btn-hot" style={{ width: "100%", marginTop: 20, fontSize: 18 }} disabled={busy} onClick={submit}>
            {busy ? "Launching…" : "Launch"}
          </button>
          <div className="faint" style={{ fontSize: 11, marginTop: 12, textAlign: "center" }}>
            New pilots agree to the Terms of Service on first launch.
          </div>
        </div>
        <div className="faint" style={{ marginTop: 18, fontSize: 12 }}>Backend · localhost:4000 &nbsp;•&nbsp; Game · localhost:5000</div>
      </div>
    </div>
  );
}

// Among Us-style Terms of Service: friendly but clear; emphasizes conduct and the
// naming policy (over-PG-13 names get auto-changed). Shown only on first signup.
function TosModal({ checked, setChecked, onAccept, onCancel, busy }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 500, display: "grid", placeItems: "center", background: "rgba(5,4,9,0.8)", backdropFilter: "blur(4px)" }}>
      <div className="panel panel-hot" style={{ width: 520, maxWidth: "92vw", maxHeight: "86vh", overflow: "auto", padding: 26, background: "var(--ink-2)", textAlign: "left" }}>
        <div className="kanji" style={{ fontSize: 18, color: "var(--hot)" }}>規約</div>
        <div className="display" style={{ fontSize: 30, marginBottom: 8 }}>TERMS OF SERVICE</div>
        <p style={{ fontSize: 13.5, lineHeight: 1.55, color: "var(--dim)" }}>
          Welcome aboard, pilot! Before you launch, a few ground rules to keep BRIDGE fun and safe for everyone:
        </p>
        <ul style={{ fontSize: 13.5, lineHeight: 1.6, paddingLeft: 18 }}>
          <li><b>Be cool to your crew.</b> No harassment, hate speech, threats, or bullying. Treat people the way you'd want your own crew to treat you.</li>
          <li><b>Keep it PG-13.</b> That includes your name. Call signs that aren't family-friendly are automatically changed to <b>"Child" + a random number</b> assigned by the system. No profanity, slurs, sexual content, or impersonation.</li>
          <li><b>No cheating or exploiting.</b> Hacking, botting, or abusing bugs can get your account suspended.</li>
          <li><b>You're 13 or older.</b> BRIDGE isn't intended for children under 13.</li>
          <li><b>Play fair, have fun.</b> Sabotage your crewmates <i>in the game</i> — not in real life. 🚀</li>
        </ul>
        <p className="faint" style={{ fontSize: 12, lineHeight: 1.5 }}>
          The game is provided "as is" without warranty. Breaking these rules may result in name changes, suspensions, or bans. Your data is used only to run the game.
        </p>
        <label style={{ display: "flex", alignItems: "center", gap: 10, margin: "14px 0", fontSize: 14, cursor: "pointer" }}>
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} style={{ width: 18, height: 18, accentColor: "var(--hot)" }} />
          I'm 13 or older and I agree to the Terms of Service.
        </label>
        <div className="row gap-s">
          <button className="btn btn-ghost" style={{ flex: 1, fontSize: 14 }} onClick={onCancel}>Cancel</button>
          <button className="btn btn-hot" style={{ flex: 2, fontSize: 16 }} disabled={!checked || busy} onClick={onAccept}>
            {busy ? "Launching…" : "Agree & Launch"}
          </button>
        </div>
      </div>
    </div>
  );
}

const wrap = { height: "100%", position: "relative", display: "grid", placeItems: "center", background: "radial-gradient(120% 90% at 70% 10%, #241626 0%, var(--ink) 60%)", overflow: "hidden" };
const lbl = { display: "block", fontFamily: "var(--impact)", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--dim)", margin: "0 0 6px" };
const input = { width: "100%", background: "var(--ink)", border: "2px solid var(--line)", color: "var(--paper)", padding: "11px 12px", fontFamily: "var(--body)", fontSize: 15, fontWeight: 600, marginBottom: 16, outline: "none" };
