import "server-only";
import { and, eq, ne, sql } from "drizzle-orm";
import { after } from "next/server";
import { getDb } from "@/db";
import { signInDevices, signInLocations } from "@/db/schema";
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

export type SignInDevice =
  /** The editor's first recorded browser (new account, or first since device alerts shipped). */
  | "first"
  /** A browser this editor has signed in from before. */
  | "known"
  /** A browser we haven't seen for this editor: worth telling them. */
  | "new";

/**
 * Remember the browser (an HMAC of its device-cookie id) of a successful
 * sign-in and say whether it's new for this editor. Pass the id from
 * deviceIdForSignIn(); a freshly issued id is never known.
 */
export async function recordSignInDevice(editorId: string, deviceId: string): Promise<SignInDevice> {
  const deviceKey = hmac("sign-in-device", deviceId);
  const db = getDb();
  const result = (await db.execute(sql`
    INSERT INTO sign_in_devices (editor_id, device_key)
    VALUES (${editorId}, ${deviceKey})
    ON CONFLICT (editor_id, device_key) DO UPDATE SET last_seen_at = now()
    RETURNING (xmax = 0) AS inserted
  `)) as unknown as { rows: { inserted: boolean }[] };
  if (!result.rows[0]?.inserted) return "known";

  const [other] = await db
    .select({ id: signInDevices.id })
    .from(signInDevices)
    .where(and(eq(signInDevices.editorId, editorId), ne(signInDevices.deviceKey, deviceKey)))
    .limit(1);
  return other ? "new" : "first";
}

/** What was new about a sign-in that triggered an alert. */
export type SignInAlertReason = "device" | "network" | "both";

/**
 * After a successful sign-in: record which browser and network it came from
 * and, if either is new for this editor, email them a security notice. A new
 * device on the same Wi-Fi shares the network's public IP, which is why
 * devices are tracked too. The first browser and network ever recorded stay
 * quiet (nothing to compare against). The email is sent after the response
 * (like sign-in codes) and capped per day; a failed send is logged, never
 * surfaced to the person signing in.
 */
export async function notifyIfNewSignIn(input: {
  editorId: string;
  email: string;
  penName: string | null;
  ip: string | null | undefined;
  userAgent: string | null | undefined;
  deviceId: string;
}): Promise<{ network: SignInLocation; device: SignInDevice; alerted: boolean }> {
  const network = await recordSignInLocation(input.editorId, input.ip);
  const device = await recordSignInDevice(input.editorId, input.deviceId);
  const reason: SignInAlertReason | null =
    network === "new" && device === "new" ? "both" : network === "new" ? "network" : device === "new" ? "device" : null;
  const result = { network, device, alerted: false };
  if (!reason) return result;

  const limit = await rateLimit(`signin-alert:${input.editorId}`, ALERTS_PER_DAY, 86400);
  if (!limit.allowed) return result;

  const details = {
    penName: input.penName,
    device: describeUserAgent(input.userAgent),
    ip: input.ip ?? "Unknown",
    at: new Date(),
    reason,
  };
  after(async () => {
    try {
      await sendSignInAlertEmail(input.email, details);
    } catch (err) {
      console.error("Failed to send new sign-in alert", err);
    }
  });
  return { ...result, alerted: true };
}
