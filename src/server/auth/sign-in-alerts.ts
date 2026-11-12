import "server-only";
import { and, eq, ne, sql } from "drizzle-orm";
import { after } from "next/server";
import { getDb } from "@/db";
import { signInLocations } from "@/db/schema";
import { describeUserAgent } from "@/lib/user-agent";
import { hmac } from "@/server/crypto";
import { sendSignInAlertEmail } from "@/server/email";
import { rateLimit } from "@/server/rate-limit";
import { ipBucket } from "./ip";

/** At most this many "new sign-in" emails per editor per day. */
const ALERTS_PER_DAY = 5;

export type SignInLocation =
  /** The editor's first recorded sign-in (new account, or first since this feature shipped). */
  | "first"
  /** A network this editor has signed in from before. */
  | "known"
  /** A network we haven't seen for this editor: worth telling them. */
  | "new"
  /** No client IP (e.g. no trusted proxy header): nothing to compare. */
  | "unknown";

/**
 * Remember the network (IP bucket: IPv4 address or IPv6 /64) of a successful
 * sign-in and say whether it's new for this editor. Only an HMAC of the bucket
 * is stored, so the table holds no IP history.
 */
export async function recordSignInLocation(editorId: string, ip: string | null | undefined): Promise<SignInLocation> {
  const bucket = ipBucket(ip);
  if (bucket === "unknown") return "unknown";
  const ipKey = hmac("sign-in-location", bucket);
  const db = getDb();

  // One atomic upsert: xmax = 0 means the row was inserted, i.e. a new network.
  const result = (await db.execute(sql`
    INSERT INTO sign_in_locations (editor_id, ip_key)
    VALUES (${editorId}, ${ipKey})
    ON CONFLICT (editor_id, ip_key) DO UPDATE SET last_seen_at = now()
    RETURNING (xmax = 0) AS inserted
  `)) as unknown as { rows: { inserted: boolean }[] };
  if (!result.rows[0]?.inserted) return "known";

  const [other] = await db
    .select({ id: signInLocations.id })
    .from(signInLocations)
    .where(and(eq(signInLocations.editorId, editorId), ne(signInLocations.ipKey, ipKey)))
    .limit(1);
  return other ? "new" : "first";
}

/**
 * After a successful sign-in: record where it came from and, if that network
 * is new for this editor, email them a security notice. The email is sent
 * after the response (like sign-in codes) and capped per day; a failed send is
 * logged, never surfaced to the person signing in.
 */
export async function notifyIfNewSignIn(input: {
  editorId: string;
  email: string;
  penName: string | null;
  ip: string | null | undefined;
  userAgent: string | null | undefined;
}): Promise<SignInLocation> {
  const location = await recordSignInLocation(input.editorId, input.ip);
  if (location !== "new") return location;

  const limit = await rateLimit(`signin-alert:${input.editorId}`, ALERTS_PER_DAY, 86400);
  if (!limit.allowed) return location;

  const details = {
    penName: input.penName,
    device: describeUserAgent(input.userAgent),
    ip: input.ip!,
    at: new Date(),
  };
  after(async () => {
    try {
      await sendSignInAlertEmail(input.email, details);
    } catch (err) {
      console.error("Failed to send new sign-in alert", err);
    }
  });
  return location;
}
