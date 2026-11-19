/**
 * Demo data for the "What's new in InkBoard" walkthrough, on top of
 * `pnpm db:seed`, seed-novels.ts and `reel-fixtures.ts setup`. Uses the app's
 * own functions, so slugs, hashes and sessions are real. Never sends email.
 *
 *   DATABASE_URL=…/poemhub_dev_elm_wn pnpm exec tsx --conditions=react-server \
 *     reels-studio/scripts/whatsnew-fixtures.ts <setup|assets|sessions|chapters|reset-writer>
 *
 * - setup     the writer's published "Akwaaba" (shared as an image on camera)
 * - assets    tmp/assets/: an abstract picture for the profile photo and a cover
 *             (shapes only: never a photo of a person)
 * - sessions  fixture sessions (desktop) for the writer and Odalys Moon → tmp/sessions-wn.json
 * - chapters  two draft chapters in the writer's new novel, for the chapter-order scene
 * - reset-writer  remove what the takes create (novel, photo) so they can be re-run
 *
 * Refuses any database but poemhub_dev_elm_wn.
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });

import { mkdirSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { and, eq, like } from "drizzle-orm";
import { getDb } from "@/db";
import { editors, novels, poems, rateLimits } from "@/db/schema";
import { createSession } from "@/server/auth/sessions";
import { createChapter, deleteNovel } from "@/server/novels";
import { createPoem } from "@/server/poems";

const url = process.env.DATABASE_URL ?? "";
if (!/\/poemhub_dev_elm_wn$/.test(url)) throw new Error(`Refusing ${url}: these fixtures run only on poemhub_dev_elm_wn`);

const db = () => getDb();
const TMP = new URL("../tmp/", import.meta.url).pathname;
const WRITER_EMAIL = "abla.dzifa@example.com";
const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";

async function editorByEmail(email: string) {
  const [row] = await db().select().from(editors).where(eq(editors.email, email));
  if (!row) throw new Error(`No editor ${email} (run reel-fixtures.ts setup first)`);
  return row;
}

/** Twi and Ga greetings, with English glosses (as in the launch Reel). */
const AKWAABA = { title: "Akwaaba", body: "Ɛte sɛn?\nOyiwala dɔŋŋ.\n\n*How are you?*\n*Thank you, so much.*" };

async function setup() {
  const w = await editorByEmail(WRITER_EMAIL);
  const [have] = await db().select({ id: poems.id }).from(poems).where(and(eq(poems.editorId, w.id), eq(poems.title, AKWAABA.title)));
  if (!have) {
    const res = await createPoem(w.id, { ...AKWAABA, language: "", visibility: "public", status: "published" } as never);
    if (!res.ok) throw new Error(JSON.stringify(res));
  }
  await db().delete(rateLimits).where(like(rateLimits.key, "%"));
  return { ok: true };
}

async function assets() {
  mkdirSync(`${TMP}assets`, { recursive: true });
  // An abstract "portrait" tile: overlapping suns and a woven band. No people.
  const photo = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200">
  <rect width="1200" height="1200" fill="#e7b75f"/>
  <circle cx="600" cy="520" r="330" fill="#852e2c"/>
  <circle cx="600" cy="520" r="230" fill="#f4dfb4"/>
  <circle cx="600" cy="520" r="120" fill="#2f5d50"/>
  <g>
    ${Array.from({ length: 12 }, (_, i) => `<rect x="${i * 100}" y="930" width="100" height="270" fill="${["#2f5d50", "#e7b75f", "#852e2c", "#261d17"][i % 4]}"/>`).join("")}
    ${Array.from({ length: 24 }, (_, i) => `<rect x="${i * 50 + 10}" y="1010" width="30" height="30" fill="#fdfaf4" opacity="0.85"/>`).join("")}
  </g>
  <path d="M0 930 Q300 860 600 930 T1200 930 V960 H0Z" fill="#261d17" opacity="0.25"/>
</svg>`;
  await sharp(Buffer.from(photo)).jpeg({ quality: 90 }).toFile(`${TMP}assets/abstract-photo.jpg`);
  // A cover: a dusty sun over layered hills and rooftops, with the title.
  const cover = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1500">
  <rect width="1000" height="1500" fill="#ead3ad"/>
  <circle cx="640" cy="470" r="190" fill="#f7e9cc"/>
  <circle cx="640" cy="470" r="250" fill="none" stroke="#f7e9cc" stroke-width="6" opacity="0.6"/>
  <path d="M0 860 Q250 780 500 840 T1000 820 V1500 H0Z" fill="#c9965a"/>
  <path d="M0 960 Q260 900 520 950 T1000 930 V1500 H0Z" fill="#a8693b"/>
  <g fill="#5a3522">
    <rect x="90" y="905" width="120" height="80"/><polygon points="80,910 150,860 220,910"/>
    <rect x="260" y="925" width="90" height="70"/><polygon points="250,930 305,890 360,930"/>
    <rect x="720" y="890" width="140" height="90"/><polygon points="710,895 790,840 870,895"/>
  </g>
  <rect y="1040" width="1000" height="460" fill="#7a3b28"/>
  <text x="80" y="1250" font-family="Georgia, serif" font-size="92" fill="#fdf3e2">Harmattan</text>
  <text x="80" y="1355" font-family="Georgia, serif" font-size="92" fill="#fdf3e2">Mornings</text>
  <text x="84" y="1430" font-family="Georgia, serif" font-size="34" fill="#f2c98f" letter-spacing="4">ABLA DZIFA</text>
</svg>`;
  await sharp(Buffer.from(cover)).jpeg({ quality: 90 }).toFile(`${TMP}assets/harmattan-cover.jpg`);
  return { photo: `${TMP}assets/abstract-photo.jpg`, cover: `${TMP}assets/harmattan-cover.jpg` };
}

async function sessions() {
  const out: Record<string, string> = {};
  const w = await editorByEmail(WRITER_EMAIL);
  out.writer = (await createSession(w.id, { userAgent: DESKTOP_UA, ip: "203.0.113.20" })).token;
  const [o] = await db().select().from(editors).where(eq(editors.slug, "odalys-moon"));
  out.odalys = (await createSession(o.id, { userAgent: DESKTOP_UA, ip: "203.0.113.21" })).token;
  writeFileSync(`${TMP}sessions-wn.json`, JSON.stringify(out));
  await db().delete(rateLimits).where(like(rateLimits.key, "%"));
  return { ok: true, file: `${TMP}sessions-wn.json` };
}

/** Two drafts after the chapter written on camera, so the order has something to move. */
async function draftChapters() {
  const w = await editorByEmail(WRITER_EMAIL);
  const [n] = await db().select({ id: novels.id }).from(novels).where(and(eq(novels.editorId, w.id), eq(novels.slug, "harmattan-mornings")));
  if (!n) throw new Error("No novel harmattan-mornings yet (create it on camera first)");
  for (const c of [
    { title: "The Well", body: "^^Water came up cold and tasting of stone. Esi drank first, because she had carried the bucket, and nobody argued." },
    { title: "Market Road", body: "^^By nine the road to the market was a river of headloads, and every one of them was talking." },
  ]) {
    const r = await createChapter(w.id, n.id, { ...c, status: "draft" });
    if (!r.ok) throw new Error(JSON.stringify(r));
  }
  return { ok: true };
}

async function resetWriter() {
  const w = await editorByEmail(WRITER_EMAIL);
  for (const n of await db().select({ id: novels.id }).from(novels).where(eq(novels.editorId, w.id))) await deleteNovel(w.id, n.id);
  await db().update(editors).set({ photoKey: null }).where(eq(editors.id, w.id));
  await db().delete(rateLimits).where(like(rateLimits.key, "%"));
  return { ok: true };
}

const run: Record<string, () => Promise<unknown>> = { setup, assets, sessions, chapters: draftChapters, "reset-writer": resetWriter };
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
