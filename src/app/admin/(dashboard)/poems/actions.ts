"use server";

import { refresh, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { requireOnboardedEditor } from "@/server/auth/dal";
import { BOARD_TAG, poemTag } from "@/server/cache-tags";
import { createPoem, deletePoem, updatePoem, type PoemErrors } from "@/server/poems";

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
    // Which submit button was pressed ("Save draft" / "Publish" / …)
    status: str("status"),
    password: str("password"),
  };
}

function invalidate(poemId: string) {
  updateTag(BOARD_TAG);
  updateTag(poemTag(poemId));
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
  redirect(`/admin/poems/${res.poem.id}?created=1`);
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
