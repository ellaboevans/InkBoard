import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { requireOnboardedEditor } from "@/server/auth/dal";
import { collectionOptions } from "@/server/collections";
import { getPasswordMode } from "@/server/password-settings";
import { firstAddedLine } from "@/lib/line-diff";
import { getPoemRevision, listPoemRevisions, PREVIEW_CHARS } from "@/server/poem-history";
import { getEditorPoem } from "@/server/poems";
import { deletePoemAction, updatePoemAction } from "../actions";
import { PoemForm } from "../poem-form";
import { EditorSkeleton } from "../skeleton";

export const metadata: Metadata = { title: "Edit poem" };

// Formatted here, not in the browser, so server and client agree (like updatedLabel).
const savedFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
const savedLabel = (d: Date) => `${savedFormat.format(d)} UTC`;

export default function EditPoemPage(props: PageProps<"/admin/poems/[id]">) {
  return (
    <Suspense fallback={<EditorSkeleton />}>
      <EditPoem {...props} />
    </Suspense>
  );
}

async function EditPoem({ params, searchParams }: PageProps<"/admin/poems/[id]">) {
  const editor = await requireOnboardedEditor();
  const { id } = await params;
  // Scoped to the signed-in editor: someone else's poem is simply "not found".
  const poem = await getEditorPoem(editor.id, id);
  if (!poem) notFound();
  const { created, version } = await searchParams;
  const [passwordMode, collections, revisions, selected] = await Promise.all([
    getPasswordMode(editor.id),
    collectionOptions(editor.id),
    // History is editor-only: scoped by the DAL-resolved id, like the poem.
    listPoemRevisions(editor.id, poem.id),
    typeof version === "string" ? getPoemRevision(editor.id, poem.id, version) : null,
  ]);
  const currentId = revisions[0]?.id;

  return (
    <PoemForm
      // Remount with fresh state if the editor navigates between poems.
      key={poem.id}
      action={updatePoemAction.bind(null, poem.id)}
      deleteAction={deletePoemAction.bind(null, poem.id)}
      justCreated={created === "1"}
      passwordMode={passwordMode}
      penName={editor.penName}
      collections={collections}
      history={revisions.map((r, i) => ({
        id: r.id,
        savedLabel: savedLabel(r.savedAt),
        title: r.title,
        // What this save changed: the first line it added to the version
        // before it (else its first line), so similar versions look different.
        preview: (revisions[i + 1] && firstAddedLine(revisions[i + 1].body, r.body))?.slice(0, PREVIEW_CHARS) ?? r.preview,
        current: r.id === currentId,
      }))}
      selectedVersion={
        selected && {
          id: selected.id,
          savedLabel: savedLabel(selected.savedAt),
          title: selected.title,
          body: selected.body,
          language: selected.language,
          current: selected.id === currentId,
        }
      }
      poem={{
        id: poem.id,
        title: poem.title,
        body: poem.body,
        visibility: poem.visibility,
        language: poem.language,
        collectionId: poem.collectionId,
        status: poem.status,
        hasPassword: poem.hasPassword,
      }}
    />
  );
}
