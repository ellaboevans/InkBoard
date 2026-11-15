"use server";

import { refresh, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { requireOnboardedEditor } from "@/server/auth/dal";
import { BOARD_TAG, poemTag } from "@/server/cache-tags";
import {
  createCollection,
  deleteCollection,
  moveCollectionPoem,
  setPoemCollection,
  updateCollection,
  type CollectionErrors,
} from "@/server/collections";

/*
 * Collections (docs/PLAN.md, Phase 14). Every action re-authorises through the
 * DAL; ids from the client are only ever looked up within the editor's own
 * collections and poems (src/server/collections.ts).
 *
 * Readers see a collection's title and its order on reading pages, which are
 * cached under BOARD_TAG, so every change readers could see invalidates it.
 */

export type CollectionFormState = { errors?: CollectionErrors; savedAt?: number };

const str = (formData: FormData, key: string) => {
  const v = formData.get(key);
  return typeof v === "string" ? v : undefined;
};

/** Readers' pages that show these poems' collection navigation. */
function invalidate(poemIds: string[] = []) {
  updateTag(BOARD_TAG);
  for (const id of poemIds) updateTag(poemTag(id));
}

export async function createCollectionAction(_prev: CollectionFormState, formData: FormData): Promise<CollectionFormState> {
  const editor = await requireOnboardedEditor();
  const res = await createCollection(editor.id, { title: str(formData, "title") ?? "", intro: str(formData, "intro") });
  if (!res.ok) return { errors: "errors" in res ? res.errors : { form: "Couldn't create the collection." } };
  // An empty collection shows nowhere for readers yet: no invalidation needed.
  refresh(); // the poem editor's picker
  redirect(`/admin/collections/${res.collection.id}?created=1`);
}

export async function updateCollectionAction(
  collectionId: string,
  _prev: CollectionFormState,
  formData: FormData,
): Promise<CollectionFormState> {
  const editor = await requireOnboardedEditor();
  const res = await updateCollection(editor.id, collectionId, {
    title: str(formData, "title") ?? "",
    intro: str(formData, "intro"),
  });
  if (!res.ok) {
    return { errors: "errors" in res ? res.errors : { form: "This collection no longer exists or isn't yours." } };
  }
  invalidate(); // its title is on every reading page in it
  refresh();
  return { savedAt: Date.now() };
}

export async function deleteCollectionAction(collectionId: string): Promise<void> {
  const editor = await requireOnboardedEditor();
  const left = await deleteCollection(editor.id, collectionId);
  if (!left) redirect("/admin/collections");
  invalidate(left);
  refresh();
  redirect("/admin/collections?deleted=1");
}

export type MoveActionResult =
  | { ok: true; position: number; total: number; title: string }
  | { ok: false; error: string };

export async function moveCollectionPoemAction(
  collectionId: string,
  poemId: string,
  direction: "up" | "down" | "first" | "last",
): Promise<MoveActionResult> {
  const editor = await requireOnboardedEditor();
  const res = await moveCollectionPoem(editor.id, collectionId, poemId, direction);
  if (!res.ok) return { ok: false, error: "This poem or collection no longer exists or isn't yours." };
  invalidate([poemId]);
  refresh();
  return res;
}

export type PlaceActionResult = { ok: true } | { ok: false; error: string };

/** Add one of the editor's poems to a collection (at the end), or take it out with null. */
export async function setPoemCollectionAction(poemId: string, collectionId: string | null): Promise<PlaceActionResult> {
  const editor = await requireOnboardedEditor();
  const res = await setPoemCollection(editor.id, poemId, collectionId);
  if (!res.ok) {
    return { ok: false, error: "error" in res ? res.error : "This poem or collection no longer exists or isn't yours." };
  }
  invalidate([poemId]);
  refresh();
  return { ok: true };
}
