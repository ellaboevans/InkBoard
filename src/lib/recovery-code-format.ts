/**
 * Recovery code format (docs/PLAN.md, Phase 16). Pure, so the sign-in form,
 * the profile page and the tests share it.
 *
 * A code is 12 symbols of Crockford base32 (0-9 and A-Z without I, L, O, U),
 * 5 bits each: 60 bits of entropy. Shown as three groups of four,
 * `XXXX-XXXX-XXXX`, in a monospace face with a slashed zero.
 *
 * Typing is forgiving: case, spaces and dashes don't matter, and the letters
 * people confuse with digits count as those digits (O → 0, I and L → 1),
 * as Crockford's spec says. U isn't in the alphabet and isn't mapped.
 */

export const RECOVERY_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const RECOVERY_CODE_LENGTH = 12;
export const RECOVERY_CODE_GROUP = 4;
/** How many codes a set has. */
export const RECOVERY_CODES_PER_SET = 10;
/** At or below this many unused codes, the dashboard suggests a new set. */
export const RECOVERY_CODES_LOW = 2;
/** Bits of entropy per code (12 × 5). */
export const RECOVERY_CODE_BITS = RECOVERY_CODE_LENGTH * Math.log2(RECOVERY_CODE_ALPHABET.length);

/** Longest input accepted before normalising (codes plus generous spacing). */
const MAX_INPUT = 40;
const CANONICAL = new RegExp(`^[${RECOVERY_CODE_ALPHABET}]{${RECOVERY_CODE_LENGTH}}$`);

/**
 * The canonical 12 symbols for a typed code, or null if it can't be one.
 * Drops whitespace and dashes (any kind), upper-cases, and maps O→0, I/L→1.
 */
export function normalizeRecoveryCode(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > MAX_INPUT) return null;
  const symbols = raw
    .normalize("NFKC")
    .replace(/[\s\p{Pd}_]/gu, "")
    .toUpperCase()
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  return CANONICAL.test(symbols) ? symbols : null;
}

/** `ABCD-EFGH-JKMN` for display. Expects a canonical code. */
export function formatRecoveryCode(code: string): string {
  const groups: string[] = [];
  for (let i = 0; i < code.length; i += RECOVERY_CODE_GROUP) groups.push(code.slice(i, i + RECOVERY_CODE_GROUP));
  return groups.join("-");
}

/**
 * The text that Copy and Download give the editor: the codes plus enough
 * context to know what they are when found in a drawer years later.
 */
export function recoveryCodesText(codes: string[], { email, site }: { email: string; site: string }): string {
  return [
    `InkBoard recovery codes for ${email}`,
    "",
    ...codes.map((c) => formatRecoveryCode(c)),
    "",
    "Each code signs you in once, without your email:",
    `${site}/sign-in/recovery`,
    "",
    "Keep them somewhere safe and private: a password manager, or printed and kept in your wallet.",
    "Making a new set replaces these ones.",
    "",
  ].join("\n");
}
