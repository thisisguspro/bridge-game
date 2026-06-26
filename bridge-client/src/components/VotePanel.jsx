import { useEffect, useState } from "react";

// Continuous-voting HUD. BRIDGE has no separate meeting phase — votes accumulate
// and the moment a target crosses majority-of-living they're ejected. By design
// the engine HIDES per-target tallies (anti-bandwagon): we only know how many
// votes are cast and how many are needed, plus our own vote. This panel surfaces
// the round timer, that progress, and a roster to cast/change/clear a vote.
export default function VotePanel({ view, roomId, conn, onClose }) {
  const vote = view.vote;
  const you = view.you || {};
  const myVote = you.myVote || null;
  const living = (view.players || []).filter((p) => p.plane === "physical");
  const canVote = you.plane === "physical";
  const [reportedIds, setReportedIds] = useState([]);

  // local ticking clock so the timer is smooth between server updates
  const [now, setNow] = useState(vote?.secondsIntoRound || 0);
  useEffect(() => { setNow(vote?.secondsIntoRound || 0); }, [vote?.secondsIntoRound]);
  useEffect(() => {
    const t = setInterval(() => setNow((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  if (!vote) return null;
  const total = vote.roundSeconds + vote.graceSeconds;          // 180
  const remaining = Math.max(0, total - now);
  const inGrace = now >= vote.roundSeconds;
  const mm = String(Math.floor(remaining / 60)).padStart(1, "0");
  const ss = String(remaining % 60).padStart(2, "0");

  const cast = (targetId) => {
    // toggle: re-voting the same target clears it
    conn.vote(roomId, myVote === targetId ? null : targetId);
  };

  return (
    <div style={panel}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div className="row" style={{ alignItems: "baseline", gap: 10 }}>
          <span className="kanji" style={{ fontSize: 16, color: "var(--hot)" }}>投票</span>
          <span className="display" style={{ fontSize: 28 }}>EJECT VOTE</span>
        </div>
        <div className="display" style={{ fontSize: 30, color: inGrace ? "var(--hot)" : "var(--volt)" }}>
          {mm}:{ss}{inGrace && <span className="impactf" style={{ fontSize: 11, marginLeft: 6 }}>GRACE</span>}
        </div>
      </div>

      {/* votes-cast progress toward majority (NOT per-target — hidden by design) */}
      <div className="row" style={{ justifyContent: "space-between", fontSize: 11 }}>
        <span className="impactf faint" style={{ fontSize: 11, letterSpacing: "0.1em" }}>VOTES CAST</span>
        <span className="impactf" style={{ fontSize: 11 }}>{vote.votesCast} · MAJORITY {vote.majorityNeeded}</span>
      </div>
      <div style={track}><div style={{ ...fill, width: `${Math.min(100, (vote.votesCast / Math.max(1, vote.majorityNeeded)) * 100)}%` }} /></div>
      <div className="faint" style={{ fontSize: 11, margin: "6px 0 14px" }}>
        Individual tallies are hidden until an ejection — vote on who you suspect.
      </div>

      {/* roster */}
      {!canVote && <div style={{ color: "var(--hot)", fontWeight: 700, fontSize: 13, marginBottom: 10 }}>You've crossed over — you can't vote.</div>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, maxHeight: 230, overflowY: "auto" }}>
        {living.map((p) => {
          const isMe = p.id === you.id;
          const voted = myVote === p.id;
          const reported = reportedIds.includes(p.id);
          return (
            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button disabled={!canVote || isMe} onClick={() => cast(p.id)}
                style={{ ...rosterBtn, flex: 1, ...(voted ? rosterVoted : null), opacity: (!canVote || isMe) ? 0.5 : 1 }}>
                <span style={{ ...dot, background: p.idColor?.hex || "var(--dim)" }} />
                <span style={{ fontWeight: 700, fontSize: 13 }}>{p.name}{isMe ? " (you)" : ""}</span>
                {voted && <span className="impactf" style={{ marginLeft: "auto", fontSize: 10, color: "var(--ink)" }}>VOTED</span>}
              </button>
              {!isMe && (
                <button title={reported ? "Reported" : "Report this player"}
                  disabled={reported}
                  onClick={() => { conn.reportPlayer(roomId, p.id, "in-game report"); setReportedIds((r) => [...r, p.id]); }}
                  style={{ flexShrink: 0, width: 34, height: 34, fontSize: 14, background: reported ? "var(--ink)" : "var(--ink-3)",
                    border: `2px solid ${reported ? "var(--gold)" : "var(--line)"}`, color: reported ? "var(--gold)" : "var(--dim)", cursor: reported ? "default" : "pointer" }}>
                  {reported ? "✓" : "⚑"}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="row gap-s" style={{ marginTop: 14, justifyContent: "space-between" }}>
        <button className="btn btn-ghost" style={{ fontSize: 12, padding: "8px 14px" }} disabled={!myVote} onClick={() => conn.vote(roomId, null)}>
          Clear my vote
        </button>
        <button className="btn" style={{ fontSize: 12, padding: "8px 14px" }} onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

const panel = { width: 380, maxWidth: "92vw", background: "rgba(13,11,20,0.96)", border: "2px solid var(--hot-deep)", padding: "18px 20px", boxShadow: "0 20px 60px rgba(0,0,0,0.6)", clipPath: "polygon(0 0,calc(100% - 16px) 0,100% 16px,100% 100%,16px 100%,0 calc(100% - 16px))" };
const track = { height: 10, background: "var(--ink)", border: "1px solid var(--line)", marginTop: 4, overflow: "hidden" };
const fill = { height: "100%", background: "linear-gradient(90deg,var(--hot),var(--gold))", transition: "width 0.4s ease" };
const rosterBtn = { display: "flex", alignItems: "center", gap: 8, padding: "9px 11px", background: "var(--ink-3)", border: "2px solid var(--line)", textAlign: "left" };
const rosterVoted = { background: "var(--hot)", borderColor: "var(--hot)", color: "var(--ink)" };
const dot = { width: 12, height: 12, borderRadius: "50%", flexShrink: 0, border: "2px solid var(--ink)", boxShadow: "0 0 0 1px var(--line)" };
