import "server-only";
import { sql } from "drizzle-orm";
import webpush from "web-push";
import { getDb } from "@/db";
import { env } from "@/env";
import {
  DEVICE_DAILY_LIMIT,
  DEVICE_WINDOW_HOURS,
  newPoemPayload,
  PER_AUTHOR_WINDOW_HOURS,
  PUSH_TTL_SECONDS,
  pushOutcome,
  pushTopic,
  resolveVapidSubject,
  type PushSubscriptionInput,
} from "@/lib/push-rules";
import { siteUrl } from "@/lib/site";

/*
 * Notifications about new poems (docs/PLAN.md, Phase 18). Framework-free like
 * otp.ts and poems.ts, so the integration tests drive it directly with
 * web-push mocked.
 *
 * - Subscriptions are per device, with no link to any person: endpoint (an
 *   allowlisted push service, see push-rules.ts), its two keys, timestamps.
 * - A poem is announced at most once (poems.notified_at, set in the save
 *   transaction by claimAnnouncement in poems.ts); only public poems by an
 *   author with a pen name.
 * - Limits per device: one per author in 12 hours, three in 24 hours. They're
 *   claimed in push_deliveries under the subscription rows' locks *before*
 *   sending, so two poems published at once can't both take a device's last
 *   slot. A poem over the limit isn't announced to that device: every push
 *   we send shows a notification (iOS revokes subscriptions that get silent
 *   pushes), so nothing is sent for it.
 * - A claimed slot stays used even if the send then fails: we can't know
 *   whether a timed-out push was shown, and erring towards fewer is the rule.
 */

export type PushConfig = { publicKey: string; privateKey: string; subject: string };

/** VAPID settings, or null when notifications aren't configured (no keys). env() has already checked them. */
export function pushConfig(): PushConfig | null {
  const e = env();
  if (!e.VAPID_PUBLIC_KEY || !e.VAPID_PRIVATE_KEY) return null;
  const subject = resolveVapidSubject(e.VAPID_SUBJECT || undefined, siteUrl());
  if (!subject) throw new Error("VAPID_SUBJECT is missing or unusable (see src/env.ts)");
  return { publicKey: e.VAPID_PUBLIC_KEY, privateKey: e.VAPID_PRIVATE_KEY, subject };
}

/** Store (or refresh the keys of) a device's subscription. Returns true if it was new. */
export async function saveSubscription(sub: PushSubscriptionInput): Promise<boolean> {
  const r = (await getDb().execute(sql`
    INSERT INTO push_subscriptions (endpoint, p256dh, auth)
    VALUES (${sub.endpoint}, ${sub.p256dh}, ${sub.auth})
    ON CONFLICT (endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth
    RETURNING (xmax = 0) AS inserted
  `)) as unknown as { rows: { inserted: boolean }[] };
  return r.rows[0]?.inserted ?? false;
}

/** Forget a device ("turn off"). Returns true if there was something to delete. */
export async function deleteSubscription(endpoint: string): Promise<boolean> {
  const r = await getDb().execute(sql`DELETE FROM push_subscriptions WHERE endpoint = ${endpoint}`);
  return ((r as { rowCount?: number | null }).rowCount ?? 0) > 0;
}

/** Subscriptions per claim transaction (rows locked together). */
export const CLAIM_BATCH = 200;
/** Requests in flight at once. */
export const SEND_CONCURRENCY = 20;
/** Per request; a slow push service mustn't hold the batch. */
export const SEND_TIMEOUT_MS = 10_000;
/**
 * Stop starting new batches after this: well inside the function's limit
 * (300 s by default on Vercel with Fluid Compute; `after()` shares it).
 */
export const SEND_BUDGET_MS = 180_000;

export type AnnounceResult = {
  /** Why nothing was sent, when nothing could be. */
  skipped?: "not-configured" | "not-announceable";
  sent: number;
  gone: number;
  failed: number;
  /** Devices over a limit: not announced to them. */
  limited: number;
  /** Devices not reached because the time budget ran out. */
  unreached: number;
};

type Claimed = { id: string; endpoint: string; p256dh: string; auth: string };

/**
 * Send the announcement for a poem whose save claimed it (`announce` in the
 * mutation result). Runs in `after()`, never inside the save.
 */
export async function announcePoem(
  poemId: string,
  opts: { budgetMs?: number; now?: () => number } = {},
): Promise<AnnounceResult> {
  const result: AnnounceResult = { sent: 0, gone: 0, failed: 0, limited: 0, unreached: 0 };
  const config = pushConfig();
  if (!config) return { ...result, skipped: "not-configured" };
  const db = getDb();

  // Checked again at send time: claimed, still published, still public, pen name set.
  const poem = (
    (await db.execute(sql`
      SELECT p.id, p.title, p.slug, p.editor_id, e.pen_name, e.slug AS author_slug
      FROM poems p JOIN editors e ON e.id = p.editor_id
      WHERE p.id = ${poemId} AND p.notified_at IS NOT NULL
        AND p.status = 'published' AND p.visibility = 'public'
        AND e.pen_name IS NOT NULL AND e.slug IS NOT NULL
    `)) as unknown as {
      rows: { id: string; title: string; slug: string; editor_id: string; pen_name: string; author_slug: string }[];
    }
  ).rows[0];
  if (!poem) return { ...result, skipped: "not-announceable" };

  const payload = JSON.stringify(
    newPoemPayload({
      poemId: poem.id,
      title: poem.title,
      penName: poem.pen_name,
      authorSlug: poem.author_slug,
      poemSlug: poem.slug,
    }),
  );
  const options: webpush.RequestOptions = {
    vapidDetails: config,
    TTL: PUSH_TTL_SECONDS,
    urgency: "normal",
    topic: pushTopic(poem.id),
    timeout: SEND_TIMEOUT_MS,
  };

  const now = opts.now ?? Date.now;
  const started = now();
  const budget = opts.budgetMs ?? SEND_BUDGET_MS;
  let after = "00000000-0000-0000-0000-000000000000";
  for (;;) {
    const page = (
      (await db.execute(sql`
        SELECT id FROM push_subscriptions WHERE id > ${after} ORDER BY id LIMIT ${CLAIM_BATCH}
      `)) as unknown as { rows: { id: string }[] }
    ).rows.map((r) => r.id);
    if (page.length === 0) break;
    after = page[page.length - 1];
    if (now() - started > budget) {
      result.unreached += page.length + (await countAfter(after));
      console.error(`[push] poem ${poemId}: time budget spent, ${result.unreached} device(s) not reached`);
      break;
    }
    const claimed = await claimDeliveries(poem.editor_id, poem.id, page);
    result.limited += page.length - claimed.length;
    await sendAll(claimed, payload, options, result);
  }
  return result;
}

async function countAfter(id: string): Promise<number> {
  const r = (await getDb().execute(
    sql`SELECT count(*)::int AS n FROM push_subscriptions WHERE id > ${id}`,
  )) as unknown as { rows: { n: number }[] };
  return r.rows[0].n;
}

/**
 * Take a slot on each of these devices for this author's poem, if the limits
 * allow, in one transaction: lock the subscription rows first (id order, so
 * concurrent announcements can't deadlock), then count and insert in a
 * second statement. Under READ COMMITTED that statement takes a fresh
 * snapshot after the locks, so it sees deliveries a concurrent announcement
 * committed while we waited. Returns the devices to send to.
 */
export async function claimDeliveries(editorId: string, poemId: string, ids: string[]): Promise<Claimed[]> {
  if (ids.length === 0) return [];
  const list = sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM push_subscriptions WHERE id IN (${list}) ORDER BY id FOR UPDATE`);
    const r = (await tx.execute(sql`
      WITH ok AS (
        SELECT s.id FROM push_subscriptions s
        WHERE s.id IN (${list})
          AND NOT EXISTS (
            SELECT 1 FROM push_deliveries d
            WHERE d.subscription_id = s.id AND d.editor_id = ${editorId}
              AND d.sent_at > now() - make_interval(hours => ${PER_AUTHOR_WINDOW_HOURS})
          )
          AND (
            SELECT count(*) FROM push_deliveries d
            WHERE d.subscription_id = s.id
              AND d.sent_at > now() - make_interval(hours => ${DEVICE_WINDOW_HOURS})
          ) < ${DEVICE_DAILY_LIMIT}
      ), ins AS (
        INSERT INTO push_deliveries (subscription_id, editor_id, poem_id)
        SELECT id, ${editorId}, ${poemId} FROM ok
        RETURNING subscription_id
      )
      SELECT s.id, s.endpoint, s.p256dh, s.auth
      FROM push_subscriptions s JOIN ins ON ins.subscription_id = s.id
    `)) as unknown as { rows: Claimed[] };
    return r.rows;
  });
}

async function sendAll(subs: Claimed[], payload: string, options: webpush.RequestOptions, result: AnnounceResult) {
  const sent: string[] = [];
  const gone: string[] = [];
  const tried: string[] = [];
  let next = 0;
  async function worker() {
    while (next < subs.length) {
      const s = subs[next++];
      let status: number;
      try {
        const res = await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
          options,
        );
        status = res.statusCode;
      } catch (e) {
        status = (e as { statusCode?: number }).statusCode ?? 0; // 0: network error / timeout
      }
      const outcome = pushOutcome(status);
      if (outcome === "sent") sent.push(s.id);
      else if (outcome === "gone") gone.push(s.id);
      else {
        tried.push(s.id);
        // Never the endpoint (a capability URL) in logs: the host is enough.
        if (outcome === "error") console.error(`[push] ${new URL(s.endpoint).host} answered ${status}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(SEND_CONCURRENCY, subs.length) }, worker));

  const db = getDb();
  const ids = (xs: string[]) => sql.join(xs.map((id) => sql`${id}::uuid`), sql`, `);
  if (sent.length) {
    await db.execute(
      sql`UPDATE push_subscriptions SET last_success_at = now(), last_attempt_at = now() WHERE id IN (${ids(sent)})`,
    );
  }
  if (tried.length) {
    await db.execute(sql`UPDATE push_subscriptions SET last_attempt_at = now() WHERE id IN (${ids(tried)})`);
  }
  // 404/410: the push service says this address is dead (unsubscribed, expired).
  if (gone.length) await db.execute(sql`DELETE FROM push_subscriptions WHERE id IN (${ids(gone)})`);
  result.sent += sent.length;
  result.gone += gone.length;
  result.failed += tried.length;
}
