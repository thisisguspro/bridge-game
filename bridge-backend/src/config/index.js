// Central config. Everything tweakable lives here.
// Real secrets come from environment variables; sane dev defaults provided.

export const config = {
  port: process.env.PORT || 4000,

  // JWT session signing. OVERRIDE in production via env.
  jwtSecret: process.env.JWT_SECRET || "dev-only-change-me",
  jwtExpiry: "7d",

  // Google OAuth — PLACEHOLDERS. Substitute real keys before testing.
  // The flow is stubbed in dev (see routes/auth.js) so nothing breaks without them.
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || "PLACEHOLDER_GOOGLE_CLIENT_ID",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || "PLACEHOLDER_GOOGLE_CLIENT_SECRET",
  },

  // Admin gate — a separate secret, NOT the player auth path.
  adminKey: process.env.ADMIN_KEY || "dev-admin-key",

  // Service-to-service secret: the game server uses this to fetch player
  // loadouts and report match results. NOT a player or admin credential.
  serviceKey: process.env.SERVICE_KEY || "dev-service-key",

  // Bootstrap super-admin: this Google email always has full admin power and can
  // grant/revoke admin to others. Override via env in production.
  superadminEmail: process.env.SUPERADMIN_EMAIL || "gmromeu13@gmail.com",

  // Which data store to use. "memory" now; "postgres" later — see store/index.js.
  dataStore: process.env.DATA_STORE || "memory",

  // Stripe (paid store) — PLACEHOLDERS. Substitute real keys before going live.
  // The flow is stubbed in dev (see routes/payments.js): we simulate Checkout
  // Sessions and webhooks so the whole purchase path works without a real account.
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || "PLACEHOLDER_STRIPE_SECRET_KEY",
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || "PLACEHOLDER_STRIPE_WEBHOOK_SECRET",
    successUrl: process.env.STRIPE_SUCCESS_URL || "http://localhost:5173/store?paid=1",
    cancelUrl: process.env.STRIPE_CANCEL_URL || "http://localhost:5173/store?canceled=1",
  },
};

// True when real Stripe keys haven't been provided yet (dev stub mode).
export const stripePlaceholders = () => config.stripe.secretKey.startsWith("PLACEHOLDER");

// ---- Premium currency packs (what the paid store sells) ----
// Prices in the smallest currency unit (cents) for Stripe. Buying a pack credits
// PREMIUM ("Prisms") to the account — only after Stripe confirms payment.
export const PRISM_PACKS = {
  pack_small:  { id: "pack_small",  label: "Pouch of Prisms",  prisms: 500,   priceCents: 499 },
  pack_medium: { id: "pack_medium", label: "Sack of Prisms",   prisms: 1200,  priceCents: 999,  bonus: 100 },
  pack_large:  { id: "pack_large",  label: "Chest of Prisms",  prisms: 2600,  priceCents: 1999, bonus: 400 },
  pack_huge:   { id: "pack_huge",   label: "Vault of Prisms",  prisms: 7000,  priceCents: 4999, bonus: 1500 },
};

// ---- Two-currency economy, abstracted from day one ----
// Launch ships with CREDITS only (earned). PREMIUM is defined but no purchase
// path is wired — enabling it later is config + a payment integration, not a refactor.
export const CURRENCIES = {
  CREDITS: { key: "CREDITS", label: "Credits", earnable: true, purchasable: false },
  PREMIUM: { key: "PREMIUM", label: "Prisms", earnable: false, purchasable: true }, // bought via Stripe paid store
};
export const DEFAULT_CURRENCY = "CREDITS";

// ---- Map-driven crew/impostor scaling (matches the design doc) ----
// The matchmaker reads these off the map, never hardcodes counts.
export const MAPS = {
  nebula_drift: { id: "nebula_drift", name: "Nebula Drift", tier: "small",
    minPlayers: 5, maxPlayers: 10, impostors: 1,
    rooms: ["Bridge", "Engineering", "Sensors", "Reactor", "Medbay"],
    tasksPerRoom: 2 },
  ironhold_station: { id: "ironhold_station", name: "Ironhold Station", tier: "large",
    minPlayers: 10, maxPlayers: 20, impostors: 2,
    rooms: ["Bridge", "Engineering", "Sensors", "Reactor", "Medbay", "Cargo", "Hangar", "Comms Array"],
    tasksPerRoom: 3 },
};
