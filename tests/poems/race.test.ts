import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { editors, poems } from "@/db/schema";
import { createPoem, updatePoem, type PoemInput } from "@/server/poems";

const db = getDb();

describe("concurrent saves keep the password invariant", () => {
  it("public ⇒ no hash, private ⇒ hash, whatever the interleaving", async () => {
    const [ed] = await db.insert(editors).values({ email: "race@example.com" }).returning();
    const base: PoemInput = { title: "Race", body: "x", visibility: "public", status: "draft" };
    const created = await createPoem(ed.id, base);
    if (!created.ok) throw new Error("create failed");
    const id = created.poem.id;

    for (let round = 0; round < 40; round++) {
      // Two tabs saving different visibilities at once (+ a "keep current" save).
      await Promise.allSettled([
        updatePoem(ed.id, id, { ...base, visibility: "private", password: `pw-${round}-abc` }),
        updatePoem(ed.id, id, { ...base, visibility: "public" }),
        updatePoem(ed.id, id, { ...base, visibility: "private" }),
      ]);
      const [row] = await db.select().from(poems).where(eq(poems.id, id));
      expect(
        row.visibility === "public" ? row.passwordHash === null : row.passwordHash !== null,
        `round ${round}: ${row.visibility} with hash=${row.passwordHash !== null}`,
      ).toBe(true);
    }
  });

  it("never surfaces a database error to the editor", async () => {
    const [ed] = await db.insert(editors).values({ email: "race2@example.com" }).returning();
    const base: PoemInput = { title: "Race", body: "x", visibility: "private", status: "draft", password: "first-pw" };
    const created = await createPoem(ed.id, base);
    if (!created.ok) throw new Error("create failed");
    for (let round = 0; round < 40; round++) {
      const results = await Promise.allSettled([
        updatePoem(ed.id, created.poem.id, { ...base, visibility: "public" }),
        updatePoem(ed.id, created.poem.id, { ...base, password: "" }), // keep current
        updatePoem(ed.id, created.poem.id, { ...base, password: `pw-${round}-xyz` }),
      ]);
      const rejected = results.filter((r) => r.status === "rejected");
      expect(rejected.map((r) => String((r as PromiseRejectedResult).reason))).toEqual([]);
    }
  });
});
