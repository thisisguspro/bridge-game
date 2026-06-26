// Sound manager. Plays short SFX by logical cue name, loading audio lazily from
// /assets/sounds/<cue>.<ext>. If a file isn't present (or audio is blocked/off),
// it silently no-ops — so the game ships and plays fine with ZERO sound files,
// and real SFX drop in later (same additive pipeline as the room art).
//
// Drop files into bridge-client/public/assets/sounds/ named by cue, e.g.
// emote_laugh.mp3, attack_warning.mp3. See SOUND_CUES for the list.

let enabled = true;
let volume = 0.6;
const cache = {}; // cue -> { ok, audio } | { ok:false }
const EXTS = ["mp3", "ogg", "wav"];

export function setSoundEnabled(v) { enabled = !!v; }
export function setSoundVolume(v) { volume = Math.max(0, Math.min(1, v)); }

function load(cue) {
  if (cache[cue]) return cache[cue];
  const entry = cache[cue] = { ok: null, audio: null };
  // try the first extension; on error we mark unavailable (silent fallback)
  const a = new Audio();
  a.preload = "auto";
  a.oncanplaythrough = () => { entry.ok = true; entry.audio = a; };
  a.onerror = () => { entry.ok = false; };
  a.src = `/assets/sounds/${cue}.${EXTS[0]}`;
  return entry;
}

// Fire-and-forget. Safe to call for any cue at any time.
export function playSound(cue) {
  if (!enabled || !cue) return;
  const entry = load(cue);
  if (entry.ok === false) return;          // known-missing: silent
  const base = entry.audio;
  if (!base) return;                       // still loading: skip (no queue)
  try {
    const node = base.cloneNode(true);     // allow overlapping plays
    node.volume = volume;
    const p = node.play();
    if (p && p.catch) p.catch(() => {});   // autoplay/permission blocked: ignore
  } catch { /* ignore */ }
}

// Preload a set of cues (optional; loading is lazy anyway).
export function preloadSounds(cues = []) { for (const c of cues) load(c); }
