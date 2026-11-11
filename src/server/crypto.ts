import "server-only";
import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";
import { env } from "@/env";

/** Uniformly random 6-digit numeric code, zero-padded. */
export function generateOtpCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

/** 256-bit random token, base64url. Used for session cookies. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
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
