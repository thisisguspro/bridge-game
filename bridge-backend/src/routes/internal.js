import { Router } from "express";
import { db } from "../store/index.js";
import { config } from "../config/index.js";

export const internalRouter = Router();

// Gate: only callers holding the shared service key (the game server) get in.
// This is NOT the player or admin path.
internalRouter.use((req, res, next) => {
  if ((req.headers["x-service-key"] || "") !== config.serviceKey) {
    return res.status(403).json({ error: "Service access required." });
  }
  next();
});

// The game server fetches a player's match profile on join: equipped loadout
// (what others render) and unlocked perks (pooled into the draft candidate list).
internalRouter.get("/match-profile/:userId", async (req, res) => {
  const profile = await db.getMatchProfile(req.params.userId);
  if (!profile) return res.status(404).json({ error: "Account not found." });
  res.json({ profile });
});

// The game server reports a finished match. We award XP to each participant
// here (server-to-server) so clients can never grant themselves XP.
internalRouter.post("/match-result", async (req, res) => {
  const { matchId, winner, participants } = req.body || {};
  if (!Array.isArray(participants)) return res.status(400).json({ error: "participants[] required." });

  const results = [];
  for (const p of participants) {
    if (!p?.userId) continue;
    // Simple XP model (tune later): base for playing + bonus for winning.
    const base = 50;
    const winBonus = p.won ? 75 : 0;
    const xp = base + winBonus;
    try {
      const r = await db.addXp(p.userId, xp, `match:${matchId || "?"}`);
      results.push({ userId: p.userId, awarded: xp, ...r });
    } catch { /* skip unknown accounts (e.g. guests) */ }
  }
  res.json({ matchId, winner, awarded: results });
});

// Active events the game server may apply this match (global windows + their config).
internalRouter.get("/active-events", async (_req, res) => {
  res.json({ events: await db.activeEvents() });
});

// The game server reports a bounty take-down; backend grants the reward once.
internalRouter.post("/bounty-claim", async (req, res) => {
  const { eventId, targetId, byUserId } = req.body || {};
  if (!eventId || !targetId || !byUserId) return res.status(400).json({ error: "eventId, targetId, byUserId required." });
  const result = await db.claimBounty(eventId, targetId, byUserId);
  res.json(result);
});
