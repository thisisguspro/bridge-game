// Display-name moderation.
//
// Names must stay family-friendly. A name that trips the filter is replaced with
// "Child" + a random 9-digit number assigned by the system. We use a large
// multi-language profanity/slur list (see wordlist.js, derived from the LDNOOBW
// "naughty-words" dataset covering ~28 languages) plus leetspeak normalization
// and tiered matching to control false positives.
//
// No client-side list is perfect, so the product also surfaces a "Report player"
// button for anything that slips through; this filter is the automated first line.

import { SHORT_EXACT, LONG_SUB, RAW_TERMS } from "./wordlist.js";

// --- normalization ---
const LEET = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "9": "g", "@": "a", "$": "s", "!": "i", "|": "i" };
// normalize for LATIN matching: lowercase, map leetspeak, drop non-letters,
// collapse long repeats. Returns a compact a-z string.
function normalize(s) {
  let t = (s || "").toLowerCase();
  t = t.replace(/[01345789@$!|]/g, (c) => LEET[c] || c);
  t = t.replace(/ph/g, "f");
  t = t.replace(/[^a-z]/g, "");
  t = t.replace(/(.)\1{2,}/g, "$1$1");
  return t;
}
// a looser pass mapping v->u (common vowel evasion: fvck)
function normalizeLoose(s) { return normalize(s).replace(/v/g, "u"); }

// tokens for whole-word matching of SHORT stems: split the original on
// non-letters, leet-normalize each, so "ass" matches "ass" but not "Cassandra".
function tokens(s) {
  const lower = (s || "").toLowerCase();
  const parts = lower.split(/[^a-z0-9@$!|]+/).filter(Boolean);
  return parts.map((p) => normalize(p)).filter(Boolean);
}

const SHORT_SET = new Set(SHORT_EXACT);
// Drop a few dataset stems that collide with common innocent names/words.
const STEM_WHITELIST = new Set(["franc", "essex", "middlesex", "sussex", "cockburn", "shitake", "shiitake", "scunthorpe", "lightwater", "clitheroe", "penistone", "analog", "analy", "assi", "assa", "class", "bass", "grape", "therapist", "rape", "rapist"]);
const LONG_SUB_FILTERED = LONG_SUB.filter((s) => !STEM_WHITELIST.has(s));
const RAW_LOWER = RAW_TERMS.map((w) => w.toLowerCase());
const RESERVED = new Set(["admin", "moderator", "anthropic", "system", "server", "host"]);

// High-confidence strong stems that should ALWAYS match as substrings, even when
// short — these don't appear inside common innocent names, so substring matching
// is safe and catches compounds like "dickface", "fuckface", "shithead". This
// supplements the dataset (which buckets some of these as short/whole-word only).
const STRONG_SUB = [
  "fuck", "shit", "dick", "cock", "cunt", "porn", "slut", "whore",
  "nigg", "nigr", "fag", "faggot", "retard", "spic", "chink", "kike", "tranny", "wetback", "gook", "coon",
  "bitch", "bastard", "wank", "pussy", "penis", "vagina", "boob", "tits", "anus", "anal", "cum", "jizz",
  "nazi", "hitler", "kkk", "molest", "pedo", "incest", "bestiality",
  "cabron", "pendejo", "puta", "mierda", "coño", "verga", "scheisse", "scheiss", "fotze", "arschloch",
  "conard", "connard", "salope", "merde", "encule",
  "xxx", "hentai", "milf", "dildo", "blowjob", "handjob", "orgasm", "horny", "ejacul",
  "assclown", "asshat", "asswipe", "asshole", "jackass", "dumbass", "fatass",
];
// "rape"/"rapist" need care: block them, but not inside "therapist"/"grape"/"drape".
function hasRapeStem(norm) {
  return /rapist|rape/.test(norm.replace(/therapist/g, "").replace(/grape/g, "").replace(/drape/g, ""));
}

// also test short tokens without collapsing repeats (so "xxx" isn't reduced to "xx")
function tokensNoCollapse(s) {
  const lower = (s || "").toLowerCase();
  const parts = lower.split(/[^a-z0-9@$!|]+/).filter(Boolean);
  return parts.map((p) => {
    let t = p.replace(/[01345789@$!|]/g, (c) => LEET[c] || c).replace(/[^a-z]/g, "");
    return t;
  }).filter(Boolean);
}

export function isNameAllowed(name) {
  const raw = (name || "").trim();
  if (raw.length < 2 || raw.length > 20) return false;

  const norm = normalize(raw);
  const loose = normalizeLoose(raw);
  if (!norm && !/[^\x00-\x7F]/.test(raw)) return false; // all symbols/digits, no CJK

  if (RESERVED.has(norm)) return false;

  // 0) curated strong stems — always substring match (safe, high-confidence)
  for (const stem of STRONG_SUB) {
    if (norm.includes(stem) || loose.includes(stem)) return false;
  }
  if (hasRapeStem(norm) || hasRapeStem(loose)) return false;
  // 1) long latin stems from the dataset: substring match
  for (const stem of LONG_SUB_FILTERED) {
    if (norm.includes(stem) || loose.includes(stem)) return false;
  }
  // 2) short latin stems: whole-token match only (avoids the Scunthorpe problem)
  const toks = [...tokens(raw), ...tokensNoCollapse(raw)];
  for (const tk of toks) {
    if (SHORT_SET.has(tk)) return false;
  }
  // 3) non-latin (CJK / Cyrillic / Arabic / etc): substring match on raw name
  const rawLower = raw.toLowerCase();
  for (const term of RAW_LOWER) {
    if (term.length >= 2 && rawLower.includes(term)) return false;
  }
  return true;
}

export function assignChildName() {
  let n = "";
  for (let i = 0; i < 9; i++) n += Math.floor(Math.random() * 10);
  return "Child" + n;
}

export function sanitizeName(requested) {
  if (isNameAllowed(requested)) return { name: (requested || "").trim(), changed: false };
  return { name: assignChildName(), changed: true, reason: "name_policy" };
}
