import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { editors, passkeys, poems, recoveryCodes } from "@/db/schema";
import { checklistSteps, doneCount, nextStep, type ChecklistFacts } from "@/lib/welcome-checklist";
import { getWelcomeChecklist, hideChecklist, loadChecklistFacts, markAuthorPageShared } from "@/server/welcome-checklist";

// The dashboard's welcome checklist (docs/PLAN.md, Phase 20).
const db = getDb();
let n = 0;

async function editor(extra: Partial<typeof editors.$inferInsert> = {}) {
  n++;
  const [e] = await db
    .insert(editors)
    .values({ email: `w${n}@example.com`, penName: `Writer ${n}`, slug: `writer-${n}`, ...extra })
    .returning();
  return e.id;
}
const poem = (editorId: string, status: "draft" | "published" = "published", visibility: "public" | "private" = "public") =>
  db.insert(poems).values({
    editorId,
    title: `P ${++n}`,
    slug: `p-${n}`,
    body: "a line",
    status,
    visibility,
    passwordHash: visibility === "private" ? "x" : null,
    publishedAt: status === "published" ? new Date() : null,
  });
const codes = (editorId: string) => db.insert(recoveryCodes).values({ editorId, codeHash: `hash-${++n}` });
const passkey = (editorId: string) =>
  db.insert(passkeys).values({ editorId, credentialId: `cred-${++n}`, publicKey: "pk", deviceType: "singleDevice", name: "Laptop" });

const done = async (id: string) => {
  const c = await getWelcomeChecklist(id);
  return c?.kind === "steps" ? c.steps.filter((s) => s.done).map((s) => s.id) : c;
};

/** Every step done for this editor. */
async function finish(id: string) {
  await db.update(editors).set({ avatar: "a03", tagline: "Poems for slow mornings" }).where(eq(editors.id, id));
  await poem(id);
  await codes(id);
  expect(await markAuthorPageShared(id)).toBe(true);
}

describe("deriving the steps from real data", () => {
  it("a new writer starts with the pen name done: 1 of 6, next is the avatar", async () => {
    const id = await editor();
    const c = await getWelcomeChecklist(id);
    expect(c?.kind).toBe("steps");
    if (c?.kind !== "steps") return;
    expect(c.steps.map((s) => s.id)).toEqual(["pen-name", "avatar", "about", "publish", "way-in", "share"]);
    expect(doneCount(c.steps)).toBe(1);
    expect(nextStep(c.steps)?.id).toBe("avatar");
    // Sharing waits for a published poem.
    expect(c.steps.find((s) => s.id === "share")).toMatchObject({ done: false, waiting: true });
  });

  it("avatar: done only when chosen (null is the derived default)", async () => {
    const id = await editor();
    expect(await done(id)).not.toContain("avatar");
    await db.update(editors).set({ avatar: "a05" }).where(eq(editors.id, id));
    expect(await done(id)).toContain("avatar");
  });

  it("about: a tagline or a bio, not blank space", async () => {
    const a = await editor({ bio: "   " });
    expect(await done(a)).not.toContain("about");
    const b = await editor({ tagline: "Short lines" });
    expect(await done(b)).toContain("about");
    const c = await editor({ bio: "From Keta." });
    expect(await done(c)).toContain("about");
  });

  it("publish: a published poem, public or private; a draft doesn't count", async () => {
    const id = await editor();
    await poem(id, "draft");
    expect(await done(id)).not.toContain("publish");
    const priv = await editor();
    await poem(priv, "published", "private");
    expect(await done(priv)).toContain("publish");
  });

  it("a way in: recovery codes or a passkey; 'Not now' only skips the nudge", async () => {
    const a = await editor();
    await codes(a);
    expect(await done(a)).toContain("way-in");
    const b = await editor();
    await passkey(b);
    expect(await done(b)).toContain("way-in");
    const c = await editor({ recoveryPromptDismissedAt: new Date() });
    const steps = (await getWelcomeChecklist(c)) as { kind: "steps"; steps: ReturnType<typeof checklistSteps> };
    expect(steps.steps.find((s) => s.id === "way-in")).toMatchObject({ done: false, skipped: true });
    await db.update(editors).set({ avatar: "a01", bio: "x" }).where(eq(editors.id, c));
    await poem(c);
    // Skipped isn't suggested next: sharing is.
    expect(nextStep(((await getWelcomeChecklist(c)) as { steps: ReturnType<typeof checklistSteps> }).steps)?.id).toBe("share");
  });

  it("share: marked only once a poem is published, and only the first time is kept", async () => {
    const id = await editor();
    expect(await markAuthorPageShared(id)).toBe(false);
    expect(await done(id)).not.toContain("share");
    await poem(id, "draft");
    expect(await markAuthorPageShared(id)).toBe(false);
    await poem(id);
    expect(await markAuthorPageShared(id)).toBe(true);
    const [first] = await db.select({ at: editors.authorPageSharedAt }).from(editors).where(eq(editors.id, id));
    expect(await markAuthorPageShared(id)).toBe(false);
    const [again] = await db.select({ at: editors.authorPageSharedAt }).from(editors).where(eq(editors.id, id));
    expect(again.at).toEqual(first.at);
    expect(await done(id)).toContain("share");
  });

  it("the pure rules match the facts one to one", () => {
    const none: ChecklistFacts = { hasPenName: true, hasAvatar: false, hasAbout: false, hasPublished: false, hasWayIn: false, hasShared: false, wayInSkipped: false };
    expect(doneCount(checklistSteps(none))).toBe(1);
    const all: ChecklistFacts = { ...none, hasAvatar: true, hasAbout: true, hasPublished: true, hasWayIn: true, hasShared: true };
    expect(doneCount(checklistSteps(all))).toBe(6);
    expect(nextStep(checklistSteps(all))).toBeNull();
  });
});

describe("scoping", () => {
  it("another editor's poems, codes, passkeys and shares never count", async () => {
    const me = await editor();
    const other = await editor({ avatar: "a02", tagline: "theirs" });
    await poem(other);
    await codes(other);
    await passkey(other);
    await markAuthorPageShared(other);
    expect(await done(me)).toEqual(["pen-name"]);
    // And marking a share needs my own published poem.
    expect(await markAuthorPageShared(me)).toBe(false);
  });

  it("an unknown editor has no checklist", async () => {
    expect(await getWelcomeChecklist("00000000-0000-4000-8000-000000000000")).toBeNull();
    expect(await loadChecklistFacts("00000000-0000-4000-8000-000000000000")).toBeNull();
  });
});

describe("hiding and finishing", () => {
  it("'Hide checklist' is permanent, whatever happens later", async () => {
    const id = await editor();
    await hideChecklist(id);
    expect(await getWelcomeChecklist(id)).toBeNull();
    await finish(id);
    // Finishing after hiding shows nothing: no "all set" either.
    expect(await getWelcomeChecklist(id)).toBeNull();
  });

  it("'You're all set' shows exactly once, then never again, even if steps come undone", async () => {
    const id = await editor();
    await finish(id);
    expect(await getWelcomeChecklist(id)).toEqual({ kind: "all-set" });
    expect(await getWelcomeChecklist(id)).toBeNull();
    // Losing the poem and the codes doesn't bring it back.
    await db.delete(poems).where(eq(poems.editorId, id));
    await db.delete(recoveryCodes).where(eq(recoveryCodes.editorId, id));
    expect(await getWelcomeChecklist(id)).toBeNull();
  });

  it("concurrent dashboard loads show 'all set' to only one of them", async () => {
    const id = await editor();
    await finish(id);
    const results = await Promise.all(Array.from({ length: 6 }, () => getWelcomeChecklist(id)));
    expect(results.filter((r) => r?.kind === "all-set")).toHaveLength(1);
    expect(results.filter((r) => r === null)).toHaveLength(5);
  });

  it("an editor whose checklist was already closed (all done before) never sees it or the message", async () => {
    const id = await editor({ checklistHiddenAt: new Date() });
    await finish(id);
    expect(await getWelcomeChecklist(id)).toBeNull();
  });

  it("an existing editor with only some steps done sees the checklist", async () => {
    const id = await editor({ avatar: "a04", bio: "Long-time writer" });
    await poem(id);
    expect(await done(id)).toEqual(["pen-name", "avatar", "about", "publish"]);
  });

  it("hiding one editor's checklist leaves another's", async () => {
    const a = await editor();
    const b = await editor();
    await hideChecklist(a);
    expect(await getWelcomeChecklist(b)).not.toBeNull();
  });
});
