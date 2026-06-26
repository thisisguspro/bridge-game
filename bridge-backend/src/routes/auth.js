import { Router } from "express";
import { db } from "../store/index.js";
import { issueToken, requireAuth } from "../middleware/auth.js";
import { config } from "../config/index.js";
import { sanitizeName } from "../moderation.js";

export const authRouter = Router();

// ---- Google OAuth (STUBBED for dev) ----
// Real flow: client gets a Google ID token, posts it here, we verify it with
// Google's library using config.google.clientId, then find-or-create the user.
// Until real keys are added, we accept a mock profile so the app is fully usable.
authRouter.post("/google", async (req, res) => {
  const usingPlaceholders = config.google.clientId.startsWith("PLACEHOLDER");

  let profile;
  if (usingPlaceholders) {
    // DEV STUB: trust a mock profile from the body. Never do this in production.
    const { mockGoogleId, name, email } = req.body || {};
    profile = {
      googleId: mockGoogleId || "mock-google-123",
      name: name || "Pilot Aoi",
      email: email || "aoi@example.com",
      avatar: (name || "A")[0].toUpperCase(),
    };
  } else {
    // TODO when real keys land: verify req.body.idToken with google-auth-library,
    // then build `profile` from the verified payload.
    return res.status(501).json({ error: "Real Google verification not wired yet." });
  }

  let user = await db.findUserByGoogleId(profile.googleId);
  let nameChanged = false;
  let newAccount = false;
  if (!user) {
    // First-time account creation must accept the Terms of Service. The client
    // sends acceptedTos:true after showing the ToS screen.
    if (!(req.body && req.body.acceptedTos)) {
      return res.status(428).json({ error: "tos_required",
        message: "You must accept the Terms of Service to create an account." });
    }
    // PG-13 name policy: a rejected name is replaced with Child######### .
    const sani = sanitizeName(profile.name);
    profile.name = sani.name;
    profile.avatar = (sani.name[0] || "C").toUpperCase();
    nameChanged = sani.changed;
    newAccount = true;
    user = await db.createUser(profile);
    if (typeof db.setTosAccepted === "function") { try { await db.setTosAccepted(user.id, true); } catch {} }
  }

  // Enforce bans at login (temp bans auto-expire inside isBanned).
  const ban = await db.isBanned(user.id);
  if (ban.banned) {
    return res.status(403).json({ error: "This account is banned.", banUntil: ban.until || null, reason: ban.reason || null });
  }

  res.json({ token: issueToken(user), user: publicUser(user), nameChanged, newAccount });
});

// Current signed-in player.
authRouter.get("/me", requireAuth, async (req, res) => {
  const user = await db.getUser(req.userId);
  if (!user) return res.status(404).json({ error: "Account not found." });
  res.json({ user: publicUser(user) });
});

function publicUser(u) {
  return { id: u.id, name: u.name, avatar: u.avatar, balances: u.balances };
}
