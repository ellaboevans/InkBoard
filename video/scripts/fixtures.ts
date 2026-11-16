/**
 * Database fixtures for the video recordings. The only part of the video
 * tooling that imports app code: it uses the app's own functions (createPoem,
 * createSession, …) so slugs, revisions and hashes are real.
 *
 *   tsx --conditions=react-server video/scripts/fixtures.ts <command> [args]
 *
 * Commands print one JSON line on stdout. Called by video/lib/fixtures.ts with
 * the video database in DATABASE_URL; refuses any other database.
 */
import { spawnSync } from "node:child_process";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { collections, editors, emailOtps, poems, rateLimits, recoveryCodes, passkeys, sessions, signInDevices, signInLocations } from "@/db/schema";
import { createSession } from "@/server/auth/sessions";
import { slugify } from "@/lib/slug";
import { setPenName, updateProfile } from "@/server/auth/profile";
import { createPoem } from "@/server/poems";
import { createCollection, setPoemCollection } from "@/server/collections";
import { DEMO_AUTHORS, DEMO_PASSWORD, REHEARSAL, SEED_EXTRAS, WRITER, type DemoPoem } from "./demo-content";

const url = process.env.DATABASE_URL ?? "";
if (!/\/poemhub_video_[a-z0-9_]+$/.test(url)) {
  throw new Error(`Refusing to touch ${url}: the video fixtures only run on a poemhub_video_* database`);
}

const db = () => getDb();

async function editorByEmail(email: string) {
  const [row] = await db().select().from(editors).where(eq(editors.email, email));
  return row ?? null;
}

async function poem(editorId: string, p: DemoPoem, extra: Record<string, unknown> = {}) {
  const res = await createPoem(editorId, {
    title: p.title,
    body: p.body,
    language: p.language ?? "",
    visibility: p.private ? "private" : "public",
    status: "published",
    ...(p.private && { password: DEMO_PASSWORD }),
    ...extra,
  });
  if (!res.ok) throw new Error(`${p.title}: ${JSON.stringify(res.errors)}`);
  return res.poem;
}

async function collectionOf(editorId: string, c: { title: string; intro: string; poems: string[] }) {
  const res = await createCollection(editorId, { title: c.title, intro: c.intro });
  if (!res.ok) throw new Error(`${c.title}: ${JSON.stringify(res)}`);
  for (const title of c.poems) {
    const [p] = await db()
      .select({ id: poems.id })
      .from(poems)
      .where(and(eq(poems.editorId, editorId), eq(poems.title, title)));
    if (!p) throw new Error(`No poem "${title}"`);
    const placed = await setPoemCollection(editorId, p.id, res.collection.id);
    if (!placed.ok) throw new Error(`Could not add "${title}" to ${c.title}`);
  }
}

async function profile(
  editorId: string,
  penName: string,
  extra: { tagline?: string; bio?: string; avatar?: string; links?: string[]; pinned?: string },
) {
  let pinnedPoemId: string | null = null;
  if (extra.pinned) {
    const [p] = await db()
      .select({ id: poems.id })
      .from(poems)
      .where(and(eq(poems.editorId, editorId), eq(poems.title, extra.pinned)));
    pinnedPoemId = p.id;
  }
  const [current] = await db().select().from(editors).where(eq(editors.id, editorId));
  const res = await updateProfile(editorId, {
    penName,
    bio: extra.bio ?? current.bio ?? "",
    tagline: extra.tagline ?? current.tagline ?? "",
    avatar: extra.avatar ?? current.avatar,
    links: extra.links ?? current.links,
    pinnedPoemId,
  });
  if (!res.ok) throw new Error(`${penName}: ${res.error}`);
}

async function newEditor(email: string, penName: string) {
  // The video database is throwaway: if an earlier run deleted this demo
  // account, give its slug back so links in the videos stay the same.
  await db().execute(sql`DELETE FROM retired_slugs WHERE slug = ${slugify(penName, "author")}`);
  const [e] = await db()
    .insert(editors)
    .values({ email, welcomedAt: new Date() })
    .returning({ id: editors.id });
  const named = await setPenName(e.id, penName);
  if (!named.ok) throw new Error(named.error);
  return e.id;
}

/** Everything from scratch: empty database, `pnpm db:seed`, then the demo content. */
async function reset() {
  await db().execute(
    sql`TRUNCATE editors, email_otps, sessions, poems, rate_limits, retired_slugs, webauthn_challenges CASCADE`,
  );
  const seeded = spawnSync("pnpm", ["db:seed"], { env: { ...process.env, NODE_ENV: "development" }, encoding: "utf8" });
  if (seeded.status !== 0) throw new Error(`pnpm db:seed failed:\n${seeded.stdout}\n${seeded.stderr}`);

  for (const extra of SEED_EXTRAS) {
    const [e] = await db().select().from(editors).where(eq(editors.penName, extra.penName));
    if (!e) throw new Error(`Seed author ${extra.penName} not found`);
    if (extra.collection) await collectionOf(e.id, extra.collection);
    await profile(e.id, extra.penName, extra);
  }
  for (const author of DEMO_AUTHORS) {
    const id = await newEditor(author.email, author.penName);
    for (const p of author.poems) await poem(id, p);
    if (author.collection) await collectionOf(id, author.collection);
    await profile(id, author.penName, author);
  }
  return { ok: true };
}

/** Remove the writer (and the rehearsal editor) entirely, for the sign-up scene. */
async function writerNone() {
  const gone = await db()
    .delete(editors)
    .where(inArray(editors.email, [WRITER.email, REHEARSAL.email]))
    .returning({ id: editors.id });
  await db().delete(emailOtps).where(inArray(emailOtps.email, [WRITER.email, REHEARSAL.email]));
  await clearRateLimits();
  return { removed: gone.length };
}

/**
 * The writer as she is when the writing chapter starts: onboarded (keeping
 * the avatar chosen on camera, if the sign-up scene ran), with only her two
 * earlier poems, no collections, no recovery codes or passkeys, and no
 * sessions.
 */
async function writerReady() {
  let w = await editorByEmail(WRITER.email);
  const id = w ? w.id : await newEditor(WRITER.email, WRITER.penName);
  if (w && !w.penName) await setPenName(id, WRITER.penName);
  w = await editorByEmail(WRITER.email);
  await db().delete(poems).where(eq(poems.editorId, id));
  await db().delete(collections).where(eq(collections.editorId, id));
  await db().delete(recoveryCodes).where(eq(recoveryCodes.editorId, id));
  await db().delete(passkeys).where(eq(passkeys.editorId, id));
  await db().delete(sessions).where(eq(sessions.editorId, id));
  await db()
    .update(editors)
    .set({
      // No avatar yet (the default face): she picks one in the profile scene.
      avatar: null,
      bio: null,
      tagline: null,
      links: [],
      pinnedPoemId: null,
      passwordMode: "per_poem",
      sharedPasswordHash: null,
      recoveryPromptDismissedAt: null,
      welcomedAt: w?.welcomedAt ?? new Date(),
    })
    .where(eq(editors.id, id));
  for (const p of WRITER.poems) await poem(id, p);
  await clearRateLimits();
  return { editorId: id };
}

/** The Ewe poem from the writing scene, for scenes recorded on their own. */
export const NDI = {
  title: "Ŋdi",
  language: "ee" as const,
  body: "Ŋdi na wò, xɔ̃nye.\nDzidzɔ na wò.\n\n*Good morning to you, my friend.*\n*Joy to you.*",
};

async function writerNdi() {
  const w = await editorByEmail(WRITER.email);
  if (!w) throw new Error("No writer");
  const [p] = await db()
    .select({ id: poems.id })
    .from(poems)
    .where(and(eq(poems.editorId, w.id), eq(poems.title, NDI.title)));
  if (p) return { id: p.id };
  const made = await poem(w.id, NDI);
  return { id: made.id };
}

/** Before the security scenes: no recovery codes, passkeys, sessions or remembered devices. */
async function writerSecurity() {
  if (!(await editorByEmail(WRITER.email))) {
    // Recording a security scene on its own after "delete": bring her back as
    // she is after the profile scene (her poems, the avatar she picked there).
    const { editorId } = await writerReady();
    await writerNdi();
    await db().update(editors).set({ avatar: WRITER.avatarAfterProfile }).where(eq(editors.id, editorId));
  }
  const w = await editorByEmail(WRITER.email);
  if (!w) throw new Error("No writer");
  await db().delete(recoveryCodes).where(eq(recoveryCodes.editorId, w.id));
  await db().delete(passkeys).where(eq(passkeys.editorId, w.id));
  await db().delete(sessions).where(eq(sessions.editorId, w.id));
  await db().delete(signInDevices).where(eq(signInDevices.editorId, w.id));
  await db().delete(signInLocations).where(eq(signInLocations.editorId, w.id));
  await db().update(editors).set({ recoveryPromptDismissedAt: null }).where(eq(editors.id, w.id));
  await clearRateLimits();
  return { ok: true };
}

/** A signed-in session for an editor (as after an email sign-in: fresh for step-up). */
async function session(email: string, flags: string[]) {
  const e = await editorByEmail(email);
  if (!e) throw new Error(`No editor ${email}`);
  const { token } = await createSession(
    e.id,
    { userAgent: flags.includes("--phone") ? PHONE_UA : DESKTOP_UA, ip: "203.0.113.10" },
    { publicDevice: flags.includes("--public") },
  );
  return { token, editorId: e.id };
}

const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";
const PHONE_UA =
  "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36";

async function clearRateLimits() {
  await db().delete(rateLimits).where(like(rateLimits.key, "%"));
  return { ok: true };
}

/** Poem ids by title, for scenes that open an editor page directly. */
async function poemId(email: string, title: string) {
  const e = await editorByEmail(email);
  if (!e) throw new Error(`No editor ${email}`);
  const [p] = await db()
    .select({ id: poems.id })
    .from(poems)
    .where(and(eq(poems.editorId, e.id), eq(poems.title, title)));
  return { id: p?.id ?? null };
}

/**
 * The real email templates, filled in with what the outbox recorded, as HTML
 * files for the inbox scene. Links point at the live site, as in production.
 */
async function renderEmails(outboxFile: string, outDir: string) {
  const { readFileSync, writeFileSync, mkdirSync } = await import("node:fs");
  const t = await import("@/server/email-templates");
  const appUrl = "https://tryinkboard.elabo.me";
  const lines = readFileSync(outboxFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
  mkdirSync(outDir, { recursive: true });
  const out: { kind: string; subject: string; file: string }[] = [];
  const now = new Date();
  for (const [i, m] of lines.entries()) {
    if (m.to !== WRITER.email) continue;
    let msg: { subject: string; html: string } | null = null;
    const device = String(m.device ?? "Chrome on macOS");
    switch (m.kind) {
      case "recovery-codes-changed":
        msg = t.recoveryCodesChangedEmail({ appUrl, penName: WRITER.penName, device, firstSet: Boolean(m.firstSet), at: now } as never);
        break;
      case "recovery-used":
        msg = t.recoveryCodeUsedEmail({ appUrl, penName: WRITER.penName, device, remaining: Number(m.remaining), at: now } as never);
        break;
      case "passkey-added":
        msg = t.passkeyAddedEmail({ appUrl, penName: WRITER.penName, device, passkeyName: String(m.passkeyName), afterRecovery: Boolean(m.afterRecovery), at: now } as never);
        break;
      case "sign-in-alert":
        msg = t.signInAlertEmail({ appUrl, penName: WRITER.penName, device, ip: String(m.ip ?? ""), reason: m.reason, at: now } as never);
        break;
      default:
        continue;
    }
    const file = `${outDir}/${i}-${String(m.kind)}.html`;
    // The logo is an inline attachment in real emails; a browser needs it as data.
    const { EMAIL_LOGO_CID, EMAIL_LOGO_PNG_BASE64 } = await import("@/server/email-logo");
    writeFileSync(file, msg.html.replaceAll(`cid:${EMAIL_LOGO_CID}`, `data:image/png;base64,${EMAIL_LOGO_PNG_BASE64}`));
    out.push({ kind: String(m.kind), subject: msg.subject, file });
  }
  return { emails: out };
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const run: Record<string, () => Promise<unknown>> = {
    reset,
    "writer:none": writerNone,
    "writer:ready": writerReady,
    session: () => session(args[0], args.slice(1)),
    "rate-limits:clear": clearRateLimits,
    "writer:ndi": writerNdi,
    "writer:security": writerSecurity,
    "rehearsal:ready": async () => {
      const e = await editorByEmail(REHEARSAL.email);
      return { editorId: e ? e.id : await newEditor(REHEARSAL.email, REHEARSAL.penName) };
    },
    emails: () => renderEmails(args[0], args[1]),
    "poem-id": () => poemId(args[0], args[1]),
  };
  if (!run[command]) throw new Error(`Unknown fixture command "${command}"`);
  const result = await run[command]();
  process.stdout.write(`\n@@RESULT ${JSON.stringify(result)}\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
