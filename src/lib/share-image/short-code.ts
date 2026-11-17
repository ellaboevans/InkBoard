/*
 * Short codes for shared images (docs/PLAN.md, Phase 21 round 3): the
 * `/s/<code>` printed on a poem's pictures, typed by someone reading it off a
 * WhatsApp Status. Pure, shared by the server and the tests.
 *
 * THE ALPHABET: lowercase digits and consonants only, 27 symbols:
 *   - no 0/o, 1/l/i: nothing that reads two ways off a picture;
 *   - no vowels (a e i o u, nor y): random strings can't spell words, rude or
 *     otherwise, in English or in the Ghanaian languages;
 *   - lowercase, so the printed address matches what a phone keyboard types
 *     (an auto-capitalised first letter is still accepted, see parseShortCode).
 * THE LENGTH: 6 symbols, 27^6 ≈ 387 million codes: short enough to type, and
 * far more than InkBoard's poems, so a random draw almost never collides (the
 * database's unique index catches the rare one, and a new code is drawn).
 */

export const SHORT_CODE_ALPHABET = "23456789bcdfghjkmnpqrstvwxz";
export const SHORT_CODE_LENGTH = 6;

const SHAPE = new RegExp(`^[${SHORT_CODE_ALPHABET}]{${SHORT_CODE_LENGTH}}$`);

/** A random code from `bytes` (one random byte per symbol, rejection-sampled so every symbol is equally likely). */
export function shortCodeFromBytes(next: () => number): string {
  const n = SHORT_CODE_ALPHABET.length;
  const limit = 256 - (256 % n); // bytes at or above this would favour the first symbols
  let code = "";
  while (code.length < SHORT_CODE_LENGTH) {
    const b = next();
    if (b < limit) code += SHORT_CODE_ALPHABET[b % n];
  }
  return code;
}

/** A fresh random code (Web Crypto: works on the server and in tests). */
export function newShortCode(): string {
  const pool = new Uint8Array(32);
  let i = pool.length;
  return shortCodeFromBytes(() => {
    if (i >= pool.length) {
      crypto.getRandomValues(pool);
      i = 0;
    }
    return pool[i++];
  });
}

/**
 * The code in a typed or followed address, or null if it can't be one.
 * Capitals are accepted (phones capitalise the first letter of a word);
 * anything outside the alphabet or of another length is refused.
 */
export function parseShortCode(raw: string): string | null {
  const code = raw.toLowerCase();
  return SHAPE.test(code) ? code : null;
}

/** The printed path, e.g. /s/k3x9qm */
export const shortPath = (code: string) => `/s/${code}`;
