import { Router } from "express";
import crypto from "crypto";
import { db } from "../store/index.js";
import { requireAuth } from "../middleware/auth.js";
import { config, PRISM_PACKS, stripePlaceholders } from "../config/index.js";

export const paymentsRouter = Router();

// ============================================================
// Paid store (Stripe). CRITICAL: real money is NEVER credited on the client's
// say-so. The only place Prisms are granted is the webhook, which Stripe calls
// server-to-server AFTER the user actually pays. The client just kicks off a
// Checkout Session and is redirected to Stripe's hosted page.
//
// In dev (placeholder keys) we simulate this: createCheckout returns a fake
// session + a "simulate payment" URL, and /webhook accepts a locally-signed
// event so the full path is testable without a real Stripe account.
// ============================================================

// List the Prism packs the paid store sells.
paymentsRouter.get("/packs", (_req, res) => {
  res.json({
    currency: "PREMIUM",
    label: "Prisms",
    stripeMode: stripePlaceholders() ? "stub" : "live",
    packs: Object.values(PRISM_PACKS).map((p) => ({
      id: p.id, label: p.label,
      prisms: p.prisms + (p.bonus || 0),
      basePrisms: p.prisms, bonus: p.bonus || 0,
      priceCents: p.priceCents,
      priceDisplay: `$${(p.priceCents / 100).toFixed(2)}`,
    })),
  });
});

// Start a purchase. Creates a Checkout Session and records it as pending.
// Returns the URL the client should send the user to.
paymentsRouter.post("/checkout", requireAuth, async (req, res) => {
  const { packId } = req.body || {};
  const pack = PRISM_PACKS[packId];
  if (!pack) return res.status(404).json({ error: "Unknown pack." });
  const prisms = pack.prisms + (pack.bonus || 0);

  if (stripePlaceholders()) {
    // DEV STUB: fabricate a session id and a local "pay" link that POSTs a
    // simulated webhook. With real keys this block is replaced by a real
    // stripe.checkout.sessions.create({...}) call returning session.url.
    const sessionId = "cs_test_" + crypto.randomBytes(8).toString("hex");
    await db.createCheckoutSession(sessionId, { userId: req.userId, packId, prisms });
    return res.json({
      mode: "stub",
      sessionId,
      // The real flow redirects to Stripe; in stub mode we expose how to simulate
      // the webhook so the purchase can be completed end-to-end in dev.
      checkoutUrl: null,
      devSimulate: {
        method: "POST", path: "/payments/webhook",
        note: "Send this body to simulate Stripe confirming payment.",
        body: { type: "checkout.session.completed", data: { object: { id: sessionId } } },
      },
    });
  }

  // LIVE (when real keys are set): create a real Stripe Checkout Session.
  // const stripe = new Stripe(config.stripe.secretKey);
  // const session = await stripe.checkout.sessions.create({
  //   mode: "payment",
  //   line_items: [{ price_data: { currency: "usd",
  //     product_data: { name: pack.label },
  //     unit_amount: pack.priceCents }, quantity: 1 }],
  //   success_url: config.stripe.successUrl,
  //   cancel_url: config.stripe.cancelUrl,
  //   metadata: { userId: req.userId, packId },
  // });
  // await db.createCheckoutSession(session.id, { userId: req.userId, packId, prisms });
  // return res.json({ mode: "live", sessionId: session.id, checkoutUrl: session.url });
  return res.status(501).json({ error: "Live Stripe not wired yet — add keys." });
});

// Start a CART checkout for one or more PREMIUM/cash store items (e.g. the $1
// test items). Computes the total from the items' priceCents server-side (never
// trusts a client price), creates a pending session that — once Stripe confirms
// — grants the cosmetics. In stub mode it returns the simulate-webhook recipe;
// with live keys, swap in stripe.checkout.sessions.create with the line items.
paymentsRouter.post("/checkout-items", requireAuth, async (req, res) => {
  const { itemIds } = req.body || {};
  if (!Array.isArray(itemIds) || itemIds.length === 0) return res.status(400).json({ error: "Cart is empty." });
  const items = [];
  for (const id of itemIds) {
    const it = await db.getStoreItem(id);
    if (!it || it.enabled === false) return res.status(404).json({ error: `Item ${id} not available.` });
    if (it.currency !== "PREMIUM") return res.status(400).json({ error: `${it.name} isn't a cash item.` });
    if (!it.priceCents) return res.status(400).json({ error: `${it.name} has no cash price set.` });
    items.push(it);
  }
  const totalCents = items.reduce((a, it) => a + it.priceCents, 0);
  const grantCosmetics = items.map((it) => it.cosmeticId).filter(Boolean);

  if (stripePlaceholders()) {
    const sessionId = "cs_test_" + crypto.randomBytes(8).toString("hex");
    await db.createCheckoutSession(sessionId, { userId: req.userId, kind: "items", grantCosmetics, totalCents,
      itemNames: items.map((i) => i.name) });
    return res.json({
      mode: "stub", sessionId, totalCents, priceDisplay: `$${(totalCents / 100).toFixed(2)}`,
      checkoutUrl: null,
      devSimulate: { method: "POST", path: "/payments/webhook",
        note: "POST this to simulate Stripe confirming the payment and granting the items.",
        body: { type: "checkout.session.completed", data: { object: { id: sessionId } } } },
    });
  }
  // LIVE (with real keys): create a real session with one line item per cart item.
  // const stripe = new Stripe(config.stripe.secretKey);
  // const session = await stripe.checkout.sessions.create({ mode: "payment",
  //   line_items: items.map((it) => ({ price_data: { currency: "usd",
  //     product_data: { name: it.name }, unit_amount: it.priceCents }, quantity: 1 })),
  //   success_url: config.stripe.successUrl, cancel_url: config.stripe.cancelUrl,
  //   metadata: { userId: req.userId, kind: "items" } });
  // await db.createCheckoutSession(session.id, { userId: req.userId, kind: "items", grantCosmetics, totalCents });
  // return res.json({ mode: "live", sessionId: session.id, checkoutUrl: session.url });
  return res.status(501).json({ error: "Live Stripe not wired yet — add keys." });
});


// from Stripe (signature), then fulfills the matching session exactly once.
paymentsRouter.post("/webhook", async (req, res) => {
  let event = req.body;

  if (!stripePlaceholders()) {
    // LIVE: verify the signature with the raw body + webhook secret.
    // const sig = req.headers["stripe-signature"];
    // try { event = stripe.webhooks.constructEvent(req.rawBody, sig, config.stripe.webhookSecret); }
    // catch (e) { return res.status(400).send(`Webhook signature failed: ${e.message}`); }
    return res.status(501).json({ error: "Live webhook verification not wired yet." });
  }

  // STUB: accept the event as-is (dev only). Only handle the completion event.
  if (!event || event.type !== "checkout.session.completed") {
    return res.json({ received: true, ignored: true });
  }
  const sessionId = event?.data?.object?.id;
  const session = await db.getCheckoutSession(sessionId);
  if (!session) return res.status(404).json({ error: "Unknown session." });

  const result = await db.fulfillCheckoutSession(sessionId);
  if (result.alreadyFulfilled) {
    return res.json({ received: true, alreadyFulfilled: true }); // idempotent: no double-credit
  }
  // Fulfill based on session kind. Item carts grant cosmetics; packs credit prisms.
  if (session.kind === "items") {
    const granted = [];
    for (const cosmeticId of (session.grantCosmetics || [])) {
      const g = await db.grantCosmetic(session.userId, cosmeticId);
      await db.addItem(session.userId, cosmeticId, "Purchased", `stripe:${sessionId}`);
      granted.push({ cosmeticId, newlyOwned: g.newlyOwned });
    }
    return res.json({ received: true, grantedItems: granted });
  }
  // Default: prism pack — credit the premium currency now that payment is confirmed.
  const balance = await db.adjustBalance(session.userId, "PREMIUM", session.prisms, `stripe:${sessionId}`);
  res.json({ received: true, credited: session.prisms, balance });
});

// Convenience for the client to poll whether their session completed.
paymentsRouter.get("/session/:id", requireAuth, async (req, res) => {
  const s = await db.getCheckoutSession(req.params.id);
  if (!s || s.userId !== req.userId) return res.status(404).json({ error: "Not found." });
  res.json({ status: s.status, packId: s.packId, prisms: s.prisms });
});
