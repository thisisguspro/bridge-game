// Streamer mode "decoy" join codes + the troll easter egg.
//
// Real room codes use the alphabet "ABCDEFGHJKMNPQRSTUVWXYZ23456789" (note it
// deliberately omits the ambiguous chars I, L, O, 0, 1). We exploit that: a DECOY
// code looks exactly like a real 5-char code to a human, but we slip in exactly
// one "forbidden" character (one of I L O 0 1) at a believable position. That
// makes it impossible to ever collide with a real room, and trivially detectable
// on our side — so when a viewer reads the on-screen decoy off a stream and types
// it in, we know it's a decoy and send them to the troll screen instead.

const REAL_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const FORBIDDEN = "ILO01"; // chars a real code can never contain

// Make a believable-looking 5-char decoy with exactly one forbidden char.
export function makeDecoyCode() {
  const chars = [];
  for (let i = 0; i < 5; i++) chars.push(REAL_ALPHABET[Math.floor(Math.random() * REAL_ALPHABET.length)]);
  // replace one position (not the first, so it reads naturally) with a forbidden char
  const pos = 1 + Math.floor(Math.random() * 4);
  chars[pos] = FORBIDDEN[Math.floor(Math.random() * FORBIDDEN.length)];
  return chars.join("");
}

// Is this string a decoy (i.e. contains a forbidden char)? Real codes never do.
export function isDecoyCode(code) {
  const c = String(code || "").trim().toUpperCase();
  if (c.length !== 5) return false;
  for (const ch of c) if (FORBIDDEN.includes(ch)) return true;
  return false;
}
