import "server-only";
import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";
import { env } from "@/env";
import { RECOVERY_CODE_ALPHABET, RECOVERY_CODE_LENGTH } from "@/lib/recovery-code-format";

/** Uniformly random 6-digit numeric code, zero-padded. */
export function generateOtpCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

/** 256-bit random token, base64url. Used for session cookies. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
/** Length of a sign-in link token: 44 letters ≈ 250 bits. */
export const LINK_TOKEN_LENGTH = 44;

/**
 * Random token made of letters only (no digits, `-` or `_`), for sign-in
 * links. Mail clients' code detectors look for runs of digits, so a link
 * must never contain one they could mistake for the 6-digit code.
 */
export function generateLetterToken(length = LINK_TOKEN_LENGTH): string {
  let out = "";
  while (out.length < length) {
    for (const byte of randomBytes(length)) {
      // 52 * 4 = 208: reject 208–255 so every letter is equally likely.
      if (byte < 208 && out.length < length) out += LETTERS[byte % 52];
    }
  }
  return out;
}

/**
 * A recovery code: 12 uniformly random Crockford base32 symbols (60 bits),
 * canonical form without dashes (see src/lib/recovery-code-format.ts).
 */
export function generateRecoveryCode(): string {
  // 32 divides 256, so taking the low 5 bits of each byte is unbiased.
  let out = "";
  for (const byte of randomBytes(RECOVERY_CODE_LENGTH)) out += RECOVERY_CODE_ALPHABET[byte & 31];
  return out;
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Keyed hash. OTPs are low-entropy (10^6), so a plain hash would be trivially
 * reversible from a DB dump; keying with AUTH_SECRET prevents that.
 * `purpose` domain-separates different uses of the same secret.
 */
export function hmac(purpose: string, value: string): string {
  return createHmac("sha256", env().AUTH_SECRET)
    .update(`${purpose}\u0000${value}`)
    .digest("hex");
}

/** Constant-time comparison of two hex/base64 strings. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
