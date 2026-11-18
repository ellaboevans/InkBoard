import { HtmlRenderer, Parser } from "commonmark";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { editors, passkeys, poems, recoveryCodes, sessions, shortLinks } from "@/db/schema";
import { countShareVisit, ensureShortCode } from "@/server/short-links";
import {
  EXPORT_CONTENT_TYPES,
  exportFileName,
  exportToJson,
  exportToMarkdown,
  poemTextToMarkdown,
  type EditorExport,
} from "@/lib/export-format";
import { generateRecoveryCodes } from "@/server/auth/recovery-codes";
import { createSession, validateSession } from "@/server/auth/sessions";
import { createCollection, setPoemCollection } from "@/server/collections";
import { EXPORTS_PER_HOUR, allowExport, loadEditorExport } from "@/server/export";
import { setSharedPassword } from "@/server/password-settings";
import { createPoem, updatePoem } from "@/server/poems";

const db = getDb();
const SITE = "https://inkboard.test";
const NOW = new Date("2026-11-15T12:00:00Z");

// Ghanaian letters, IPA and Ewe tone marks. ɛ́ and ɔ̀ have no precomposed form,
// so they stay letter + combining mark even in NFC.
const GHANAIAN = "Ɛ ɛ Ɔ ɔ Ŋ ŋ Ɖ ɖ Ƒ ƒ Ɣ ɣ Ʋ ʋ Ʒ ʒ · ɛ́ ɔ̀ è ŋ́ · [ʃ ʒ ɲ ɥ ə]";

async function editor(email: string, penName: string, extra: Partial<typeof editors.$inferInsert> = {}) {
  const [row] = await db
    .insert(editors)
    .values({ email, penName, slug: penName.toLowerCase().replace(/\s+/g, "-"), ...extra })
    .returning();
  return row;
}

async function poem(editorId: string, over: Record<string, unknown>) {
  const res = await createPoem(editorId, { title: "Poem", body: "a line", visibility: "public", status: "published", ...over });
  if (!res.ok) throw new Error(JSON.stringify(res.errors));
  return res.poem.id;
}

/** Ada: a public Ewe poem (with an earlier version), a private one, a draft, a collection; plus secrets of every kind. */
async function ada() {
  const ed = await editor("ada@example.com", "Ada Verse", {
    tagline: "Small poems about rivers",
    bio: `Writes in English and Ewe.\n${GHANAIAN}`,
    links: ["https://ada.example/"],
  });
  const ewe = await poem(ed.id, { title: "Ŋkɔ", body: "first draft", language: "ee" });
  const ewePoem = await db.select().from(poems).where(eq(poems.id, ewe));
  const upd = await updatePoem(ed.id, ewe, {
    title: "Ŋkɔ",
    body: `ɖeka\n  ${GHANAIAN}\n\n*ɛ́yae* **ɔ̀**`,
    language: "ee",
    visibility: "public",
    status: "published",
  });
  if (!upd.ok) throw new Error(JSON.stringify(upd));
  const secret = await poem(ed.id, { title: "Locked room", body: "only for friends", visibility: "private", password: "poem-pass-123" });
  const draft = await poem(ed.id, { title: "Unfinished", body: "half a line", status: "draft" });
  const col = await createCollection(ed.id, { title: "Coastline", intro: "Poems from the shore." });
  if (!col.ok) throw new Error();
  await setPoemCollection(ed.id, ewe, col.collection.id);
  await setPoemCollection(ed.id, draft, col.collection.id);
  await db.update(editors).set({ pinnedPoemId: ewe }).where(eq(editors.id, ed.id));
  // Secrets that must never be exported.
  const shared = await setSharedPassword(ed.id, "shared-secret-9");
  if (!shared.ok) throw new Error(JSON.stringify(shared));
  const { token } = await createSession(ed.id, { userAgent: "UA-Ada", ip: "203.0.113.77" });
  const sessionId = (await validateSession(token))!.sessionId;
  const codes = await generateRecoveryCodes({ editorId: ed.id, sessionId });
  if (!codes.ok) throw new Error();
  await db.insert(passkeys).values({
    editorId: ed.id,
    credentialId: "CREDENTIAL-ID-ADA",
    publicKey: "PUBLIC-KEY-ADA",
    deviceType: "singleDevice",
    name: "Ada's laptop",
  });
  return { ed, ewe, secret, draft, ewePoem: ewePoem[0], collectionId: col.collection.id, token, codes: codes.codes };
}

async function exportOf(editorId: string): Promise<EditorExport> {
  const data = await loadEditorExport(editorId, { site: SITE, now: NOW });
  if (!data) throw new Error("no export");
  return data;
}

/** Every key anywhere in a JSON value. */
const keysOf = (v: unknown): string[] =>
  Array.isArray(v) ? v.flatMap(keysOf) : v && typeof v === "object" ? Object.entries(v).flatMap(([k, x]) => [k, ...keysOf(x)]) : [];

describe("what the export contains", () => {
  it("has the profile, collections in order and every poem, drafts and private ones with their text", async () => {
    const a = await ada();
    const data = await exportOf(a.ed.id);
    expect(data).toMatchObject({ format: "inkboard-export", version: 6, exportedAt: NOW.toISOString(), site: SITE });
    expect(data.profile).toEqual({
      penName: "Ada Verse",
      slug: "ada-verse",
      tagline: "Small poems about rivers",
      bio: `Writes in English and Ewe.\n${GHANAIAN}`,
      links: ["https://ada.example/"],
      avatar: null,
      photo: null,
      pinnedPoemId: a.ewe,
      joinedAt: a.ed.createdAt.toISOString(),
    });
    expect(data.collections).toEqual([
      expect.objectContaining({ title: "Coastline", intro: "Poems from the shore.", poemIds: [a.ewe, a.draft] }),
    ]);
    expect(data.poems.map((p) => [p.title, p.visibility, p.status])).toEqual([
      ["Ŋkɔ", "public", "published"],
      ["Locked room", "private", "published"],
      ["Unfinished", "public", "draft"],
    ]);
    const [ewe, locked, draft] = data.poems;
    expect(locked.text).toBe("only for friends");
    expect(draft).toMatchObject({ text: "half a line", publishedAt: null, collection: { title: "Coastline", position: 2 } });
    expect(ewe).toMatchObject({ language: "ee", collection: { id: a.collectionId, title: "Coastline", position: 1 } });
    expect(Object.keys(ewe).sort()).toEqual(
      ["collection", "createdAt", "id", "language", "publishedAt", "revisions", "shareVisits", "slug", "status", "text", "title", "updatedAt", "visibility"],
    );
    // Never shared as a picture yet: no visits (Phase 21 round 3).
    expect(data.poems.map((p) => p.shareVisits)).toEqual([0, 0, 0]);
  });

  it("carries each poem's visits through its short link, and only the editor's own (version 2)", async () => {
    const a = await ada();
    const eve = await editor("eve@example.com", "Eve Other");
    const [theirs] = await db.insert(poems).values({ editorId: eve.id, title: "EVE-TITLE", slug: "eve", body: "x", status: "published", publishedAt: new Date() }).returning();
    await ensureShortCode(a.ewe);
    await ensureShortCode(theirs.id);
    await countShareVisit(a.ewe, "198.51.100.1");
    await countShareVisit(a.ewe, "198.51.100.2");
    for (let i = 0; i < 5; i++) await countShareVisit(theirs.id, `198.51.100.${10 + i}`);
    const data = await exportOf(a.ed.id);
    expect(data.version).toBe(6);
    expect(data.poems.map((p) => [p.title, p.shareVisits])).toEqual([
      ["Ŋkɔ", 2],
      ["Locked room", 0],
      ["Unfinished", 0],
    ]);
    // Nothing about who visited, and not the short code (a public address, not something they wrote).
    const json = exportToJson(data);
    expect(json).not.toMatch(/198\.51\.100/);
    expect(json).not.toContain((await db.select().from(shortLinks))[0].code);
  });

  it("includes each poem's saved versions, oldest first, the newest matching the poem", async () => {
    const a = await ada();
    const [ewe] = (await exportOf(a.ed.id)).poems;
    expect(ewe.revisions.map((r) => r.text)).toEqual(["first draft", ewe.text]);
    expect(ewe.revisions[0]).toEqual({ savedAt: expect.any(String), title: "Ŋkɔ", text: "first draft", language: "ee" });
  });

  it("never includes another editor's poems, collections or profile", async () => {
    const a = await ada();
    const eve = await editor("eve@example.com", "Eve Other", { bio: "EVE-BIO" });
    await poem(eve.id, { title: "EVE-TITLE", body: "EVE-TEXT", visibility: "private", password: "eve-pass-123" });
    await createCollection(eve.id, { title: "EVE-COLLECTION" });
    const files = [exportToJson(await exportOf(a.ed.id)), exportToMarkdown(await exportOf(a.ed.id))];
    for (const file of files) for (const s of ["EVE-", "eve@example.com", eve.id]) expect(file).not.toContain(s);
    // ...and Eve's own export has only Eve's.
    const theirs = await exportOf(eve.id);
    expect(theirs.poems.map((p) => p.title)).toEqual(["EVE-TITLE"]);
    expect(JSON.stringify(theirs)).not.toContain("Ada");
  });

  it("never includes passwords, sign-in data, recovery codes, passkeys or the email address", async () => {
    const a = await ada();
    const [hashes] = await db
      .select({ shared: editors.sharedPasswordHash, version: editors.sharedPasswordVersion })
      .from(editors)
      .where(eq(editors.id, a.ed.id));
    const poemHashes = (await db.select({ h: poems.passwordHash }).from(poems).where(eq(poems.editorId, a.ed.id)))
      .map((r) => r.h)
      .filter(Boolean) as string[];
    const sessionHashes = (await db.select({ h: sessions.tokenHash }).from(sessions)).map((r) => r.h);
    const codeHashes = (await db.select({ h: recoveryCodes.codeHash }).from(recoveryCodes)).map((r) => r.h);
    expect(hashes.shared).toMatch(/^scrypt\$/);

    const data = await exportOf(a.ed.id);
    const forbidden = [
      "scrypt$",
      hashes.shared!,
      ...poemHashes,
      "shared-secret-9",
      "poem-pass-123",
      a.token,
      ...sessionHashes,
      ...codeHashes,
      ...a.codes,
      "CREDENTIAL-ID-ADA",
      "PUBLIC-KEY-ADA",
      "Ada's laptop",
      "ada@example.com",
      "203.0.113.77",
      "UA-Ada",
      a.ed.id,
    ];
    for (const file of [exportToJson(data), exportToMarkdown(data)]) {
      for (const secret of forbidden) expect(file, secret).not.toContain(secret);
    }
    // No field that could carry them, anywhere in the JSON.
    for (const key of keysOf(JSON.parse(exportToJson(data)))) {
      expect(key).not.toMatch(/password|hash|session|token|passkey|recovery|email|counter|^ip$|userAgent|signIn/i);
    }
  });

  it("is null for an editor who hasn't onboarded (or doesn't exist)", async () => {
    const [half] = await db.insert(editors).values({ email: "new@example.com" }).returning();
    expect(await loadEditorExport(half.id, { site: SITE })).toBeNull();
    expect(await loadEditorExport("00000000-0000-0000-0000-000000000000", { site: SITE })).toBeNull();
  });
});

describe("the files", () => {
  it("JSON: versioned, pretty, and parses back to the same data", async () => {
    const a = await ada();
    const data = await exportOf(a.ed.id);
    const json = exportToJson(data);
    expect(json.startsWith('{\n  "format": "inkboard-export",\n  "version": 6,')).toBe(true);
    expect(json.endsWith("}\n")).toBe(true);
    expect(JSON.parse(json)).toEqual(data);
  });

  it("Markdown: the profile first, then each collection's poems in order, then the rest, each with its details", async () => {
    const a = await ada();
    const md = exportToMarkdown(await exportOf(a.ed.id));
    const lines = md.split("\n");
    expect(lines.slice(0, 4)).toEqual(["# Ada Verse", "", "*Small poems about rivers*", ""]);
    expect(md).toContain("Links:\n- https://ada.example/");
    expect(md).toContain("Author page: https://inkboard.test/a/ada-verse");
    expect(md).toContain("Exported from InkBoard on 2026-11-15: 3 poems (1 draft, 1 private poem), 1 collection.");
    const order = ["## Coastline", "Poems from the shore.", "### Ŋkɔ", "### Unfinished", "## Poems not in a collection", "### Locked room"];
    const at = order.map((h) => md.indexOf(h));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((x, y) => x - y)).toEqual(at);
    expect(md).toContain("- Language: Ewe (ee)\n- Visibility: Public\n- Status: Published 20");
    expect(md).toContain("- Collection: Coastline, part 1");
    expect(md).toContain("### Unfinished\n\n- Language: Not set\n- Visibility: Public once published\n- Status: Draft\n- Collection: Coastline, part 2");
    expect(md).toContain("- Visibility: Private (readers need a password; the password isn't in this file)");
    expect(md).toContain("### Locked room\n\n- Language: Not set\n");
    expect(md).toMatch(/- Created \d{4}-\d\d-\d\d · last edited \d{4}-\d\d-\d\d\n\nonly for friends\n/);
  });

  it("keeps every poem's lines, blank lines, indentation and Markdown in a form that renders (Phase 19)", async () => {
    const a = await ada();
    const [stored] = await db.select({ body: poems.body }).from(poems).where(eq(poems.id, a.ewe));
    expect(stored.body).toBe(`ɖeka\n  ${GHANAIAN}\n\n*ɛ́yae* **ɔ̀**`.normalize("NFC"));
    const md = exportToMarkdown(await exportOf(a.ed.id));
    // A hard break after the first line, the indent as no-break spaces, the blank line, the emphasis as written.
    expect(md).toContain(`\nɖeka  \n\u00a0\u00a0${poemTextToMarkdown(GHANAIAN)}\n\n*ɛ́yae* **ɔ̀**\n`.normalize("NFC"));
    const html = new HtmlRenderer().render(new Parser().parse(md));
    expect(html).toContain(`<p>ɖeka<br />\n\u00a0\u00a0${GHANAIAN}</p>\n<p><em>ɛ́yae</em> <strong>ɔ̀</strong></p>`.normalize("NFC"));
  });

  it("round-trips Ghanaian letters, IPA and Ewe tone marks byte for byte, in NFC", async () => {
    const a = await ada();
    const data = await exportOf(a.ed.id);
    const json = exportToJson(data);
    const md = exportToMarkdown(data);
    // The Markdown escapes "[" (Markdown would read it as a link), so check it as rendered.
    const rendered = new HtmlRenderer().render(new Parser().parse(md));
    for (const file of [json, rendered]) {
      expect(file).toContain(GHANAIAN);
    }
    for (const file of [json, md]) {
      expect(file.normalize("NFC")).toBe(file);
      // Encoded as UTF-8 and decoded again: identical.
      expect(new TextDecoder("utf-8", { fatal: true }).decode(new TextEncoder().encode(file))).toBe(file);
    }
    const back = JSON.parse(json) as EditorExport;
    const [stored] = await db.select({ body: poems.body, title: poems.title }).from(poems).where(eq(poems.id, a.ewe));
    expect(back.poems[0].text).toBe(stored.body);
    expect(back.poems[0].title).toBe("Ŋkɔ");
    expect(back.profile.bio).toBe(`Writes in English and Ewe.\n${GHANAIAN}`);
    // ɛ́ stays ɛ + U+0301 (no precomposed form), as stored.
    expect([...back.poems[0].text].filter((c) => c === "́").length).toBeGreaterThan(0);
  });

  it("names files after the author and the day, with a charset in the content type", () => {
    const at = new Date("2026-11-15T23:30:00Z");
    expect(exportFileName("ada-verse", "markdown", at)).toBe("inkboard-ada-verse-2026-11-15.md");
    expect(exportFileName("ada-verse", "json", at)).toBe("inkboard-ada-verse-2026-11-15.json");
    expect(exportFileName('evil"/\\..', "json", at)).toBe("inkboard-evil-2026-11-15.json");
    expect(exportFileName('"/\\.. ', "json", at)).toBe("inkboard-poems-2026-11-15.json");
    expect(EXPORT_CONTENT_TYPES).toEqual({
      markdown: "text/markdown; charset=utf-8",
      json: "application/json; charset=utf-8",
    });
  });

  it("an editor with nothing yet gets a valid, near-empty file", async () => {
    const ed = await editor("blank@example.com", "Blank Page");
    const data = await exportOf(ed.id);
    expect(data.poems).toEqual([]);
    expect(exportToMarkdown(data)).toContain("*No poems yet.*");
    expect(JSON.parse(exportToJson(data)).collections).toEqual([]);
  });
});

describe("the download limit", () => {
  it(`allows ${EXPORTS_PER_HOUR} downloads an hour per editor`, async () => {
    const a = await editor("a@example.com", "A One");
    const b = await editor("b@example.com", "B Two");
    for (let i = 0; i < EXPORTS_PER_HOUR; i++) expect((await allowExport(a.id)).allowed).toBe(true);
    const over = await allowExport(a.id);
    expect(over.allowed).toBe(false);
    expect(over.retryAfter).toBeGreaterThan(3000);
    expect((await allowExport(b.id)).allowed).toBe(true);
    const keys = (await db.execute(sql`SELECT key FROM rate_limits ORDER BY key`)) as unknown as { rows: { key: string }[] };
    expect(keys.rows.map((r) => r.key)).toEqual([`export:${a.id}`, `export:${b.id}`].sort());
  });
});

describe("the profile photo in the export (Phase 22)", () => {
  it("JSON carries our processed JPEG copy (no metadata), Markdown says where it is; no photo is null", async () => {
    const { savePhoto, readPhotoJpeg } = await import("@/server/profile-photos");
    const { fileOf, phoneJpeg } = await import("../support/photos");
    const sharp = (await import("sharp")).default;
    const a = await ada();
    expect((await exportOf(a.ed.id)).profile.photo).toBeNull();
    expect(exportToMarkdown(await exportOf(a.ed.id))).not.toContain("profile photo");

    const res = await savePhoto(a.ed.id, { file: fileOf(await phoneJpeg()), crop: "0,0,1" });
    if (!res.ok) throw new Error(res.problem);
    const data = await exportOf(a.ed.id);
    expect(data.profile.photo).toEqual({
      type: "image/jpeg",
      width: 512,
      height: 512,
      base64: Buffer.from((await readPhotoJpeg(res.photoKey))!).toString("base64"),
    });
    const meta = await sharp(Buffer.from(data.profile.photo!.base64, "base64")).metadata();
    expect([meta.format, meta.width, meta.exif, meta.icc]).toEqual(["jpeg", 512, undefined, undefined]);
    // Not the storage key (it isn't the writer's data), and the secret checks still hold.
    expect(exportToJson(data)).not.toContain(res.photoKey);
    for (const key of keysOf(JSON.parse(exportToJson(data)))) {
      expect(key).not.toMatch(/password|hash|session|token|passkey|recovery|email|counter|^ip$|userAgent|signIn/i);
    }
    expect(exportToMarkdown(data)).toContain("Your profile photo is in the JSON download (profile.photo).");
  });
});

describe("novels in the export (Phase 23)", () => {
  it("JSON carries every novel with its chapters in order (drafts too), their text exactly as stored and their versions", async () => {
    const { createChapter, createNovel, saveChapter, moveChapter } = await import("@/server/novels");
    const a = await ada();
    const other = await editor("eve@example.com", "Eve Other");
    const theirs = await createNovel(other.id, { title: "EVE-NOVEL" });
    if (!theirs.ok) throw new Error();
    await createChapter(other.id, theirs.novel.id, { title: "EVE-CHAPTER", body: "EVE-TEXT" });

    const book = await createNovel(a.ed.id, { title: "Ɔdɔ ne Asuo", blurb: "A ferry.\nA brother.", language: "ak", status: "ongoing" });
    if (!book.ok) throw new Error();
    const prose = `Akua waited.\nThe lake was high.\n\n* * *\n\n*Asuo yi*, ${GHANAIAN}`;
    const one = await createChapter(a.ed.id, book.novel.id, { title: "Thursday", body: "first", status: "published" });
    const two = await createChapter(a.ed.id, book.novel.id, { title: "", body: "" });
    if (!one.ok || !two.ok) throw new Error();
    await saveChapter(a.ed.id, one.chapter.id, { title: "Thursday", body: prose });
    await moveChapter(a.ed.id, book.novel.id, two.chapter.id, "first");

    const data = await exportOf(a.ed.id);
    expect(data.version).toBe(6);
    expect(data.novels).toHaveLength(1);
    const [n] = data.novels;
    expect(n).toMatchObject({ title: "Ɔdɔ ne Asuo", slug: "odo-ne-asuo", blurb: "A ferry.\nA brother.", language: "ak", status: "ongoing", visibility: "public" });
    expect(n.chapters.map((c) => [c.position, c.title, c.status])).toEqual([
      [1, "", "draft"],
      [2, "Thursday", "published"],
    ]);
    expect(n.chapters[1].text).toBe(prose);
    expect(n.chapters[1].revisions.map((r) => r.text)).toEqual(["first", prose]);
    expect(n.chapters[1].publishedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(JSON.stringify(data)).not.toContain("EVE-");
    // JSON round-trip keeps the text exactly.
    expect(JSON.parse(exportToJson(data)).novels[0].chapters[1].text).toBe(prose);
  });

  it("a private novel (Phase 25): its visibility, never its password's hash or version", async () => {
    const { createChapter, createNovel, updateNovel } = await import("@/server/novels");
    const { novels } = await import("@/db/schema");
    const ed = await editor("nana@example.com", "Nana Ama");
    const book = await createNovel(ed.id, { title: "Behind the Door" });
    if (!book.ok) throw new Error();
    await createChapter(ed.id, book.novel.id, { title: "One", body: "LOCKED-CHAPTER-TEXT", status: "published" });
    // Two password changes: the version is 2, and must appear nowhere.
    expect(await updateNovel(ed.id, book.novel.id, { title: "Behind the Door", visibility: "private", password: "novel-pass-77" })).toMatchObject({ ok: true });
    expect(await updateNovel(ed.id, book.novel.id, { title: "Behind the Door", visibility: "private", password: "novel-pass-78" })).toMatchObject({ ok: true });
    const [row] = await db.select({ hash: novels.passwordHash, version: novels.passwordVersion }).from(novels).where(eq(novels.id, book.novel.id));
    expect(row.hash).toMatch(/^scrypt\$/);
    expect(row.version).toBe(2);

    const data = await exportOf(ed.id);
    expect(data.novels[0]).toMatchObject({ title: "Behind the Door", visibility: "private" });
    expect(Object.keys(data.novels[0]).sort()).toEqual(
      ["blurb", "chapters", "cover", "createdAt", "id", "language", "slug", "status", "title", "updatedAt", "visibility"].sort(),
    );
    // The writer's own text is theirs to keep, private or not.
    expect(data.novels[0].chapters[0].text).toBe("LOCKED-CHAPTER-TEXT");
    const md = exportToMarkdown(data);
    expect(md).toContain("- Visibility: Private (readers need a password; the password isn't in this file)");
    for (const file of [exportToJson(data), md]) {
      for (const secret of ["scrypt$", row.hash!, "novel-pass-77", "novel-pass-78"]) expect(file, secret).not.toContain(secret);
    }
    // No password field anywhere; "version" is only the file format's, at the top.
    const json = JSON.parse(exportToJson(data));
    for (const key of keysOf(json)) expect(key).not.toMatch(/password|hash/i);
    expect(keysOf(json.novels).filter((k) => /version/i.test(k))).toEqual([]);
  });

  it("Markdown: a section per novel after the poems, chapters in order, prose rendered as readers see it", async () => {
    const { createChapter, createNovel } = await import("@/server/novels");
    const a = await ada();
    const book = await createNovel(a.ed.id, { title: "The Ferry", blurb: "Every *Thursday*." });
    if (!book.ok) throw new Error();
    await createChapter(a.ed.id, book.novel.id, { title: "Thursday", body: "Akua waited.\nThe lake was high.\n\n* * *\n\n# not a heading", status: "published" });
    await createChapter(a.ed.id, book.novel.id, { title: "", body: "" });
    const md = exportToMarkdown(await exportOf(a.ed.id));
    expect(md).toContain(", 1 novel.");
    const start = md.indexOf("## The Ferry");
    expect(start).toBeGreaterThan(md.indexOf("Locked room")); // after the poems
    const section = md.slice(start);
    expect(section).toContain("Every \\*Thursday\\*."); // the blurb is plain text
    expect(section.indexOf("### Chapter 1 · Thursday")).toBeLessThan(section.indexOf("### Chapter 2"));
    expect(section).toContain("*Empty draft.*");
    const html = new HtmlRenderer().render(new Parser().parse(section));
    expect(html).toContain("<p>Akua waited.<br />\nThe lake was high.</p>\n<hr />\n<p># not a heading</p>");
  });

  it("an editor without novels gets an empty array, and Markdown says nothing about novels", async () => {
    const a = await ada();
    const data = await exportOf(a.ed.id);
    expect(data.novels).toEqual([]);
    expect(exportToMarkdown(data)).not.toMatch(/novel/i);
  });
});
