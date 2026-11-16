"use server";

import { refresh, updateTag } from "next/cache";
import { redirect, RedirectType } from "next/navigation";
import { requireOnboardedEditor } from "@/server/auth/dal";
import { BOARD_TAG, poemTag } from "@/server/cache-tags";
import { createPoem, deletePoem, updatePoem, type PoemErrors } from "@/server/poems";
import { after } from "next/server";
import { announcePoem } from "@/server/push";

/**
 * Where an editor lands after a poem first goes on the board: their list, with
 * the poem highlighted and a toast (`published`), and the writer's install card
 * after their first-ever publish (`first-publish`, Phase 15).
 *
 * Every redirect from the editor *replaces* the history entry it was submitted
 * from, so Back never returns to the blank /admin/poems/new form (which could
 * create the poem twice) or to a draft that's since been published.
 */
function toListAfterPublish(poemId: string, firstPublish: boolean): never {
  refresh(); // the dashboard (and anything cached for Back) shows the new row
  redirect(`/admin?published=${poemId}${firstPublish ? "&first-publish=1" : ""}`, RedirectType.replace);
}

export type PoemFormState = {
  errors?: PoemErrors;
  /** Set on every successful save (lets the form reset its dirty state). */
  savedAt?: number;
  status?: "draft" | "published";
  visibility?: "public" | "private";
};

function readForm(formData: FormData) {
  const str = (k: string) => {
    const v = formData.get(k);
    return typeof v === "string" ? v : undefined;
  };
  return {
    title: str("title") ?? "",
    body: str("body") ?? "",
    visibility: str("visibility"),
    language: str("language"),
    // "" = none; an id = that collection (the end of it); see poems.ts.
    collection: str("collection"),
    // Which submit button was pressed ("Save draft" / "Publish" / …)
    status: str("status"),
    password: str("password"),
  };
}

function invalidate(poemId: string) {
  updateTag(BOARD_TAG);
  updateTag(poemTag(poemId));
}

/**
 * A poem's one announcement (Phase 18), claimed by the save transaction:
 * sent after the response, so the editor's save never waits on push services.
 */
function announceLater(poemId: string, announce: boolean) {
  if (!announce) return;
  after(() =>
    announcePoem(poemId).catch((e: unknown) => {
      console.error("[push] announcing a poem failed", e);
    }),
  );
}

export async function createPoemAction(
  _prev: PoemFormState,
  formData: FormData,
): Promise<PoemFormState> {
  // Identity always comes from the session, never from the form.
  const editor = await requireOnboardedEditor();
  const res = await createPoem(editor.id, readForm(formData));
  if (!res.ok) return { errors: res.errors };
  invalidate(res.poem.id);
  announceLater(res.poem.id, res.announce);
  if (res.publishedNow) toListAfterPublish(res.poem.id, res.firstPublish);
  // A draft: keep writing, on its own edit page (replacing the blank form in history).
  redirect(`/admin/poems/${res.poem.id}?created=1`, RedirectType.replace);
}

export async function updatePoemAction(
  poemId: string,
  _prev: PoemFormState,
  formData: FormData,
): Promise<PoemFormState> {
  const editor = await requireOnboardedEditor();
  const input = readForm(formData);
  const res = await updatePoem(editor.id, poemId, input);
  if (!res.ok) {
    if ("notFound" in res) {
      return { errors: { form: "This poem no longer exists or isn't yours." } };
    }
    return { errors: res.errors };
  }
  invalidate(poemId);
  announceLater(poemId, res.announce);
  // A draft going on the board for the first time: done, back to the list.
  if (res.publishedNow) toListAfterPublish(poemId, res.firstPublish);
  refresh(); // re-render server parts of the page (e.g. heading)
  return {
    savedAt: Date.now(),
    status: res.poem.status,
    visibility: input.visibility === "private" ? "private" : "public",
  };
}

export async function deletePoemAction(poemId: string): Promise<void> {
  const editor = await requireOnboardedEditor();
  const deleted = await deletePoem(editor.id, poemId);
  if (!deleted) redirect("/admin");
  invalidate(poemId);
  redirect("/admin?deleted=1");
}
