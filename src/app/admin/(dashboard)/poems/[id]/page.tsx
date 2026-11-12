import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { requireOnboardedEditor } from "@/server/auth/dal";
import { getPasswordMode } from "@/server/password-settings";
import { getEditorPoem } from "@/server/poems";
import { deletePoemAction, updatePoemAction } from "../actions";
import { PoemForm } from "../poem-form";
import { EditorSkeleton } from "../skeleton";

export const metadata: Metadata = { title: "Edit poem" };

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
  const { created } = await searchParams;
  const passwordMode = await getPasswordMode(editor.id);

  return (
    <PoemForm
      // Remount with fresh state if the editor navigates between poems.
      key={poem.id}
      action={updatePoemAction.bind(null, poem.id)}
      deleteAction={deletePoemAction.bind(null, poem.id)}
      justCreated={created === "1"}
      passwordMode={passwordMode}
      penName={editor.penName}
      poem={{
        id: poem.id,
        title: poem.title,
        body: poem.body,
        visibility: poem.visibility,
        status: poem.status,
        hasPassword: poem.hasPassword,
      }}
    />
  );
}
