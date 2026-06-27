// Real REST client for the BRIDGE backend (:4000). Every call hits the actual
// server. Auth uses the session token the backend issues at sign-in (stored in
// localStorage). In dev the backend's Google OAuth is stubbed, so signIn() posts
// a name/email and gets a real token back — the same token shape production uses.

import { BACKEND_URL, TOKEN_KEY, tokenStore } from "./config.js";

export function getToken() { return tokenStore.getItem(TOKEN_KEY); }
export function setToken(t) { t ? tokenStore.setItem(TOKEN_KEY, t) : tokenStore.removeItem(TOKEN_KEY); }
export function signOut() { setToken(null); }

async function req(path, { method = "GET", body, auth = true } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth) { const t = getToken(); if (t) headers.Authorization = `Bearer ${t}`; }
  const res = await fetch(BACKEND_URL + path, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { _raw: text }; }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// --- auth ---
// Dev sign-in: the backend's OAuth is stubbed, so we post a name (+ optional
// email so the superadmin bootstrap works) and receive a real session token.
export async function signIn({ name, email, password }) {
  const data = await req("/auth/google", { method: "POST", auth: false, body: { name, email, password, mockGoogleId: "dev-" + (email || name) } });
  if (data.token) setToken(data.token);
  return data; // { token, user }
}
export async function me() { return req("/auth/me"); }

// --- progression / cosmetics ---
export async function getProfile() { return req("/profile"); }                 // { level, xp, owned[], loadout{}, unlockedSlots[], xpToNext, nextLevelAt }
export async function getCatalogue() { return req("/profile/catalogue"); }      // { slots[], cosmetics[], ladder{} }
export async function equip(cosmeticId) { return req("/profile/equip", { method: "POST", body: { cosmeticId } }); }
export async function unequip(slot) { return req("/profile/unequip", { method: "POST", body: { slot } }); }

// --- settings / wheels ---
export async function getSettings() { return req("/profile/settings"); }
export async function saveSettings(patch) { return req("/profile/settings", { method: "POST", body: patch }); }
export async function setWheelSlot(wheel, slotIndex, itemKey) { return req("/profile/wheel", { method: "POST", body: { wheel, slotIndex, itemKey } }); }

// --- wallet ---
export async function getWallet() { return req("/player/wallet"); }

// --- stores ---
export async function listBoxes(currency) { return req(`/store/boxes${currency ? `?currency=${currency}` : ""}`, { auth: false }); }
export async function openBox(boxId) { return req(`/store/boxes/${boxId}/open`, { method: "POST" }); }
export async function listItems(currency) { return req(`/store/items${currency ? `?currency=${currency}` : ""}`, { auth: false }); }
export async function buyItem(id) { return req(`/store/items/${id}/buy`, { method: "POST" }); }
export async function checkoutItems(itemIds) { return req("/payments/checkout-items", { method: "POST", body: { itemIds } }); }
// Dev only: in Stripe stub mode, completing a checkout means POSTing the
// simulate-webhook body the checkout returned. With live Stripe this is replaced
// by the real hosted-checkout redirect; here it lets us test the purchase end to end.
export async function devCompleteCheckout(simulateBody) { return req("/payments/webhook", { method: "POST", body: simulateBody, auth: false }); }
export async function redeemCode(code) { return req("/player/redeem", { method: "POST", body: { code } }); }
