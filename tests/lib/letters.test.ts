import { readFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { editors, poems } from "@/db/schema";
import { SEARCH_FOLD, toNfc, transliterate } from "@/lib/letters";
import { cardExcerpt, normalizePoemBody } from "@/lib/poem-text";
import { slugify } from "@/lib/slug";
import { setPenName, updateProfile } from "@/server/auth/profile";
import { createPoem } from "@/server/poems";
import { searchBoard, searchWords } from "@/server/search";

// Ghanaian languages and IPA (docs/PLAN.md, Phase 11).
const db = getDb();
const TILDE = "̃"; // combining tilde: Ewe nasal vowel, e.g. ɔ̃ (no precomposed form)
const ACUTE = "́"; // combining acute: high tone

describe("slugs spell special letters in plain Latin", () => {
  it.each([
    ["Ɔdɔ yɛ dɛ", "odo-ye-de"], // Twi
    ["Ŋutifafa na wò", "ngutifafa-na-wo"], // Ewe
    ["Mía ƒe ɖevi", "mia-fe-devi"], // Ewe
    ["Ŋmɛnɛ", "ngmene"], // Ga
    ["Nzɛma", "nzema"], // Nzema
    [`Nyɔ${TILDE}`, "nyo"], // tone mark dropped
    ["/ˈpoʊ.əm/", "pou-em"], // IPA
    ["ƐƆƉƑƔŊƲƷ", "eodfgngvz"], // capitals
    ["José Martí", "jose-marti"], // unchanged behaviour
  ])("%s → %s", (title, slug) => {
    expect(slugify(title)).toBe(slug);
  });

  it("never drops a letter it can't spell", () => {
    // Before Phase 11, "Ɔdɔ" became "d".
    expect(transliterate("Ɔdɔ")).toBe("odo");
    expect(slugify("ɔ")).toBe("o");
  });
});

describe("one stored form (NFC)", () => {
  it("makes a combining tone mark and the precomposed letter the same text", () => {
    expect(toNfc(`e${ACUTE}`)).toBe("é");
    // ɔ has no precomposed toned forms: letter + mark is already canonical.
    expect(toNfc(`ɔ${TILDE}`)).toBe(`ɔ${TILDE}`);
    expect(normalizePoemBody(`Cafe${ACUTE}\r\nɔdɔ`)).toBe("Café\nɔdɔ");
  });

  it("is applied to titles, poem text, pen names, bios and taglines on save", async () => {
    const [e] = await db.insert(editors).values({ email: "kofi@example.com" }).returning();
    expect(await setPenName(e.id, `Kɔfi Ame${ACUTE}`)).toEqual({ ok: true, slug: "kofi-ame" });
    const res = await createPoem(e.id, {
      title: `Ŋutifafa le wo${"\u0300"}`, // o + combining grave
      body: `Mi${ACUTE}a`, // i + combining acute
      visibility: "public",
      status: "published",
    });
    if (!res.ok) throw new Error(JSON.stringify(res.errors));
    expect(res.poem.slug).toBe("ngutifafa-le-wo");
    expect(
      await updateProfile(e.id, {
        penName: `Kɔfi Ame${ACUTE}`,
        bio: "Ɔdɔ ne".normalize("NFD") + `e${ACUTE}`,
        tagline: `Nye${ACUTE}`,
      }),
    ).toMatchObject({ ok: true });
    const [row] = await db.select().from(editors);
    expect(row.penName).toBe("Kɔfi Amé");
    expect(row.bio).toBe("Ɔdɔ neé");
    expect(row.tagline).toBe("Nyé");
    const [p] = await db.select().from(poems);
    expect(p.title).toBe("Ŋutifafa le wò");
    expect(p.body).toBe("Mía");
  });

  it("card excerpts keep the letters intact", () => {
    expect(cardExcerpt("Ɔdɔ yɛ dɛ\nŊutifafa").excerpt).toBe("Ɔdɔ yɛ dɛ\nŊutifafa");
  });
});

describe("search", () => {
  it("keeps tone marks inside their word", () => {
    expect(searchWords(`nyɔ${TILDE}dɔ yɛ`)).toEqual([`nyɔ${TILDE}dɔ`, "yɛ"]);
  });

  it("search_normalize() folds the same letters as SEARCH_FOLD, in both cases", async () => {
    expect(SEARCH_FOLD.from.length).toBe(SEARCH_FOLD.to.length);
    const migration = readFileSync(
      path.join(import.meta.dirname, "../../drizzle/0009_search_ghanaian_letters.sql"),
      "utf8",
    );
    expect(migration).toContain(`'${SEARCH_FOLD.from}'`);
    expect(migration).toContain(`'${SEARCH_FOLD.to}'`);
    const { rows } = (await db.execute(
      sql`SELECT search_normalize(${SEARCH_FOLD.from}) AS folded, search_normalize(${`ɔ${TILDE}dɔ ƐNO`}) AS toned`,
    )) as unknown as { rows: { folded: string; toned: string }[] };
    expect(rows[0].folded).toBe(SEARCH_FOLD.to);
    expect(rows[0].toned).toBe("odo eno");
  });

  it("finds Ghanaian-language titles and pen names typed with or without the letters", async () => {
    const [e] = await db
      .insert(editors)
      .values({ email: "awoonor@example.com", penName: "Kɔfi Awoonor", slug: "kofi-awoonor" })
      .returning();
    const published = { editorId: e.id, body: "…", status: "published" as const, publishedAt: new Date() };
    await db.insert(poems).values([
      { ...published, title: "Ɔdɔ yɛ dɛ", slug: "odo-ye-de" },
      { ...published, title: "Ŋutifafa", slug: "ngutifafa" },
    ]);
    const titles = async (q: string) => (await searchBoard(q)).poems.map((p) => p.title);
    const names = async (q: string) => (await searchBoard(q)).authors.map((a) => a.penName);

    for (const q of ["odo", "ɔdɔ", "ƆDƆ", "Odo ye"]) expect(await titles(q)).toEqual(["Ɔdɔ yɛ dɛ"]);
    for (const q of ["ŋutifafa", "nutifafa"]) expect(await titles(q)).toEqual(["Ŋutifafa"]);
    for (const q of ["kofi", "kɔfi", "KƆFI"]) expect(await names(q)).toEqual(["Kɔfi Awoonor"]);
  });
});
