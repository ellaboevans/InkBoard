import { asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { collections, editors, poems } from "@/db/schema";
import { loadReaderPoem } from "@/server/board";
import {
  COLLECTION_POEMS_MAX,
  COLLECTIONS_MAX,
  collectionOptions,
  createCollection,
  deleteCollection,
  getCollection,
  listCollections,
  moveCollectionPoem,
  poemsWithoutCollection,
  setPoemCollection,
  updateCollection,
} from "@/server/collections";
import { setSharedPassword } from "@/server/password-settings";
import { createPoem, deletePoem, getEditorPoem, updatePoem, type PoemInput } from "@/server/poems";

const db = getDb();
let ada: string;
let eve: string;

beforeEach(async () => {
  const rows = await db
    .insert(editors)
    .values([
      { email: "ada-secret@example.com", penName: "Ada", slug: "ada" },
      { email: "eve-secret@example.com", penName: "Eve", slug: "eve" },
    ])
    .returning();
  [ada, eve] = rows.map((r) => r.id);
});

const input = (over: Partial<PoemInput> = {}): PoemInput => ({
  title: "Poem",
  body: "a line",
  visibility: "public",
  status: "published",
  ...over,
});

async function poem(editorId: string, title: string, over: Partial<PoemInput> = {}) {
  const res = await createPoem(editorId, input({ title, ...over }));
  if (!res.ok) throw new Error(JSON.stringify(res.errors));
  return res.poem.id;
}

async function collection(editorId: string, title = "Cycle", intro?: string) {
  const res = await createCollection(editorId, { title, intro });
  if (!res.ok) throw new Error(JSON.stringify(res));
  return res.collection.id;
}

async function add(poemId: string, collectionId: string | null, editorId = ada) {
  const res = await setPoemCollection(editorId, poemId, collectionId);
  if (!res.ok) throw new Error(JSON.stringify(res));
}

/** Titles in order, and the raw positions (must be 1..n). */
async function order(collectionId: string) {
  const rows = await db
    .select({ title: poems.title, position: poems.collectionPosition })
    .from(poems)
    .where(eq(poems.collectionId, collectionId))
    .orderBy(asc(poems.collectionPosition));
  expect(rows.map((r) => r.position), "contiguous positions").toEqual(rows.map((_, i) => i + 1));
  return rows.map((r) => r.title);
}

/** A collection of `titles`, added in order. */
async function cycle(titles: string[], over: Partial<PoemInput>[] = []) {
  const c = await collection(ada);
  const ids: string[] = [];
  for (const [i, t] of titles.entries()) {
    const id = await poem(ada, t, over[i]);
    await add(id, c);
    ids.push(id);
  }
  return { c, ids };
}

describe("creating and editing collections", () => {
  it("creates one with a slug unique per editor that stays fixed on rename", async () => {
    const first = await createCollection(ada, { title: "  Harmattan Cycle ", intro: " Dust.\r\nWind. " });
    const second = await createCollection(ada, { title: "Harmattan cycle" });
    const eves = await createCollection(eve, { title: "Harmattan Cycle" });
    expect(first).toMatchObject({ ok: true, collection: { slug: "harmattan-cycle" } });
    expect(second).toMatchObject({ ok: true, collection: { slug: "harmattan-cycle-2" } });
    expect(eves).toMatchObject({ ok: true, collection: { slug: "harmattan-cycle" } });
    if (!first.ok) return;

    const c = await getCollection(ada, first.collection.id);
    expect(c).toMatchObject({ title: "Harmattan Cycle", intro: "Dust.\nWind.", poems: [] });

    expect(await updateCollection(ada, first.collection.id, { title: "Renamed", intro: "" })).toMatchObject({
      ok: true,
      collection: { slug: "harmattan-cycle" },
    });
    expect(await getCollection(ada, first.collection.id)).toMatchObject({ title: "Renamed", slug: "harmattan-cycle", intro: null });
  });

  it("validates title, intro and the per-editor limit on the server", async () => {
    expect(await createCollection(ada, { title: "  " })).toMatchObject({ ok: false, errors: { title: expect.any(String) } });
    expect(await createCollection(ada, { title: "x".repeat(101) })).toMatchObject({ ok: false, errors: { title: expect.any(String) } });
    expect(await createCollection(ada, { title: "Ok", intro: "y".repeat(501) })).toMatchObject({ ok: false, errors: { intro: expect.any(String) } });

    await db.insert(collections).values(
      Array.from({ length: COLLECTIONS_MAX }, (_, i) => ({ editorId: ada, title: `C${i}`, slug: `c${i}` })),
    );
    expect(await createCollection(ada, { title: "One too many" })).toMatchObject({ ok: false, errors: { form: expect.stringContaining(`${COLLECTIONS_MAX}`) } });
    expect(await createCollection(eve, { title: "Eve is fine" })).toMatchObject({ ok: true });
  });

  it("caps poems per collection", async () => {
    const c = await collection(ada);
    await db.insert(poems).values(
      Array.from({ length: COLLECTION_POEMS_MAX }, (_, i) => ({
        editorId: ada, title: `P${i}`, slug: `p${i}`, body: "x", collectionId: c, collectionPosition: i + 1,
      })),
    );
    const extra = await poem(ada, "Extra");
    expect(await setPoemCollection(ada, extra, c)).toMatchObject({ ok: false, error: expect.stringContaining(`${COLLECTION_POEMS_MAX}`) });
    // Through the poem editor: a form error, and nothing saved (rolled back).
    expect(await updatePoem(ada, extra, input({ title: "Extra renamed", collection: c }))).toMatchObject({
      ok: false,
      errors: { collection: expect.any(String) },
    });
    expect((await getEditorPoem(ada, extra))?.title).toBe("Extra");
  });

  it("lists collections with counts", async () => {
    const { c } = await cycle(["One", "Two", "Three"], [{}, { status: "draft" }, {}]);
    await collection(ada, "Another");
    expect(await listCollections(ada)).toMatchObject([
      { title: "Another", poemCount: 0, publishedCount: 0 },
      { id: c, title: "Cycle", poemCount: 3, publishedCount: 2 },
    ]);
    expect((await collectionOptions(ada)).map((o) => o.title)).toEqual(["Another", "Cycle"]);
    expect(await listCollections(eve)).toEqual([]);
  });
});

describe("one collection per poem, contiguous positions", () => {
  it("adds to the end, and moving to another collection takes it out of the first", async () => {
    const { c, ids } = await cycle(["One", "Two", "Three"]);
    const other = await collection(ada, "Other");
    await add(ids[1], other);
    expect(await order(c)).toEqual(["One", "Three"]);
    expect(await order(other)).toEqual(["Two"]);
    // Through the poem editor's picker too.
    expect(await updatePoem(ada, ids[0], input({ title: "One", collection: other }))).toMatchObject({ ok: true });
    expect(await order(c)).toEqual(["Three"]);
    expect(await order(other)).toEqual(["Two", "One"]);
    // "" = none; absent = unchanged.
    expect(await updatePoem(ada, ids[0], input({ title: "One", body: "edited" }))).toMatchObject({ ok: true });
    expect(await order(other)).toEqual(["Two", "One"]);
    expect(await updatePoem(ada, ids[0], input({ title: "One", collection: "" }))).toMatchObject({ ok: true });
    expect(await order(other)).toEqual(["Two"]);
    expect((await poemsWithoutCollection(ada)).map((p) => p.title)).toEqual(["One"]);
  });

  it("creating a poem in a collection puts it at the end", async () => {
    const { c } = await cycle(["One", "Two"]);
    const res = await createPoem(ada, input({ title: "Three", collection: c }));
    expect(res.ok).toBe(true);
    expect(await order(c)).toEqual(["One", "Two", "Three"]);
  });

  it("moves up, down, first and last; never past the ends", async () => {
    const { c, ids } = await cycle(["A", "B", "C", "D"]);
    expect(await moveCollectionPoem(ada, c, ids[2], "up")).toMatchObject({ ok: true, position: 2, total: 4, title: "C" });
    expect(await order(c)).toEqual(["A", "C", "B", "D"]);
    expect(await moveCollectionPoem(ada, c, ids[0], "down")).toMatchObject({ ok: true, position: 2 });
    expect(await order(c)).toEqual(["C", "A", "B", "D"]);
    expect(await moveCollectionPoem(ada, c, ids[3], "first")).toMatchObject({ ok: true, position: 1 });
    expect(await moveCollectionPoem(ada, c, ids[3], "last")).toMatchObject({ ok: true, position: 4 });
    expect(await moveCollectionPoem(ada, c, ids[3], "down")).toMatchObject({ ok: true, position: 4 });
    expect(await order(c)).toEqual(["C", "A", "B", "D"]);
  });

  it("deleting a poem closes the gap; deleting the collection keeps its poems", async () => {
    const { c, ids } = await cycle(["A", "B", "C", "D"]);
    expect(await deletePoem(ada, ids[1])).toBe(true);
    expect(await order(c)).toEqual(["A", "C", "D"]);

    expect((await deleteCollection(ada, c))?.length).toBe(3);
    const left = await db.select().from(poems).where(eq(poems.editorId, ada));
    expect(left.map((p) => [p.title, p.collectionId, p.collectionPosition]).sort()).toEqual([
      ["A", null, null],
      ["C", null, null],
      ["D", null, null],
    ]);
  });

  it("unpublishing keeps the editor's order; readers' parts skip the draft", async () => {
    const { c, ids } = await cycle(["A", "B", "C"]);
    expect(await updatePoem(ada, ids[1], input({ title: "B", status: "draft" }))).toMatchObject({ ok: true });
    expect(await order(c)).toEqual(["A", "B", "C"]);
    expect((await loadReaderPoem("ada", "c"))?.collection).toMatchObject({ part: 2, parts: 2, prev: { slug: "a" }, next: null });
  });
});

describe("readers", () => {
  it("see part n of the published poems and published neighbours only", async () => {
    await cycle(
      ["One", "Draft two", "Three", "Secret four", "Five"],
      [{}, { status: "draft", body: "DRAFT TEXT" }, {}, { visibility: "private", password: "four-pass", body: "PRIVATE TEXT" }, {}],
    );
    const three = await loadReaderPoem("ada", "three");
    expect(three?.collection).toEqual({
      title: "Cycle",
      slug: "cycle",
      part: 2,
      parts: 4,
      prev: { title: "One", slug: "one", visibility: "public", language: null },
      next: { title: "Secret four", slug: "secret-four", visibility: "private", language: null },
    });
    expect((await loadReaderPoem("ada", "one"))?.collection).toMatchObject({ part: 1, prev: null, next: { slug: "three" } });
    expect((await loadReaderPoem("ada", "five"))?.collection).toMatchObject({ part: 4, parts: 4, next: null });

    // The private poem's own page: title-only neighbours, no text anywhere.
    const secret = await loadReaderPoem("ada", "secret-four");
    expect(secret?.collection).toMatchObject({ part: 3, prev: { slug: "three" }, next: { slug: "five" } });
    for (const p of [three, secret]) {
      const json = JSON.stringify(p);
      expect(json).not.toMatch(/PRIVATE TEXT|DRAFT TEXT|Draft two|draft-two|secret@|@example\.com/);
    }
    // Drafts have no reading page at all.
    expect(await loadReaderPoem("ada", "draft-two")).toBeNull();
  });

  it("poems outside a collection have none", async () => {
    await poem(ada, "Alone");
    expect((await loadReaderPoem("ada", "alone"))?.collection).toBeNull();
  });
});

describe("scoping", () => {
  it("another editor's collection or poem id behaves like a missing one", async () => {
    const { c, ids } = await cycle(["A", "B"]);
    const evePoem = await poem(eve, "Eve's");
    const eveCollection = await collection(eve, "Eve's cycle");

    expect(await getCollection(eve, c)).toBeNull();
    expect(await updateCollection(eve, c, { title: "Mine now" })).toEqual({ ok: false, notFound: true });
    expect(await deleteCollection(eve, c)).toBeNull();
    expect(await moveCollectionPoem(eve, c, ids[1], "up")).toEqual({ ok: false, notFound: true });
    // Ada's poem into Eve's collection, Eve's poem into Ada's: both missing.
    expect(await setPoemCollection(eve, ids[0], eveCollection)).toEqual({ ok: false, notFound: true });
    expect(await setPoemCollection(eve, evePoem, c)).toEqual({ ok: false, notFound: true });
    expect(await setPoemCollection(ada, evePoem, c)).toEqual({ ok: false, notFound: true });
    expect(await updatePoem(eve, evePoem, input({ title: "Eve's", collection: c }))).toMatchObject({
      ok: false,
      errors: { collection: expect.any(String) },
    });
    expect(await createPoem(eve, input({ title: "Sneaky", collection: c }))).toMatchObject({ ok: false, errors: { collection: expect.any(String) } });
    // A poem of the collection's editor that isn't in it can't be moved there.
    const outside = await poem(ada, "Outside");
    expect(await moveCollectionPoem(ada, c, outside, "up")).toEqual({ ok: false, notFound: true });

    expect(await order(c)).toEqual(["A", "B"]);
    expect(await getCollection(ada, c)).toMatchObject({ title: "Cycle" });
  });

  it("rejects malformed ids before they reach SQL", async () => {
    const { c, ids } = await cycle(["A"]);
    // A malformed uuid reaching Postgres would throw.
    for (const bad of ["", "nope", "1 OR 1=1", "'; DROP TABLE collections; --", `${c}x`]) {
      expect(await getCollection(ada, bad)).toBeNull();
      expect(await updateCollection(ada, bad, { title: "x" })).toEqual({ ok: false, notFound: true });
      expect(await deleteCollection(ada, bad)).toBeNull();
      expect(await moveCollectionPoem(ada, bad, ids[0], "up")).toEqual({ ok: false, notFound: true });
      expect(await moveCollectionPoem(ada, c, bad, "up")).toEqual({ ok: false, notFound: true });
      expect(await setPoemCollection(ada, bad, c)).toEqual({ ok: false, notFound: true });
      expect(await setPoemCollection(ada, ids[0], bad)).toEqual({ ok: false, notFound: true });
      expect(await updatePoem(ada, ids[0], input({ title: "A", collection: bad || "x" }))).toMatchObject({
        ok: false,
        errors: { collection: expect.any(String) },
      });
    }
  });
});

describe("concurrency", () => {
  it("reorders, saves, moves, deletes and a password-mode switch never deadlock or leave gaps", async () => {
    const titles = Array.from({ length: 8 }, (_, i) => `P${i}`);
    const { c, ids } = await cycle(titles);
    const other = await collection(ada, "Other");

    for (let round = 0; round < 6; round++) {
      const results = await Promise.allSettled([
        moveCollectionPoem(ada, c, ids[round % ids.length], "first"),
        moveCollectionPoem(ada, c, ids[(round + 3) % ids.length], "down"),
        setPoemCollection(ada, ids[(round + 1) % ids.length], round % 2 ? other : c),
        updatePoem(ada, ids[(round + 2) % ids.length], input({ title: titles[(round + 2) % ids.length], body: `round ${round}`, collection: round % 2 ? c : other })),
        updateCollection(ada, c, { title: `Cycle ${round}` }),
        round === 3 ? setSharedPassword(ada, "shared-secret") : Promise.resolve(),
        round === 4 ? deletePoem(ada, ids[7]) : Promise.resolve(),
      ]);
      for (const r of results) expect(r.status, String((r as PromiseRejectedResult).reason)).toBe("fulfilled");
      await order(c);
      await order(other);
    }
    // Every poem is in exactly one place, or none.
    const all = await db.select().from(poems).where(eq(poems.editorId, ada));
    expect(all).toHaveLength(7);
    for (const p of all) expect(p.collectionId === null, p.title).toBe(p.collectionPosition === null);
  });

  it("concurrent adds to one collection get distinct positions", async () => {
    const c = await collection(ada);
    const ids = await Promise.all(Array.from({ length: 10 }, (_, i) => poem(ada, `N${i}`)));
    await Promise.all(ids.map((id) => setPoemCollection(ada, id, c)));
    expect(await order(c)).toHaveLength(10);
  });
});
