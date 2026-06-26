import { useEffect, useState, useCallback } from "react";
import * as api from "../api/backend.js";
import { SpeedLines } from "../components/effects.jsx";

// Settings. Loads the player's real settings + the schema the backend defines,
// renders controls for each category, and saves partial patches (debounced for
// sliders, immediate for toggles/selects). Key rebinding listens for a keypress.
export default function Settings() {
  const [data, setData] = useState(null);
  const [section, setSection] = useState("audio");
  const [saving, setSaving] = useState(false);
  const [rebinding, setRebinding] = useState(null);

  useEffect(() => { api.getSettings().then(setData).catch(() => {}); }, []);

  const patch = useCallback(async (category, key, value) => {
    setData((d) => ({ ...d, settings: { ...d.settings, [category]: { ...d.settings[category], [key]: value } } }));
    setSaving(true);
    try { await api.saveSettings({ [category]: { [key]: value } }); } finally { setSaving(false); }
  }, []);

  // key rebinding
  useEffect(() => {
    if (!rebinding) return;
    const handler = (e) => {
      e.preventDefault();
      patch("controls", rebinding, e.code);
      setRebinding(null);
    };
    window.addEventListener("keydown", handler, { once: true });
    return () => window.removeEventListener("keydown", handler);
  }, [rebinding, patch]);

  if (!data) return <div style={wrap} />;
  const s = data.settings;
  const sections = [["audio", "Audio", "音"], ["graphics", "Graphics", "画"], ["accessibility", "Accessibility", "易"], ["privacy", "Privacy", "秘"], ["controls", "Controls", "操"]];

  return (
    <div style={wrap}>
      <SpeedLines />
      <div style={{ position: "relative", zIndex: 2, height: "100%", display: "grid", gridTemplateColumns: "200px 1fr" }}>
        {/* section rail */}
        <div style={{ borderRight: "2px solid var(--line)", padding: "28px 14px", background: "var(--ink-2)" }}>
          <div className="kanji" style={{ fontSize: 18, color: "var(--hot)", letterSpacing: "0.3em", paddingLeft: 8 }}>設定</div>
          <h1 className="display" style={{ fontSize: 34, margin: "2px 0 24px", paddingLeft: 8 }}>OPTIONS</h1>
          {sections.map(([k, label, kanji]) => (
            <button key={k} onClick={() => setSection(k)} style={{ ...secBtn, ...(section === k ? secOn : null) }}>
              <span className="kanji" style={{ fontSize: 16, marginRight: 10, opacity: section === k ? 1 : 0.5 }}>{kanji}</span>
              <span className="impactf" style={{ fontSize: 12 }}>{label.toUpperCase()}</span>
            </button>
          ))}
          <div className="faint" style={{ fontSize: 11, marginTop: 24, paddingLeft: 8, height: 16 }}>{saving ? "Saving…" : "Saved"}</div>
        </div>

        {/* controls */}
        <div style={{ padding: "32px 40px", overflowY: "auto" }}>
          {section === "audio" && (
            <Cat title="Audio">
              <Slider label="Master Volume" value={s.audio.master} onChange={(v) => patch("audio", "master", v)} />
              <Slider label="Music" value={s.audio.music} onChange={(v) => patch("audio", "music", v)} />
              <Slider label="Sound Effects" value={s.audio.sfx} onChange={(v) => patch("audio", "sfx", v)} />
              <Slider label="Voice Chat Volume" value={s.audio.voiceChat} onChange={(v) => patch("audio", "voiceChat", v)} />
              <Toggle label="Voice Chat Enabled" value={s.audio.voiceChatEnabled} onChange={(v) => patch("audio", "voiceChatEnabled", v)} />
              <Toggle label="Microphone Enabled" value={s.audio.micEnabled} onChange={(v) => patch("audio", "micEnabled", v)} />
              <Toggle label="Push To Talk" value={s.audio.pushToTalk} onChange={(v) => patch("audio", "pushToTalk", v)} />
            </Cat>
          )}
          {section === "graphics" && (
            <Cat title="Graphics">
              <Select label="Quality" value={s.graphics.quality} options={["low", "medium", "high", "ultra"]} onChange={(v) => patch("graphics", "quality", v)} />
              <Toggle label="Fullscreen" value={s.graphics.fullscreen} onChange={(v) => patch("graphics", "fullscreen", v)} />
              <Toggle label="V-Sync" value={s.graphics.vsync} onChange={(v) => patch("graphics", "vsync", v)} />
              <Select label="FPS Limit" value={String(s.graphics.fpsLimit)} options={["0", "30", "60", "120", "144"]} labelFor={(o) => o === "0" ? "Uncapped" : o} onChange={(v) => patch("graphics", "fpsLimit", Number(v))} />
              <Toggle label="Screen Shake" value={s.graphics.screenShake} onChange={(v) => patch("graphics", "screenShake", v)} />
              <Toggle label="Damage Numbers" value={s.graphics.showDamageNumbers} onChange={(v) => patch("graphics", "showDamageNumbers", v)} />
            </Cat>
          )}
          {section === "accessibility" && (
            <Cat title="Accessibility">
              <Toggle label="Colorblind ID Shapes" value={s.accessibility.colorblindShapes} onChange={(v) => patch("accessibility", "colorblindShapes", v)} />
              <Toggle label="Show Color Names on Players" value={s.accessibility.colorblindLabels} onChange={(v) => patch("accessibility", "colorblindLabels", v)} />
              <Toggle label="High Contrast" value={s.accessibility.highContrast} onChange={(v) => patch("accessibility", "highContrast", v)} />
              <Toggle label="Clearer Ghost / Downed Players" value={s.accessibility.ghostReadability} onChange={(v) => patch("accessibility", "ghostReadability", v)} />
              <Toggle label="Captions" value={s.accessibility.captionsEnabled} onChange={(v) => patch("accessibility", "captionsEnabled", v)} />
              <Select label="Caption Size" value={s.accessibility.captionSize} options={["small", "medium", "large"]} onChange={(v) => patch("accessibility", "captionSize", v)} />
              <Toggle label="Reduced Motion" value={s.accessibility.reducedMotion} onChange={(v) => patch("accessibility", "reducedMotion", v)} />
              <Toggle label="Hold To Confirm Risky Actions" value={s.accessibility.holdToConfirm} onChange={(v) => patch("accessibility", "holdToConfirm", v)} />
              <Toggle label="Show Gameplay Tips" value={s.accessibility.showTips} onChange={(v) => patch("accessibility", "showTips", v)} />
              <Toggle label="Show On-Screen Control Hints" value={s.accessibility.showControlHints} onChange={(v) => patch("accessibility", "showControlHints", v)} />
            </Cat>
          )}
          {section === "privacy" && (
            <Cat title="Privacy">
              <Toggle label="Streamer Mode (hide join code)" value={s.privacy?.streamerMode} onChange={(v) => patch("privacy", "streamerMode", v)} />
              <div className="faint" style={{ fontSize: 12, lineHeight: 1.5, marginTop: 4 }}>
                Hides your lobby's join code so it won't leak on stream. A "Reveal" button shows it briefly when you need it. Anyone reading the on-screen code off your stream gets… a surprise. 😈
              </div>
            </Cat>
          )}
          {section === "controls" && (
            <Cat title="Controls">
              <div className="dim" style={{ marginBottom: 14, fontSize: 13 }}>Click a binding, then press a key.</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px,1fr))", gap: 10 }}>
                {Object.entries(s.controls).map(([k, code]) => (
                  <div key={k} className="row" style={{ justifyContent: "space-between", padding: "10px 12px", border: "1px solid var(--line)", background: "var(--ink-2)" }}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{labelizeControl(k)}</span>
                    <button className="btn" style={{ fontSize: 11, padding: "6px 12px", borderColor: rebinding === k ? "var(--hot)" : "var(--line)", textTransform: "none" }}
                      onClick={() => setRebinding(k)}>
                      {rebinding === k ? "Press a key…" : prettyKey(code)}
                    </button>
                  </div>
                ))}
              </div>
            </Cat>
          )}
        </div>
      </div>
    </div>
  );
}

function Cat({ title, children }) {
  return (
    <div style={{ maxWidth: 560 }}>
      <div className="tag" style={{ marginBottom: 18 }}><span>{title}</span></div>
      <div className="col" style={{ gap: 4 }}>{children}</div>
    </div>
  );
}
function Slider({ label, value, onChange }) {
  return (
    <div style={{ padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontWeight: 600 }}>{label}</span>
        <span className="display" style={{ fontSize: 18, color: "var(--volt)" }}>{value}</span>
      </div>
      <input type="range" min="0" max="100" value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ width: "100%", accentColor: "var(--hot)" }} />
    </div>
  );
}
function Toggle({ label, value, onChange }) {
  return (
    <div className="row" style={{ justifyContent: "space-between", padding: "12px 0", borderBottom: "1px solid var(--line)" }}>
      <span style={{ fontWeight: 600 }}>{label}</span>
      <button onClick={() => onChange(!value)} style={{ width: 52, height: 28, background: value ? "var(--hot)" : "var(--ink-3)", border: "2px solid " + (value ? "var(--hot)" : "var(--line)"), position: "relative", transition: "background .15s" }}>
        <span style={{ position: "absolute", top: 1, left: value ? 25 : 1, width: 22, height: 22, background: value ? "var(--ink)" : "var(--dim)", transition: "left .15s" }} />
      </button>
    </div>
  );
}
function Select({ label, value, options, onChange, labelFor }) {
  return (
    <div className="row" style={{ justifyContent: "space-between", padding: "12px 0", borderBottom: "1px solid var(--line)" }}>
      <span style={{ fontWeight: 600 }}>{label}</span>
      <div className="row gap-s">
        {options.map((o) => (
          <button key={o} onClick={() => onChange(o)} style={{ padding: "6px 12px", fontFamily: "var(--impact)", fontSize: 11,
            background: value === o ? "var(--hot)" : "transparent", color: value === o ? "var(--ink)" : "var(--dim)", border: "2px solid " + (value === o ? "var(--hot)" : "var(--line)") }}>
            {(labelFor ? labelFor(o) : o).toString().toUpperCase()}
          </button>
        ))}
      </div>
    </div>
  );
}

function labelizeControl(k) { return k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim(); }
function prettyKey(code) { return (code || "").replace(/^Key/, "").replace(/^Digit/, "").replace(/^Arrow/, "↑").replace("ControlLeft", "Ctrl") || "—"; }

const wrap = { height: "100%", position: "relative", overflow: "hidden", background: "radial-gradient(120% 100% at 20% 0%, #1e1826 0%, var(--ink) 55%)" };
const secBtn = { display: "flex", alignItems: "center", width: "100%", padding: "11px 8px", background: "transparent", color: "var(--paper)" };
const secOn = { background: "var(--ink-3)", borderLeft: "3px solid var(--hot)" };
