/**
 * Demo data for the launch reel, on top of `pnpm db:seed` and seed-novels.ts.
 * Uses the app's own functions so slugs, hashes and sessions are real.
 * Never sends email: sessions are created directly (as the video fixtures do).
 *
 *   DATABASE_URL=…/poemhub_dev_elm_reel pnpm exec tsx --conditions=react-server \
 *     reels-studio/scripts/reel-fixtures.ts <setup|sessions>
 *
 * Refuses any database but poemhub_dev_elm_reel (the Reel) and poemhub_dev_elm_wn (What's new).
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });

import { and, eq, inArray, like, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { chapters, editors, novels, poems, pushFollows, pushSubscriptions, rateLimits, shortLinks } from "@/db/schema";
import { createSession } from "@/server/auth/sessions";
import { setPenName, updateProfile } from "@/server/auth/profile";
import { createPoem } from "@/server/poems";
import { ensureChapterShortCode, ensureShortCode } from "@/server/short-links";
import { DEMO_AUTHORS, SEED_EXTRAS } from "../../video/scripts/demo-content";

const url = process.env.DATABASE_URL ?? "";
if (!/\/poemhub_dev_elm_(reel|wn)$/.test(url)) throw new Error(`Refusing ${url}: reel fixtures run only on poemhub_dev_elm_reel or poemhub_dev_elm_wn`);

const db = () => getDb();
const PHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

export const WRITER = { email: "abla.dzifa@example.com", penName: "Abla Dzifa", avatar: "a21" };

/** Ewe, with its tone marks: "Good morning to you, my friend. Joy to you." */
const NDI = {
  title: "Ŋdi",
  language: "ee",
  body: "Ŋdi na wò, xɔ̃nye.\nDzidzɔ na wò.\n\n*Good morning to you, my friend.*\n*Joy to you.*",
};

async function editorByEmail(email: string) {
  const [row] = await db().select().from(editors).where(eq(editors.email, email));
  return row ?? null;
}
async function editorBySlug(slug: string) {
  const [row] = await db().select().from(editors).where(eq(editors.slug, slug));
  if (!row) throw new Error(`No editor ${slug}`);
  return row;
}

async function newEditor(email: string, penName: string) {
  const existing = await editorByEmail(email);
  if (existing) return existing.id;
  const [e] = await db().insert(editors).values({ email, welcomedAt: new Date() }).returning({ id: editors.id });
  const named = await setPenName(e.id, penName);
  if (!named.ok) throw new Error(named.error);
  return e.id;
}

async function poem(editorId: string, p: { title: string; body: string; language?: string }) {
  const [have] = await db().select({ id: poems.id }).from(poems).where(and(eq(poems.editorId, editorId), eq(poems.title, p.title)));
  if (have) return have.id;
  const res = await createPoem(editorId, {
    title: p.title,
    body: p.body,
    language: p.language ?? "",
    visibility: "public",
    status: "published",
  } as never);
  if (!res.ok) throw new Error(`${p.title}: ${JSON.stringify(res)}`);
  return res.poem.id;
}

async function profile(editorId: string, extra: { tagline?: string; bio?: string; avatar?: string; links?: string[] }) {
  const [current] = await db().select().from(editors).where(eq(editors.id, editorId));
  const res = await updateProfile(editorId, {
    penName: current.penName!,
    bio: extra.bio ?? current.bio ?? "",
    tagline: extra.tagline ?? current.tagline ?? "",
    avatar: extra.avatar ?? current.avatar,
    links: extra.links ?? current.links,
    pinnedPoemId: current.pinnedPoemId,
  } as never);
  if (!res.ok) throw new Error(`${current.penName}: ${JSON.stringify(res)}`);
}

async function setup() {
  for (const extra of SEED_EXTRAS) {
    const [e] = await db().select().from(editors).where(eq(editors.penName, extra.penName));
    if (e) await profile(e.id, extra);
  }
  for (const author of DEMO_AUTHORS) {
    const id = await newEditor(author.email, author.penName);
    for (const p of author.poems) await poem(id, p);
    await profile(id, author);
  }
  // The hook's card: an Ewe poem with its tone marks, by the Ewe author.
  const selorm = await editorByEmail("selorm.agbo@example.com");
  await poem(selorm!.id, NDI);

  // The writer seen in the editor: onboarded, two earlier poems.
  const writer = await newEditor(WRITER.email, WRITER.penName);
  await profile(writer, { avatar: WRITER.avatar, tagline: "Greetings, in three languages" });
  await poem(writer, { title: "Harmattan", language: "en", body: "the dry wind\nwrites on every window\nin a dust only the sun can read" });

  // Stats for Odalys Moon (followers, short-link visits): data the app already keeps.
  const odalys = await editorBySlug("odalys-moon");
  await db().delete(pushSubscriptions).where(like(pushSubscriptions.endpoint, "https://fcm.googleapis.com/fcm/send/reel-%"));
  const subs = await db()
    .insert(pushSubscriptions)
    .values(Array.from({ length: 128 }, (_, i) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/reel-${i}`, p256dh: "x", auth: "x", mode: "followed" })))
    .returning({ id: pushSubscriptions.id });
  await db().insert(pushFollows).values(subs.map((s) => ({ subscriptionId: s.id, editorId: odalys.id })));

  const visits: Record<string, number> = { Lantern: 412, Snowmelt: 236, "Rain on the Tin Roof": 158, Kettle: 97, Moth: 41 };
  for (const [title, n] of Object.entries(visits)) {
    const [p] = await db().select({ id: poems.id }).from(poems).where(and(eq(poems.editorId, odalys.id), eq(poems.title, title)));
    if (!p) continue;
    await ensureShortCode(p.id);
    await db().update(shortLinks).set({ visits: n }).where(eq(shortLinks.poemId, p.id));
  }
  const ferryChapters = await db()
    .select({ id: chapters.id, position: chapters.position })
    .from(chapters)
    .innerJoin(novels, eq(novels.id, chapters.novelId))
    .where(and(eq(novels.editorId, odalys.id), eq(chapters.status, "published")));
  const chapterVisits = [684, 351, 220, 129];
  for (const c of ferryChapters.sort((a, b) => a.position - b.position)) {
    await ensureChapterShortCode(c.id);
    await db().update(shortLinks).set({ visits: chapterVisits[c.position - 1] ?? 60 }).where(eq(shortLinks.chapterId, c.id));
  }
  await db().delete(rateLimits).where(like(rateLimits.key, "%"));
  return { ok: true };
}

/** Fresh sessions (as after an email sign-in, so step-up is fresh too). */
async function sessions() {
  const out: Record<string, string> = {};
  for (const email of [WRITER.email]) {
    const e = await editorByEmail(email);
    out.writer = (await createSession(e!.id, { userAgent: PHONE_UA, ip: "203.0.113.10" }, {} as never)).token;
  }
  const odalys = await editorBySlug("odalys-moon");
  out.odalys = (await createSession(odalys.id, { userAgent: PHONE_UA, ip: "203.0.113.11" }, {} as never)).token;
  await db().delete(rateLimits).where(like(rateLimits.key, "%"));
  return out;
}

/** Remove the poem the writer publishes on camera, so the take can be re-run. */
async function resetTake() {
  const w = await editorByEmail(WRITER.email);
  if (!w) return { ok: false };
  await db().delete(poems).where(and(eq(poems.editorId, w.id), inArray(poems.title, ["Akwaaba"])));
  await db().execute(sql`DELETE FROM rate_limits`);
  return { ok: true };
}

const run: Record<string, () => Promise<unknown>> = { setup, sessions, "reset-take": resetTake };
const cmd = process.argv[2];
if (!run[cmd]) throw new Error(`Unknown command ${cmd}`);
run[cmd]()
  .then((r) => {
    process.stdout.write(`\n@@RESULT ${JSON.stringify(r)}\n`);
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
