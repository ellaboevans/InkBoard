import "server-only";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { PASSWORD_MAX } from "@/lib/poem-limits";

/**
 * Poem passwords (N6). Stored as `scrypt$N$r$p$salt$hash` (base64url), so the
 * cost parameters can be raised later without invalidating existing hashes.
 */
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 32;
const SALT_BYTES = 16;
// scrypt needs ~128·N·r bytes; leave headroom above Node's 32 MiB default.
const MAXMEM = 64 * 1024 * 1024;

/**
 * Parameter sets we have issued. Anything else in a stored hash is rejected,
 * so a tampered row can't make the server run an arbitrarily expensive scrypt.
 * Add the old set here when raising the cost.
 */
const ACCEPTED_PARAMS = new Set([[N, R, P].join("$")]);

function derive(
  password: string,
  salt: Buffer,
  n: number,
  r: number,
  p: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(
      password.normalize("NFKC"),
      salt,
      KEYLEN,
      { N: n, r, p, maxmem: MAXMEM },
      (err, key) => (err ? reject(err) : resolve(key)),
    ),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, N, R, P);
  return [
    "scrypt",
    N,
    R,
    P,
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join("$");
}

/**
 * Constant-time check of `password` against a stored hash. Never throws:
 * malformed, truncated or tampered hashes (wrong salt/key lengths, unknown
 * cost parameters) simply fail. In particular an empty key can't make
 * `timingSafeEqual(empty, empty)` accept any password.
 */
export async function verifyPassword(
  password: string,
  stored: string | null | undefined,
): Promise<boolean> {
  if (!stored || typeof password !== "string") return false;
  if (password.length === 0 || password.length > PASSWORD_MAX) return false;

  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, keyB64] = parts;
  if (!ACCEPTED_PARAMS.has([n, r, p].join("$"))) return false;

  const salt = Buffer.from(saltB64, "base64url");
  const expected = Buffer.from(keyB64, "base64url");
  if (salt.length !== SALT_BYTES || expected.length !== KEYLEN) return false;

  try {
    const actual = await derive(password, salt, Number(n), Number(r), Number(p));
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
