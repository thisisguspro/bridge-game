import { Router } from "express";
import { db } from "../store/index.js";
import { requireAuth } from "../middleware/auth.js";

export const playerRouter = Router();

// Everything the player owns.
playerRouter.get("/inventory", requireAuth, async (req, res) => {
  res.json({ items: await db.getInventory(req.userId) });
});

// Current currency balances (for the shop header, etc.).
playerRouter.get("/wallet", requireAuth, async (req, res) => {
  res.json({
    CREDITS: await db.getBalance(req.userId, "CREDITS"),
    PREMIUM: await db.getBalance(req.userId, "PREMIUM"),
  });
});

// Redeem a code. Server validates existence + single-use-per-account, then grants.
playerRouter.post("/redeem", requireAuth, async (req, res) => {
  const code = String(req.body?.code || "").trim().toUpperCase();
  if (!code) return res.status(400).json({ error: "Enter a code." });

  const payload = await db.getCode(code);
  if (!payload) return res.status(404).json({ error: "Invalid code." });

  if (await db.hasRedeemed(req.userId, code)) {
    return res.status(409).json({ error: "Code already redeemed on this account." });
  }

  await db.markRedeemed(req.userId, code);

  const granted = {};
  if (payload.amount) {
    granted.balance = await db.adjustBalance(
      req.userId, payload.currency, payload.amount, `redeem:${code}`);
    granted.currency = payload.currency;
    granted.amount = payload.amount;
  }
  if (payload.reward) {
    const entry = await db.addItem(req.userId, payload.reward.item, payload.reward.rarity, `code:${code}`);
    if (payload.reward.cosmeticId) await db.grantCosmetic(req.userId, payload.reward.cosmeticId);
    granted.reward = { item: payload.reward.item, rarity: payload.reward.rarity,
      cosmeticId: payload.reward.cosmeticId || null, inventoryId: entry.id };
  }

  res.json({ ok: true, granted });
});
