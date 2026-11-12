import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { editors, poems } from "@/db/schema";
import { searchBoard, searchWords } from "@/server/search";

const db = getDb();

async function author(penName: string | null, slug: string | null) {
  const [e] = await db
    .insert(editors)
    .values({ email: `${slug ?? Math.random()}@x.com`, penName, slug })
    .returning();
  return e.id;
}
async function poem(editorId: string, title: string, over: Partial<typeof poems.$inferInsert> = {}) {
  await db.insert(poems).values({
    editorId,
    title,
    slug: title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    body: "the moon is a lantern over the harbour",
    status: "published",
    publishedAt: new Date(),
    ...over,
  });
}

const titles = async (q: string) => (await searchBoard(q)).poems.map((p) => p.title);
const names = async (q: string) => (await searchBoard(q)).authors.map((a) => a.penName);

beforeEach(async () => {
  const emily = await author("Emily Dickinson", "emily-dickinson");
  const jose = await author("José Martí", "jose-marti");
  const quiet = await author("Quiet Drafter", "quiet-drafter");
  const nobody = await author(null, null);
  await poem(emily, "Rose Garden at Dusk");
  await poem(emily, "Hope Is the Thing with Feathers");
  await poem(emily, "Secret Rooms", { visibility: "private", passwordHash: "scrypt$x" });
  await poem(jose, "Versos Sencillos");
  await poem(quiet, "Rosebud Draft", { status: "draft", publishedAt: null });
  await poem(nobody, "Rose Orphan");
});

describe("searchWords", () => {
  it("keeps only letter and digit words", () => {
    expect(searchWords(`ros:* & !(x) | 'drop' -- ;`)).toEqual(["ros", "x", "drop"]);
    expect(searchWords("José 2024")).toEqual(["José", "2024"]);
    expect(searchWords("a b c d e f g h")).toHaveLength(6);
  });
});

describe("searchBoard", () => {
  it("matches title prefixes", async () => {
    expect(await titles("ros")).toEqual(["Rose Garden at Dusk"]);
    expect(await titles("FEATH")).toEqual(["Hope Is the Thing with Feathers"]);
  });

  it("requires every word (multi-word)", async () => {
    expect(await titles("rose dusk")).toEqual(["Rose Garden at Dusk"]);
    expect(await titles("rose feathers")).toEqual([]);
    expect(await titles("hope thing")).toEqual(["Hope Is the Thing with Feathers"]);
  });

  it("tolerates small typos", async () => {
    expect(await names("dickenson")).toEqual(["Emily Dickinson"]);
    expect(await titles("fethers")).toContain("Hope Is the Thing with Feathers");
  });

  it("is accent-insensitive both ways", async () => {
    expect(await names("jose marti")).toEqual(["José Martí"]);
    expect(await names("josé")).toEqual(["José Martí"]);
  });

  it("finds authors by pen name with their published poem count", async () => {
    const { authors } = await searchBoard("emily");
    expect(authors).toEqual([
      { editorId: expect.any(String), penName: "Emily Dickinson", slug: "emily-dickinson", poemCount: 3 },
    ]);
  });

  it("finds private poems by title, but never by their text (N1)", async () => {
    expect(await titles("secret")).toEqual(["Secret Rooms"]);
    for (const q of ["lantern", "harbour", "moon"]) {
      expect(await searchBoard(q)).toEqual({ authors: [], poems: [] });
    }
    const json = JSON.stringify(await searchBoard("secret"));
    expect(json).not.toContain("lantern");
    expect(json).not.toContain("scrypt");
  });

  it("excludes drafts, authors with only drafts, and un-onboarded editors", async () => {
    expect(await titles("rosebud")).not.toContain("Rosebud Draft");
    expect(await names("quiet")).toEqual([]);
    expect(await titles("orphan")).not.toContain("Rose Orphan");
  });

  it("ignores too-short, empty, symbol-only and non-string input", async () => {
    for (const q of ["", " ", "r", "&|!", 42, null, undefined]) {
      expect(await searchBoard(q)).toEqual({ authors: [], poems: [] });
    }
  });

  it("treats tsquery syntax as plain text", async () => {
    await expect(searchBoard("rose:* | !garden & (")).resolves.toBeDefined();
    expect(await titles("rose:* | !garden")).toEqual(["Rose Garden at Dusk"]);
  });
});
