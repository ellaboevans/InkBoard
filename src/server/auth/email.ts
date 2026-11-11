import { z } from "zod";

const emailSchema = z.email().max(254);

/** Trim + lower-case, then validate. Returns null if not a valid address. */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  return emailSchema.safeParse(email).success ? email : null;
}

/**
 * `allowlist` is a comma-separated list of emails and/or `@domain` entries.
 * An empty allowlist allows everyone.
 */
export function isEmailAllowed(email: string, allowlist: string): boolean {
  const entries = allowlist
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (entries.length === 0) return true;
  const domain = email.slice(email.lastIndexOf("@"));
  return entries.some((entry) =>
    entry.startsWith("@") ? entry === domain : entry === email,
  );
}
