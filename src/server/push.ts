import "server-only";
import { sql } from "drizzle-orm";
import webpush from "web-push";
import { getDb } from "@/db";
import { safeEqual, sha256 } from "@/server/crypto";
import { env } from "@/env";
import {
  DEVICE_DAILY_LIMIT,
  DEVICE_WINDOW_HOURS,
  newChapterPayload,
  newPoemPayload,
  PER_AUTHOR_WINDOW_HOURS,
  PUSH_TTL_SECONDS,
  pushOutcome,
  pushTopic,
  resolveVapidSubject,
  MAX_FOLLOWS,
  UPDATES_PER_WINDOW,
  type OwnerProof,
  type PrefsOp,
  type PushMode,
  type PushPrefs,
  type PushSubscriptionInput,
} from "@/lib/push-rules";
import { siteUrl } from "@/lib/site";
import { appendFile } from "node:fs/promises";

/**
 * The E2E server's stand-in for push services (like E2E_OTP_OUTBOX for
 * emails; never in production): the stubbed browsers' endpoints look real, so
 * payloads are appended to this file (with the subscription's id, never the
 * endpoint) instead of being sent anywhere.
 */
const pushOutbox = process.env.NODE_ENV !== "production" ? process.env.E2E_PUSH_OUTBOX : undefined;

/*
 * Notifications about new poems (docs/PLAN.md, Phase 18). Framework-free like
 * otp.ts and poems.ts, so the integration tests drive it directly with
 * web-push mocked.
 *
 * - Subscriptions are per device, with no link to any person: endpoint (an
 *   allowlisted push service, see push-rules.ts), its two keys, timestamps.
 * - A poem is announced at most once (poems.notified_at, set in the save
 *   transaction by claimAnnouncement in poems.ts); only public poems by an
 *   author with a pen name. A chapter likewise (chapters.notified_at,
 *   claimChapterAnnouncement in novels.ts; Phase 24), and only to devices
 *   that follow its author.
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

export type SaveResult =
  | { ok: true; created: boolean; prefs: StoredPrefs }
  /** The endpoint is stored with a different auth secret: not this browser's to change. */
  | { ok: false };

export type StoredPrefs = { mode: PushMode; follows: { slug: string; penName: string }[] };

/**
 * Store a device's subscription, or re-register it. An existing row is only
 * touched when the auth secret matches (the browser that owns it), so knowing
 * an endpoint can't be used to take a subscription over. `prefs` (mode and
 * followed author slugs) are applied only when the row is new: a lost
 * subscription comes back with the follows the browser remembers.
 */
export async function saveSubscription(sub: PushSubscriptionInput, prefs?: PushPrefs | null): Promise<SaveResult> {
  return getDb().transaction(async (tx) => {
    const r = (await tx.execute(sql`
      INSERT INTO push_subscriptions (endpoint, p256dh, auth, mode)
      VALUES (${sub.endpoint}, ${sub.p256dh}, ${sub.auth}, ${prefs?.mode ?? "all"})
      ON CONFLICT (endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh
        WHERE push_subscriptions.auth = EXCLUDED.auth
      RETURNING id, (xmax = 0) AS inserted
    `)) as unknown as { rows: { id: string; inserted: boolean }[] };
    const row = r.rows[0];
    if (!row) return { ok: false as const };
    if (row.inserted && prefs?.follows.length) await addFollows(tx, row.id, prefs.follows);
    return { ok: true as const, created: row.inserted, prefs: await readPrefs(tx, row.id) };
  });
}

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

async function addFollows(tx: Tx, subscriptionId: string, slugs: string[]) {
  if (!slugs.length) return;
  const list = sql.join(slugs.map((x) => sql`${x}`), sql`, `);
  await tx.execute(sql`
    INSERT INTO push_follows (subscription_id, editor_id)
    SELECT ${subscriptionId}, e.id FROM editors e
    WHERE e.slug IN (${list}) AND e.pen_name IS NOT NULL
      AND (SELECT count(*) FROM push_follows f WHERE f.subscription_id = ${subscriptionId}) < ${MAX_FOLLOWS}
    ON CONFLICT (subscription_id, editor_id) DO NOTHING
  `);
}

async function readPrefs(tx: Tx | ReturnType<typeof getDb>, subscriptionId: string): Promise<StoredPrefs> {
  const r = (await tx.execute(sql`
    SELECT s.mode, e.slug, e.pen_name
    FROM push_subscriptions s
    LEFT JOIN push_follows f ON f.subscription_id = s.id
    LEFT JOIN editors e ON e.id = f.editor_id AND e.pen_name IS NOT NULL
    WHERE s.id = ${subscriptionId}
    ORDER BY lower(e.pen_name)
  `)) as unknown as { rows: { mode: PushMode; slug: string | null; pen_name: string | null }[] };
  return {
    mode: r.rows[0]?.mode ?? "all",
    follows: r.rows.filter((x) => x.slug && x.pen_name).map((x) => ({ slug: x.slug!, penName: x.pen_name! })),
  };
}

/**
 * The subscription this browser owns, by endpoint *and* auth secret, locked
 * for the change. Null for an unknown endpoint and for a wrong secret alike,
 * so the answer never tells one from the other.
 */
async function ownedSubscription(tx: Tx, proof: OwnerProof): Promise<string | null> {
  const r = (await tx.execute(sql`
    SELECT id, auth FROM push_subscriptions WHERE endpoint = ${proof.endpoint} FOR UPDATE
  `)) as unknown as { rows: { id: string; auth: string }[] };
  const row = r.rows[0];
  // Compare even when there's no row, against a stand-in of the same length.
  const stored = row?.auth ?? "AAAAAAAAAAAAAAAAAAAAAA";
  return safeEqual(sha256(stored), sha256(proof.auth)) && row ? row.id : null;
}

/** Read or change a device's mode and follows. Null: not this browser's (or no such) subscription. */
export async function changePrefs(proof: OwnerProof, change: PrefsOp): Promise<StoredPrefs | null> {
  return getDb().transaction(async (tx) => {
    const id = await ownedSubscription(tx, proof);
    if (!id) return null;
    if (change.op === "mode") {
      await tx.execute(sql`UPDATE push_subscriptions SET mode = ${change.mode} WHERE id = ${id}`);
    } else if (change.op === "follow") {
      await addFollows(tx, id, [change.author]);
    } else if (change.op === "unfollow") {
      await tx.execute(sql`
        DELETE FROM push_follows f USING editors e
        WHERE f.subscription_id = ${id} AND f.editor_id = e.id AND e.slug = ${change.author}
      `);
    }
    return readPrefs(tx, id);
  });
}

/** Forget a device ("turn off"), proven by its auth secret. Returns true if there was something to delete. */
export async function deleteSubscription(proof: OwnerProof): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    const id = await ownedSubscription(tx, proof);
    if (!id) return false;
    await tx.execute(sql`DELETE FROM push_subscriptions WHERE id = ${id}`);
    return true;
  });
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
  /** Of `sent`+`failed`+`gone`: quiet updates of an earlier notification ("n new poems by …"). */
  updates: number;
  /** Devices not reached because the time budget ran out. */
  unreached: number;
};

type Claimed = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  /** Poems by this author in this device's window, this one included: 1 = a new alert, ≥ 2 = a quiet update. */
  count: number;
};

/**
 * What a delivery is for: a poem, or (Phase 24) a chapter. Both count toward
 * the same limits: push_deliveries rows per device and author, whatever kind.
 */
export type DeliveryTarget = { poemId: string } | { chapterId: string };

/** Who may hear about it: poems go to "all" devices and followers; chapters to followers only (an owner's decision). */
type Audience = "poem" | "chapter";

function audienceWhere(audience: Audience, editorId: string) {
  const follows = sql`EXISTS (
    SELECT 1 FROM push_follows f WHERE f.subscription_id = s.id AND f.editor_id = ${editorId}
  )`;
  // Poems: "All new poems", or this author is followed (Phase 18 round 2). Chapters: followed only.
  return audience === "poem" ? sql`(s.mode = 'all' OR ${follows})` : follows;
}

/**
 * Send the announcement for a poem whose save claimed it (`announce` in the
 * mutation result). Runs in `after()`, never inside the save.
 */
export async function announcePoem(
  poemId: string,
  opts: { budgetMs?: number; now?: () => number } = {},
): Promise<AnnounceResult> {
  const config = pushConfig();
  if (!config) return { ...emptyResult(), skipped: "not-configured" };

  // Checked again at send time: claimed, still published, still public, pen name set.
  const poem = (
    (await getDb().execute(sql`
      SELECT p.id, p.title, p.slug, p.editor_id, e.pen_name, e.slug AS author_slug
      FROM poems p JOIN editors e ON e.id = p.editor_id
      WHERE p.id = ${poemId} AND p.notified_at IS NOT NULL
        AND p.status = 'published' AND p.visibility = 'public'
        AND e.pen_name IS NOT NULL AND e.slug IS NOT NULL
    `)) as unknown as {
      rows: { id: string; title: string; slug: string; editor_id: string; pen_name: string; author_slug: string }[];
    }
  ).rows[0];
  if (!poem) return { ...emptyResult(), skipped: "not-announceable" };

  return sendToAudience(config, {
    editorId: poem.editor_id,
    target: { poemId: poem.id },
    audience: "poem",
    label: `poem ${poemId}`,
    payloadFor: (count) =>
      JSON.stringify(
        newPoemPayload({
          editorId: poem.editor_id,
          title: poem.title,
          penName: poem.pen_name,
          authorSlug: poem.author_slug,
          poemSlug: poem.slug,
          count,
        }),
      ),
    opts,
  });
}

/**
 * Send the "new chapter" notification for a chapter whose publish claimed it
 * (`announce` in saveChapter's result; Phase 24). Runs in `after()`. Checked
 * again here: claimed, still published, the author's pen name set. Only to
 * devices that follow the author, never to "all new poems" devices that
 * don't. The same limits and grouping as poems, in the same rows.
 */
export async function announceChapter(
  chapterId: string,
  opts: { budgetMs?: number; now?: () => number } = {},
): Promise<AnnounceResult> {
  const config = pushConfig();
  if (!config) return { ...emptyResult(), skipped: "not-configured" };

  const chapter = (
    (await getDb().execute(sql`
      SELECT c.id, c.slug, n.title AS novel_title, n.slug AS novel_slug, n.editor_id, e.pen_name, e.slug AS author_slug,
        -- Its number among the novel's published chapters, as readers see it.
        (SELECT count(*)::int FROM chapters o
          WHERE o.novel_id = c.novel_id AND o.status = 'published' AND o.position <= c.position) AS number
      FROM chapters c JOIN novels n ON n.id = c.novel_id JOIN editors e ON e.id = n.editor_id
      WHERE c.id = ${chapterId} AND c.notified_at IS NOT NULL AND c.status = 'published'
        AND n.visibility = 'public' AND e.pen_name IS NOT NULL AND e.slug IS NOT NULL
    `)) as unknown as {
      rows: {
        id: string;
        slug: string;
        novel_title: string;
        novel_slug: string;
        editor_id: string;
        pen_name: string;
        author_slug: string;
        number: number;
      }[];
    }
  ).rows[0];
  if (!chapter) return { ...emptyResult(), skipped: "not-announceable" };

  return sendToAudience(config, {
    editorId: chapter.editor_id,
    target: { chapterId: chapter.id },
    audience: "chapter",
    label: `chapter ${chapterId}`,
    payloadFor: (count) =>
      JSON.stringify(
        newChapterPayload({
          editorId: chapter.editor_id,
          novelTitle: chapter.novel_title,
          number: chapter.number,
          penName: chapter.pen_name,
          authorSlug: chapter.author_slug,
          novelSlug: chapter.novel_slug,
          chapterSlug: chapter.slug,
          count,
        }),
      ),
    opts,
  });
}

const emptyResult = (): AnnounceResult => ({ sent: 0, gone: 0, failed: 0, limited: 0, updates: 0, unreached: 0 });

/** The shared loop: pages of the audience's devices, each page claimed under its locks, then sent. */
async function sendToAudience(
  config: PushConfig,
  a: {
    editorId: string;
    target: DeliveryTarget;
    audience: Audience;
    label: string;
    payloadFor: (count: number) => string;
    opts: { budgetMs?: number; now?: () => number };
  },
): Promise<AnnounceResult> {
  const result = emptyResult();
  const db = getDb();
  const options: webpush.RequestOptions = {
    vapidDetails: config,
    TTL: PUSH_TTL_SECONDS,
    urgency: "normal",
    topic: pushTopic(a.editorId),
    timeout: SEND_TIMEOUT_MS,
  };
  const now = a.opts.now ?? Date.now;
  const started = now();
  const budget = a.opts.budgetMs ?? SEND_BUDGET_MS;
  let after = "00000000-0000-0000-0000-000000000000";
  for (;;) {
    const page = (
      (await db.execute(sql`
        SELECT s.id FROM push_subscriptions s
        WHERE s.id > ${after} AND ${audienceWhere(a.audience, a.editorId)}
        ORDER BY s.id LIMIT ${CLAIM_BATCH}
      `)) as unknown as { rows: { id: string }[] }
    ).rows.map((r) => r.id);
    if (page.length === 0) break;
    after = page[page.length - 1];
    if (now() - started > budget) {
      result.unreached += page.length + (await countAfter(after, a.editorId, a.audience));
      console.error(`[push] ${a.label}: time budget spent, ${result.unreached} device(s) not reached`);
      break;
    }
    const claimed = await claimDeliveries(a.editorId, a.target, page);
    result.limited += page.length - claimed.length;
    result.updates += claimed.filter((c) => c.count > 1).length;
    await sendAll(claimed, a.payloadFor, options, result);
  }
  return result;
}

async function countAfter(id: string, editorId: string, audience: Audience): Promise<number> {
  const r = (await getDb().execute(sql`
    SELECT count(*)::int AS n FROM push_subscriptions s
    WHERE s.id > ${id} AND ${audienceWhere(audience, editorId)}
  `)) as unknown as { rows: { n: number }[] };
  return r.rows[0].n;
}

/**
 * Take a slot on each of these devices for this author's poem (or chapter), if the limits
 * allow, in one transaction: lock the subscription rows first (id order, so
 * concurrent announcements can't deadlock), then decide and insert in a
 * second statement. Under READ COMMITTED that statement takes a fresh
 * snapshot after the locks, so it sees deliveries a concurrent announcement
 * committed while we waited.
 *
 * Per device (Phase 18 round 2):
 * - no alert for this author in the last 12 hours: a new **alert**, if the
 *   device has had fewer than 3 alerts in 24 hours;
 * - otherwise a quiet **update** of that notification ("n new poems by …"),
 *   if fewer than UPDATES_PER_WINDOW updates followed that alert, and the
 *   device's push service replaces notifications (not Apple's);
 * - else nothing.
 * Returns the devices to send to, with the count to show.
 */
export async function claimDeliveries(editorId: string, target: string | DeliveryTarget, ids: string[]): Promise<Claimed[]> {
  if (ids.length === 0) return [];
  // A bare string is a poem id (the original signature).
  const t: DeliveryTarget = typeof target === "string" ? { poemId: target } : target;
  const poemId = "poemId" in t ? t.poemId : null;
  const chapterId = "chapterId" in t ? t.chapterId : null;
  const list = sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM push_subscriptions WHERE id IN (${list}) ORDER BY id FOR UPDATE`);
    const r = (await tx.execute(sql`
      WITH state AS (
        SELECT s.id, s.endpoint, s.p256dh, s.auth,
          (SELECT max(d.sent_at) FROM push_deliveries d
            WHERE d.subscription_id = s.id AND d.editor_id = ${editorId} AND d.kind = 'alert'
              AND d.sent_at > now() - make_interval(hours => ${PER_AUTHOR_WINDOW_HOURS})) AS alert_at,
          (SELECT count(*) FROM push_deliveries d
            WHERE d.subscription_id = s.id AND d.kind = 'alert'
              AND d.sent_at > now() - make_interval(hours => ${DEVICE_WINDOW_HOURS})) AS alerts_today
        FROM push_subscriptions s WHERE s.id IN (${list})
      ), decided AS (
        SELECT st.*,
          (SELECT count(*) FROM push_deliveries d
            WHERE d.subscription_id = st.id AND d.editor_id = ${editorId} AND d.kind = 'update'
              AND d.sent_at >= st.alert_at) AS updates
        FROM state st
      ), ok AS (
        SELECT id, endpoint, p256dh, auth,
          CASE WHEN alert_at IS NULL THEN 'alert' ELSE 'update' END AS kind,
          CASE WHEN alert_at IS NULL THEN 1 ELSE updates + 2 END AS count
        FROM decided
        WHERE (alert_at IS NULL AND alerts_today < ${DEVICE_DAILY_LIMIT})
           OR (alert_at IS NOT NULL AND updates < ${UPDATES_PER_WINDOW}
               AND split_part(split_part(endpoint, '://', 2), '/', 1) NOT LIKE '%push.apple.com')
      ), ins AS (
        INSERT INTO push_deliveries (subscription_id, editor_id, poem_id, chapter_id, kind)
        SELECT id, ${editorId}, ${poemId}::uuid, ${chapterId}::uuid, kind FROM ok
        RETURNING subscription_id
      )
      SELECT ok.id, ok.endpoint, ok.p256dh, ok.auth, ok.count::int AS count
      FROM ok JOIN ins ON ins.subscription_id = ok.id
    `)) as unknown as { rows: Claimed[] };
    return r.rows;
  });
}

async function sendAll(
  subs: Claimed[],
  payloadFor: (count: number) => string,
  options: webpush.RequestOptions,
  result: AnnounceResult,
) {
  const sent: string[] = [];
  const gone: string[] = [];
  const tried: string[] = [];
  let next = 0;
  async function worker() {
    while (next < subs.length) {
      const s = subs[next++];
      let status: number;
      try {
        if (pushOutbox) {
          // E2E only (never production): record what would be sent instead of reaching a push service.
          await appendFile(pushOutbox, JSON.stringify({ subscriptionId: s.id, payload: JSON.parse(payloadFor(s.count)) }) + "\n");
          sent.push(s.id);
          continue;
        }
        const res = await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payloadFor(s.count),
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
