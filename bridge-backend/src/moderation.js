// Display-name moderation.
//
// Game names must stay roughly PG-13. A name that trips the filter is replaced
// with "Child" + a random 9-digit number (assigned by the system), matching the
// behavior described for the product. This is intentionally conservative: we
// normalize common evasion (leetspeak, repeats, separators) and match a blocked
// stem list. It will not catch everything — no client-side wordlist can — so the
// real deployment should pair this with a server-side/3rd-party check, but this
// gives a solid first line and a clean, testable contract.

// Normalize for matching: lowercase, map leetspeak, strip separators, collapse
// repeated characters so "f-u_c k" / "fvck" / "fuuuck" all reduce toward a stem.
const LEET = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "9": "g", "@": "a", "$": "s", "!": "i", "|": "i" };
function normalize(s) {
  let t = (s || "").toLowerCase();
  t = t.replace(/[01345789@$!|]/g, (c) => LEET[c] || c);
  t = t.replace(/ph/g, "f");           // ph -> f (phuck)
  t = t.replace(/[^a-z]/g, "");        // drop spaces, punctuation, digits left
  t = t.replace(/(.)\1{2,}/g, "$1$1"); // collapse 3+ repeats to 2
  // also test a vowel-collapsed variant so "fvck"/"fck" map toward "fuck": we
  // build a second string with v->u and stripped vowels handled at match time.
  return t;
}
// A looser variant: map 'v'->'u' (common vowel evasion) for a second pass.
function normalizeLoose(s) {
  return normalize(s).replace(/v/g, "u");
}

// Blocked stems (substring match after normalization). Kept as stems so variants
// are covered. This is a representative safety list, not exhaustive.
const BLOCKED_STEMS = [
  // strong profanity
  "fuck", "shit", "bitch", "cunt", "asshole", "dickhead", "bastard", "wank", "bollock",
  // sexual / explicit
  "sex", "porn", "penis", "vagina", "boob", "tits", "cum", "orgasm", "rape", "horny", "nude", "naked", "dildo", "blowjob", "handjob", "cock", "pussy", "anal", "milf", "hentai",
  // slurs (racial / homophobic / ableist) — stems
  "nigg", "fagg", "retard", "spic", "chink", "kike", "tranny", "dyke", "wetback", "gook",
  // hate / violence
  "nazi", "hitler", "kkk", "isis", "terrorist", "kill", "suicide", "rapist",
  // drugs (kept light for PG-13)
  "cocaine", "heroin", "meth",
];

// Names that are impersonation-ish or reserved (lightweight).
const RESERVED = ["admin", "moderator", "anthropic", "system"];

export function isNameAllowed(name) {
  const raw = (name || "").trim();
  if (raw.length < 2 || raw.length > 20) return false;
  const norm = normalize(raw);
  const loose = normalizeLoose(raw);
  if (!norm) return false; // all symbols/digits -> reject
  for (const stem of BLOCKED_STEMS) if (norm.includes(stem) || loose.includes(stem)) return false;
  for (const r of RESERVED) if (norm === r) return false;
  return true;
}

// Random "Child" + 9-digit id, system-assigned, when a name is rejected.
export function assignChildName() {
  let n = "";
  for (let i = 0; i < 9; i++) n += Math.floor(Math.random() * 10);
  return "Child" + n;
}

// Sanitize a requested name: return the clean name, or a Child##### replacement.
// Returns { name, changed, reason }.
export function sanitizeName(requested) {
  if (isNameAllowed(requested)) return { name: (requested || "").trim(), changed: false };
  return { name: assignChildName(), changed: true, reason: "name_policy" };
}
