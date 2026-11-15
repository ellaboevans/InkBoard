import type { Metadata } from "next";
import { Suspense } from "react";
import { requireOnboardedEditor } from "@/server/auth/dal";
import { collectionOptions } from "@/server/collections";
import { getPasswordMode } from "@/server/password-settings";
import { createPoemAction } from "../actions";
import { PoemForm } from "../poem-form";
import { EditorSkeleton } from "../skeleton";

export const metadata: Metadata = { title: "New poem" };

export default function NewPoemPage() {
  return (
    <Suspense fallback={<EditorSkeleton />}>
      <NewPoem />
    </Suspense>
  );
}

async function NewPoem() {
  const editor = await requireOnboardedEditor();
  const [passwordMode, collections] = await Promise.all([getPasswordMode(editor.id), collectionOptions(editor.id)]);
  return (
    <PoemForm action={createPoemAction} passwordMode={passwordMode} penName={editor.penName} collections={collections} />
  );
}
