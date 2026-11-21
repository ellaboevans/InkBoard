import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db";
import { chapters, editors, novels, poems, rateLimits, reports } from "@/db/schema";
import {
  parseReportTarget,
  REPORT_EMAILS_PER_DAY,
  REPORTS_PER_NETWORK_PER_HOUR,
  validateReport,
  type ReportTarget,
} from "@/lib/report";
import { cleanupExpiredRows, CLEANUP_DAYS } from "@/server/maintenance";
import { recentReports, submitReport } from "@/server/reports";
import { reportEmail } from "@/server/email-templates";
import { withRelease } from "../support/chapters";
import { reportNotices } from "../support/outbox";
import type { ReportNotice } from "@/server/reports";

// The action reads the client IP from the request; give it one.
vi.mock("@/server/auth/dal", () => ({ getRequestMeta: async () => ({ ip: "192.0.2.50", userAgent: "Firefox" }) }));

/* Readers' reports (docs/PLAN.md, Phase 32 round 1). */

const db = getDb();
const IP = "198.51.100.7";
let ama: string;
let poemId: string;
let novelId: string;
let chapterId: string;

beforeEach(async () => {
  const [a] = await db
    .insert(editors)
    .values([
      { email: "ama@example.com", penName: "Ama Sɛwaa", slug: "ama" },
      { email: "new@example.com", slug: null, penName: null },
    ])
    .returning();
  ama = a.id;
  const [p] = await db
    .insert(poems)
    .values([
      { editorId: ama, title: "Harmattan", slug: "harmattan", body: "Dust on the sill.", visibility: "public", status: "published", publishedAt: new Date() },
      { editorId: ama, title: "Hidden", slug: "hidden", body: "Secret lines.", visibility: "private", passwordHash: "scrypt$x", status: "published", publishedAt: new Date() },
      { editorId: ama, title: "Draft", slug: "draft", body: "Not yet.", visibility: "public", status: "draft" },
    ])
    .returning();
  poemId = p.id;
  const [n] = await db.insert(novels).values({ editorId: ama, title: "The Ferry", slug: "the-ferry" }).returning();
  novelId = n.id;
  const [c] = await db
    .insert(chapters)
    .values(
      withRelease([
        { novelId, title: "Landing", slug: "landing", body: "It began.", position: 1, status: "published" as const, publishedAt: new Date() },
        { novelId, title: "Draft ch", slug: "draft-ch", body: "x.", position: 2, status: "draft" as const },
      ]),
    )
    .returning();
  chapterId = c.id;
  // A scheduled chapter: published, released tomorrow.
  await db.insert(chapters).values({
    novelId, title: "Soon", slug: "soon", body: "Later.", position: 3, status: "published",
    publishedAt: sql`now() + interval '1 day'`, releaseAt: sql`now() + interval '1 day'`,
  });
  // A draft-only novel.
  const [d] = await db.insert(novels).values({ editorId: ama, title: "Notes", slug: "notes" }).returning();
  await db.insert(chapters).values(withRelease({ novelId: d.id, title: "x", slug: "x", body: "x.", position: 1, status: "draft" }));
});

/** The notices the action would email (submitReport returns them; the action sends them in after()). */
let notices: ReportNotice[] = [];
beforeEach(() => {
  notices = [];
});
const send = async (target: ReportTarget, over: Partial<{ reason: unknown; details: unknown; email: unknown; ip: string | null }> = {}) => {
  const res = await submitReport({ target, reason: "spam", details: "", email: "", ip: IP, ...over });
  if (res.ok && res.notice) notices.push(res.notice);
  return res;
};

const poem: ReportTarget = { kind: "poem", author: "ama", poem: "harmattan" };

describe("reporting", () => {
  it("takes a report of each kind, stores it and emails the owner", async () => {
    const targets: [ReportTarget, string, string][] = [
      [poem, "poemId", "Harmattan"],
      [{ kind: "poem", author: "ama", poem: "hidden" }, "poemId", "Hidden"],
      [{ kind: "novel", author: "ama", novel: "the-ferry" }, "novelId", "The Ferry"],
      [{ kind: "chapter", author: "ama", novel: "the-ferry", chapter: "landing" }, "chapterId", "The Ferry, Landing"],
      [{ kind: "author", author: "ama" }, "editorId", "Ama Sɛwaa"],
    ];
    for (const [i, [t, column, title]] of targets.entries()) {
      // A different network each, so the hourly limit doesn't interfere.
      expect(await send(t, { ip: `203.0.113.${i + 1}` })).toMatchObject({ ok: true, notice: { target: { kind: t.kind, title, penName: "Ama Sɛwaa" } } });
      const [row] = await db.select().from(reports).orderBy(sql`created_at DESC`).limit(1);
      expect(row).toMatchObject({ [column]: expect.any(String), reason: "spam", details: null });
    }
    expect(notices.map((n) => n.target.path)).toEqual([
      "/p/ama/harmattan",
      "/p/ama/hidden",
      "/a/ama/n/the-ferry",
      "/a/ama/n/the-ferry/landing",
      "/a/ama",
    ]);
  });

  it("never carries a private poem's text", async () => {
    await send({ kind: "poem", author: "ama", poem: "hidden" });
    expect(JSON.stringify(notices)).not.toContain("Secret lines");
    expect(JSON.stringify(notices)).not.toContain("Dust on the sill");
  });

  it("refuses what a reader can't see: drafts, scheduled chapters, draft-only novels, missing pages, authors without a pen name", async () => {
    const hidden: ReportTarget[] = [
      { kind: "poem", author: "ama", poem: "draft" },
      { kind: "poem", author: "ama", poem: "nope" },
      { kind: "poem", author: "nobody", poem: "harmattan" },
      { kind: "chapter", author: "ama", novel: "the-ferry", chapter: "draft-ch" },
      { kind: "chapter", author: "ama", novel: "the-ferry", chapter: "soon" },
      { kind: "novel", author: "ama", novel: "notes" },
      { kind: "novel", author: "ama", novel: "missing" },
      { kind: "author", author: "nobody" },
    ];
    for (const t of hidden) expect(await send(t), JSON.stringify(t)).toEqual({ ok: false, error: "unavailable" });
    expect(await db.select().from(reports)).toEqual([]);
    expect(notices).toEqual([]);
    // Nothing counted against the network either.
    expect(await db.select().from(rateLimits)).toEqual([]);
  });

  it("checks the form: a reason, details for 'Something else', at most 1,000 characters, a plausible email", async () => {
    expect(await send(poem, { reason: "bogus" })).toMatchObject({ ok: false, error: "invalid", errors: { reason: expect.any(String) } });
    expect(await send(poem, { reason: "other", details: "   " })).toMatchObject({ errors: { details: expect.any(String) } });
    expect(await send(poem, { details: "x".repeat(1001) })).toMatchObject({ errors: { details: expect.any(String) } });
    expect(await send(poem, { email: "not an email" })).toMatchObject({ errors: { email: expect.any(String) } });
    expect(validateReport({ reason: "spam", details: "é".repeat(1000), email: "" }).ok).toBe(true);
    expect(await send(poem, { reason: "other", details: "Copied from my blog." })).toMatchObject({ ok: true });
  });

  it("parses only well-formed targets from the client", () => {
    expect(parseReportTarget({ kind: "poem", author: "a", poem: "b" })).toEqual({ kind: "poem", author: "a", poem: "b" });
    expect(parseReportTarget({ kind: "poem", author: "a" })).toBeNull();
    expect(parseReportTarget({ kind: "collection", author: "a", collection: "b" })).toBeNull();
    expect(parseReportTarget("poem")).toBeNull();
    expect(parseReportTarget({ kind: "author", author: "x".repeat(201) })).toBeNull();
  });
});

describe("limits", () => {
  it("the same page once per network a day: a repeat gets the same answer, stores and sends nothing", async () => {
    const first = await send(poem);
    const again = await send(poem, { reason: "harassment" });
    expect(first.ok && again.ok).toBe(true);
    expect(again).toEqual({ ok: true, notice: null });
    expect(await db.select().from(reports)).toHaveLength(1);
    expect(notices).toHaveLength(1);
    // Another network can still report it (and the email counts the earlier one).
    expect(await send(poem, { ip: "203.0.113.9" })).toMatchObject({ ok: true, notice: { earlier: 1 } });
    // IPv6: the same /64 is one network.
    await send(poem, { ip: "2001:db8:1:2::1" });
    expect(await send(poem, { ip: "2001:db8:1:2::ffff" })).toEqual({ ok: true, notice: null });
  });

  it(`${REPORTS_PER_NETWORK_PER_HOUR} reports an hour per network, then the same thank-you with nothing stored`, async () => {
    const pages: ReportTarget[] = [
      poem,
      { kind: "poem", author: "ama", poem: "hidden" },
      { kind: "novel", author: "ama", novel: "the-ferry" },
      { kind: "chapter", author: "ama", novel: "the-ferry", chapter: "landing" },
      { kind: "author", author: "ama" },
    ];
    for (const t of pages) expect(await send(t)).toMatchObject({ ok: true, notice: expect.any(Object) });
    // A sixth, on a page this network hasn't reported yet.
    await db.delete(rateLimits).where(sql`${rateLimits.key} LIKE 'report:page:%'`);
    expect(await send(poem)).toEqual({ ok: true, notice: null });
    expect(await db.select().from(reports)).toHaveLength(5);
    expect((await db.select().from(rateLimits)).map((r) => r.key)).toContain(`report:ip:${IP}`);
  });

  it(`at most ${REPORT_EMAILS_PER_DAY} emails a day for everyone: past it reports are stored, not emailed`, async () => {
    await db.insert(rateLimits).values({ key: "report:email:day", windowStart: new Date(), count: REPORT_EMAILS_PER_DAY });
    expect(await send(poem)).toEqual({ ok: true, notice: null });
    expect(await db.select().from(reports)).toHaveLength(1);
    expect(notices).toEqual([]);
  });
});

describe("what's stored", () => {
  it("never the reply email, IP or user agent: the table has no column for them, and no value holds them", async () => {
    await send(poem, { email: "reader@example.org", details: "Please look." });
    expect(notices[0].replyTo).toBe("reader@example.org");
    const cols = (await db.execute(sql`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'reports' ORDER BY column_name
    `)) as unknown as { rows: { column_name: string }[] };
    expect(cols.rows.map((r) => r.column_name)).toEqual(
      ["chapter_id", "created_at", "details", "editor_id", "id", "novel_id", "poem_id", "reason"],
    );
    const dump = JSON.stringify(await db.select().from(reports));
    expect(dump).not.toContain("reader@example.org");
    expect(dump).not.toContain(IP);
    // The rate-limit keys hold the network's bucket, never the email.
    expect(JSON.stringify(await db.select().from(rateLimits))).not.toContain("reader@example.org");
  });

  it("exactly one target, enforced by the database", async () => {
    await expect(db.insert(reports).values({ reason: "spam" })).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(db.insert(reports).values({ reason: "spam", poemId, editorId: ama })).rejects.toMatchObject({ cause: { code: "23514" } });
  });

  it(`is deleted by the daily cleanup after ${CLEANUP_DAYS.reports} days`, async () => {
    await db.insert(reports).values([
      { poemId, reason: "spam", createdAt: sql`now() - make_interval(days => ${CLEANUP_DAYS.reports + 1})` },
      { poemId, reason: "copied", createdAt: sql`now() - make_interval(days => ${CLEANUP_DAYS.reports - 1})` },
    ]);
    expect(await cleanupExpiredRows()).toMatchObject({ reports: 1 });
    expect((await db.select().from(reports)).map((r) => r.reason)).toEqual(["copied"]);
  });

  it("goes with its poem, novel, chapter or author", async () => {
    await db.insert(reports).values([
      { poemId, reason: "spam" },
      { novelId, reason: "spam" },
      { chapterId, reason: "spam" },
      { editorId: ama, reason: "spam" },
    ]);
    await db.delete(chapters).where(eq(chapters.id, chapterId));
    expect(await db.select().from(reports)).toHaveLength(3);
    await db.delete(poems).where(eq(poems.id, poemId));
    expect(await db.select().from(reports)).toHaveLength(2);
    await db.delete(editors).where(eq(editors.id, ama));
    expect(await db.select().from(reports)).toEqual([]);
  });

  it("pnpm reports lists the last 30 days, newest first, with their pages", async () => {
    await db.insert(reports).values([
      { poemId, reason: "spam", createdAt: sql`now() - interval '2 days'` },
      { chapterId, reason: "other", details: "Hm", createdAt: sql`now() - interval '1 day'` },
      { editorId: ama, reason: "copied", createdAt: sql`now() - interval '40 days'` },
    ]);
    const rows = await recentReports();
    expect(rows.map((r) => [r.kind, r.title, r.path])).toEqual([
      ["chapter", "The Ferry, Landing", "/a/ama/n/the-ferry/landing"],
      ["poem", "Harmattan", "/p/ama/harmattan"],
    ]);
  });
});

describe("the action", () => {
  it("emails the owner after the response, and answers a repeat the same way", async () => {
    const { reportAction } = await import("@/components/report/report-actions");
    const form = (o: Record<string, string>) => {
      const f = new FormData();
      for (const [k, v] of Object.entries(o)) f.set(k, v);
      return f;
    };
    expect(await reportAction(poem, {}, form({ reason: "copied", details: "Mine.", email: "reader@example.org" }))).toEqual({ sent: true });
    expect(await reportAction(poem, {}, form({ reason: "copied" }))).toEqual({ sent: true });
    await vi.waitFor(() => expect(reportNotices).toHaveLength(1));
    expect(reportNotices[0]).toMatchObject({ reason: "copied", details: "Mine.", replyTo: "reader@example.org", earlier: 0 });
    expect(await reportAction({ kind: "poem", author: "ama", poem: "draft" }, {}, form({ reason: "spam" }))).toEqual({
      error: "This page isn't available.",
    });
    expect(await reportAction({ kind: "nope" }, {}, form({ reason: "spam" }))).toEqual({ error: "This page isn't available." });
    expect(await reportAction(poem, {}, form({ reason: "other" }))).toMatchObject({ errors: { details: expect.any(String) } });
  });
});

describe("the owner's email", () => {
  const base = {
    kind: "poem" as const,
    title: "Harmattan",
    penName: "Ama Sɛwaa",
    link: "https://inkboard.example/p/ama/harmattan",
    reason: "Spam or advertising",
    details: null,
    at: new Date("2026-11-21T10:30:00Z"),
    earlier: 0,
    appUrl: "https://inkboard.example",
  };

  it("names the page, reason, time and earlier reports, never the text", () => {
    const m = reportEmail({ ...base, earlier: 2 });
    expect(m.subject).toBe("Report: poem “Harmattan” by Ama Sɛwaa");
    for (const part of [m.text, m.html]) {
      expect(part).toContain("https://inkboard.example/p/ama/harmattan");
      expect(part).toContain("Spam or advertising");
      expect(part).toContain("Sat 21 Nov, 10:30 UTC");
      expect(part).toContain("2 earlier reports of this page");
    }
    expect(m.text).toContain("(none given)");
  });

  it("escapes the reader's details and the title in HTML", () => {
    const m = reportEmail({ ...base, title: `<b>"x"</b>`, details: `<script>alert(1)</script>\n& more` });
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("&#60;script&#62;alert(1)&#60;/script&#62;");
    expect(m.html).not.toContain(`<b>"x"</b>`);
    expect(m.text).toContain("<script>alert(1)</script>");
  });

  it("an author report names the author once", () => {
    const m = reportEmail({ ...base, kind: "author", title: "Ama Sɛwaa", link: "https://inkboard.example/a/ama" });
    expect(m.subject).toBe("Report: author Ama Sɛwaa");
    expect(m.text).not.toContain("By:");
  });
});
