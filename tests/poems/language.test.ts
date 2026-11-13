import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { editors } from "@/db/schema";
import { languageName, POEM_LANGUAGE_CODES, POEM_LANGUAGES } from "@/lib/poem-languages";
import { loadAuthorPage, loadBoardSections, loadReaderPoem } from "@/server/board";
import { createPoem, getEditorPoem, listEditorPoems, updatePoem, type PoemInput } from "@/server/poems";

// A poem's language (docs/PLAN.md, Phase 11c).
const db = getDb();

async function editor() {
  const [e] = await db
    .insert(editors)
    .values({ email: "kofi@example.com", penName: "Kɔfi", slug: "kofi" })
    .returning();
  return e.id;
}
const input = (over: Partial<PoemInput> = {}): PoemInput => ({
  title: "Ŋutifafa",
  body: "Ŋutifafa na wò",
  visibility: "public",
  status: "published",
  ...over,
});

describe("poem languages", () => {
  it("are valid BCP 47 tags, with Akan covering Twi, Fante and Nzema", () => {
    for (const code of POEM_LANGUAGE_CODES) expect(Intl.getCanonicalLocales(code)).toEqual([code]);
    expect(POEM_LANGUAGES.map((l) => l.short)).toEqual(["Akan", "Ewe", "Ga", "English"]);
    expect(POEM_LANGUAGES[0].label).toBe("Akan (Twi, Fante, Nzema)");
    expect(languageName("ee")).toBe("Ewe");
    expect(languageName(null)).toBeNull();
    expect(languageName("xx")).toBeNull();
  });

  it("is saved, changed and cleared with the poem; empty means not set", async () => {
    const id = await editor();
    const created = await createPoem(id, input({ language: "ee" }));
    if (!created.ok) throw new Error(JSON.stringify(created.errors));
    expect((await getEditorPoem(id, created.poem.id))?.language).toBe("ee");

    expect(await updatePoem(id, created.poem.id, input({ language: "gaa" }))).toMatchObject({ ok: true });
    expect((await listEditorPoems(id))[0].language).toBe("gaa");

    expect(await updatePoem(id, created.poem.id, input({ language: "" }))).toMatchObject({ ok: true });
    expect((await getEditorPoem(id, created.poem.id))?.language).toBeNull();

    const untagged = await createPoem(id, input({ title: "Untagged" }));
    if (!untagged.ok) throw new Error(JSON.stringify(untagged.errors));
    expect((await getEditorPoem(id, untagged.poem.id))?.language).toBeNull();
  });

  it("rejects a language that isn't on the list", async () => {
    const id = await editor();
    expect(await createPoem(id, input({ language: "xx" }))).toEqual({
      ok: false,
      errors: { language: "Choose a language from the list" },
    });
    expect(await createPoem(id, input({ language: "<script>" }))).toMatchObject({ ok: false });
  });

  it("reaches every reader view: board, reading page and author page", async () => {
    const id = await editor();
    const res = await createPoem(id, input({ language: "ee" }));
    if (!res.ok) throw new Error(JSON.stringify(res.errors));
    const priv = await createPoem(id, input({ title: "Ɔdɔ", language: "ak", visibility: "private", password: "secret-1" }));
    if (!priv.ok) throw new Error(JSON.stringify(priv.errors));

    const [section] = await loadBoardSections();
    expect(Object.fromEntries(section.poems.map((p) => [p.title, p.language]))).toEqual({ Ŋutifafa: "ee", Ɔdɔ: "ak" });
    expect((await loadReaderPoem("kofi", res.poem.slug))?.language).toBe("ee");
    // Private poems still show their language (like their title), never their text.
    const privateReader = await loadReaderPoem("kofi", priv.poem.slug);
    expect(privateReader).toMatchObject({ language: "ak", body: null });
    const page = await loadAuthorPage("kofi");
    expect(page?.poems.map((p) => p.language).sort()).toEqual(["ak", "ee"]);
  });
});
