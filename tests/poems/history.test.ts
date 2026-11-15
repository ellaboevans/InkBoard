import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { asc, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { editors, poemRevisions, poems } from "@/db/schema";
import { getPoemRevision, listPoemRevisions, REVISIONS_KEPT } from "@/server/poem-history";
import { createPoem, deletePoem, updatePoem, type PoemInput } from "@/server/poems";

const db = getDb();
let ada: string;
let eve: string;

beforeEach(async () => {
  const rows = await db
    .insert(editors)
    .values([
      { email: "ada@example.com", penName: "Ada", slug: "ada" },
      { email: "eve@example.com", penName: "Eve", slug: "eve" },
    ])
    .returning();
  [ada, eve] = rows.map((r) => r.id);
});

const input = (over: Partial<PoemInput> = {}): PoemInput => ({
  title: "Ode",
  body: "first line\n  second line",
  visibility: "public",
  status: "draft",
  ...over,
});

async function create(editorId = ada, over: Partial<PoemInput> = {}) {
  const res = await createPoem(editorId, input(over));
  if (!res.ok) throw new Error(JSON.stringify(res.errors));
  return res.poem.id;
}

async function save(id: string, over: Partial<PoemInput>, editorId = ada) {
  const res = await updatePoem(editorId, id, input(over));
  if (!res.ok) throw new Error(JSON.stringify(res));
}

const rows = (poemId: string) =>
  db.select().from(poemRevisions).where(eq(poemRevisions.poemId, poemId)).orderBy(asc(poemRevisions.savedAt));

describe("recording versions", () => {
  it("creating a poem records its first version", async () => {
    const id = await create(ada, { language: "ee" });
    const list = await listPoemRevisions(ada, id);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ title: "Ode", preview: "first line", language: "ee" });
    const full = await getPoemRevision(ada, id, list[0].id);
    expect(full?.body).toBe("first line\n  second line");
  });

  it("records a version only when the title, text or language changes", async () => {
    const id = await create();
    await save(id, { body: "new text" });
    await save(id, { title: "New title", body: "new text" });
    await save(id, { title: "New title", body: "new text", language: "gaa" });
    expect(await rows(id)).toHaveLength(4);

    // Status, visibility, password and identical re-saves are not versions.
    const same = { title: "New title", body: "new text", language: "gaa" } as const;
    await save(id, { ...same, status: "published" });
    await save(id, { ...same, status: "published", visibility: "private", password: "secret-pass" });
    await save(id, { ...same, status: "published", visibility: "private", password: "other-pass" });
    await save(id, { ...same, status: "draft" });
    await save(id, same);
    // Whitespace the save normalises away (CRLF, trailing spaces) isn't a change either.
    await save(id, { ...same, body: "new text  \r\n\r\n" });
    expect(await rows(id)).toHaveLength(4);

    const list = await listPoemRevisions(ada, id);
    expect(list.map((r) => r.title)).toEqual(["New title", "New title", "Ode", "Ode"]);
    expect(list.map((r) => r.language)).toEqual(["gaa", null, null, null]);
    expect(list.map((r) => r.preview)).toEqual(["new text", "new text", "new text", "first line"]);
  });

  it("the newest version always matches the poem", async () => {
    const id = await create();
    await save(id, { title: "Two", body: "two" });
    const [poem] = await db.select().from(poems).where(eq(poems.id, id));
    const [newest] = await listPoemRevisions(ada, id);
    const full = await getPoemRevision(ada, id, newest.id);
    expect({ title: full?.title, body: full?.body, language: full?.language }).toEqual({
      title: poem.title,
      body: poem.body,
      language: poem.language,
    });
  });

  it("keeps the state a first edit replaces, for poems from before history (or the seed)", async () => {
    const [legacy] = await db
      .insert(poems)
      .values({ editorId: ada, title: "Old", slug: "old", body: "old text", updatedAt: new Date("2026-01-02T03:04:05Z") })
      .returning();
    expect(await listPoemRevisions(ada, legacy.id)).toEqual([]);

    await save(legacy.id, { title: "Old", body: "edited text" });
    const list = await listPoemRevisions(ada, legacy.id);
    expect(list.map((r) => r.preview)).toEqual(["edited text", "old text"]);
    expect(list[1].savedAt.toISOString()).toBe("2026-01-02T03:04:05.000Z");

    // Only once: the next edit adds just one version.
    await save(legacy.id, { title: "Old", body: "third" });
    expect(await rows(legacy.id)).toHaveLength(3);
  });

  it(`keeps the newest ${REVISIONS_KEPT} versions per poem`, async () => {
    const id = await create(ada, { body: "v0" });
    const other = await create(ada, { title: "Other", body: "other" });
    for (let i = 1; i <= REVISIONS_KEPT + 5; i++) await save(id, { body: `v${i}` });

    const list = await listPoemRevisions(ada, id);
    expect(list).toHaveLength(REVISIONS_KEPT);
    expect(list[0].preview).toBe(`v${REVISIONS_KEPT + 5}`);
    expect(list.at(-1)!.preview).toBe("v6");
    // Pruning is per poem.
    expect(await rows(other)).toHaveLength(1);
  });

  it("deleting a poem deletes its history", async () => {
    const id = await create();
    await save(id, { body: "changed" });
    expect(await rows(id)).toHaveLength(2);
    expect(await deletePoem(ada, id)).toBe(true);
    expect(await rows(id)).toHaveLength(0);
  });
});

describe("access", () => {
  it("another editor's poem or revision id behaves like a missing one", async () => {
    const id = await create();
    await save(id, { body: "changed" });
    const [revision] = await listPoemRevisions(ada, id);
    const evePoem = await create(eve, { title: "Eve's" });

    expect(await listPoemRevisions(eve, id)).toEqual([]);
    expect(await getPoemRevision(eve, id, revision.id)).toBeNull();
    // Ada's revision through Eve's poem, and through another poem of Ada's.
    expect(await getPoemRevision(eve, evePoem, revision.id)).toBeNull();
    const adaOther = await create(ada, { title: "Other" });
    expect(await getPoemRevision(ada, adaOther, revision.id)).toBeNull();
    // Eve can't add versions to Ada's poem either.
    expect(await updatePoem(eve, id, input({ body: "eve was here" }))).toEqual({ ok: false, notFound: true });
    expect(await rows(id)).toHaveLength(2);
  });

  it("rejects malformed ids before they reach SQL", async () => {
    const id = await create();
    // A malformed uuid reaching Postgres would throw (invalid_text_representation).
    for (const bad of ["", "nope", "1 OR 1=1", "'; DROP TABLE poem_revisions; --", `${id}x`]) {
      expect(await listPoemRevisions(ada, bad)).toEqual([]);
      expect(await getPoemRevision(ada, bad, bad)).toBeNull();
      expect(await getPoemRevision(ada, id, bad)).toBeNull();
    }
  });
});

describe("no password data in history", () => {
  it("the table has no password or visibility columns", async () => {
    const res = (await db.execute(
      sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'poem_revisions' ORDER BY column_name`,
    )) as unknown as { rows: { column_name: string }[] };
    expect(res.rows.map((r) => r.column_name)).toEqual(["body", "id", "language", "poem_id", "saved_at", "title"]);
  });

  it("private poems' versions hold only title, text and language", async () => {
    const id = await create(ada, { visibility: "private", password: "first-secret" });
    await save(id, { visibility: "private", password: "second-secret", body: "changed" });
    const [poem] = await db.select().from(poems).where(eq(poems.id, id));
    const dump = JSON.stringify(await rows(id));
    expect(dump).not.toContain("secret");
    expect(dump).not.toContain(poem.passwordHash!);
    expect(dump).not.toMatch(/scrypt|password/i);
  });
});

describe("concurrent saves", () => {
  it("record one version per content change, in order, never more than the cap", async () => {
    const id = await create(ada, { body: "start" });
    await Promise.all(Array.from({ length: 8 }, (_, i) => save(id, { body: `tab ${i}` })));

    const [poem] = await db.select().from(poems).where(eq(poems.id, id));
    const list = await listPoemRevisions(ada, id);
    expect(list).toHaveLength(9);
    expect(new Set(list.map((r) => r.preview)).size).toBe(9);
    // Saves queue on the editor row, so the newest version is the last one to commit.
    expect(list[0].preview).toBe(poem.body);
  });

  it("prune correctly at the cap", async () => {
    const id = await create(ada, { body: "v0" });
    for (let i = 1; i < REVISIONS_KEPT; i++) await save(id, { body: `v${i}` });
    expect(await rows(id)).toHaveLength(REVISIONS_KEPT);

    await Promise.all(Array.from({ length: 6 }, (_, i) => save(id, { body: `race ${i}` })));
    const list = await listPoemRevisions(ada, id);
    expect(list).toHaveLength(REVISIONS_KEPT);
    const [poem] = await db.select().from(poems).where(eq(poems.id, id));
    expect(list[0].preview).toBe(poem.body);
    // The six racing saves are all kept (they're the newest), the oldest six are gone.
    expect(list.filter((r) => r.preview.startsWith("race"))).toHaveLength(6);
    expect(list.at(-1)!.preview).toBe("v6");
  });
});

describe("history never reaches readers", () => {
  // Readers' loaders (board, author page, reading page, feeds, search, share
  // cards) must not touch the table; only the editor-side modules may.
  const ALLOWED = ["src/db/schema.ts", "src/server/poem-history.ts", "src/server/poems.ts"];

  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const p = path.join(dir, name);
      return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(name) ? [p] : [];
    });

  it("only the editor-side modules reference poem_revisions", () => {
    const using = files("src").filter((f) => /poemRevisions|poem_revisions/.test(readFileSync(f, "utf8")));
    expect(using.sort()).toEqual(ALLOWED);
  });

  it("history loaders are used only under /admin", () => {
    const using = files("src").filter(
      (f) => !f.startsWith("src/server/poem-history") && /listPoemRevisions|getPoemRevision/.test(readFileSync(f, "utf8")),
    );
    expect(using.length).toBeGreaterThan(0);
    for (const f of using) expect(f, f).toMatch(/^src\/app\/admin\//);
  });

  it("the export loader serves only the editor's own download (Phase 17)", () => {
    const using = files("src").filter(
      (f) => !f.startsWith("src/server/poem-history") && /revisionsForExport/.test(readFileSync(f, "utf8")),
    );
    expect(using).toEqual(["src/server/export.ts"]);
    const callers = files("src").filter((f) => /from "@\/server\/export"/.test(readFileSync(f, "utf8")));
    for (const f of callers) expect(f, f).toMatch(/^src\/app\/admin\//);
  });
});
