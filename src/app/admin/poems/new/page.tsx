import type { Metadata } from "next";
import { Suspense } from "react";
import { requireOnboardedEditor } from "@/server/auth/dal";
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
  await requireOnboardedEditor();
  return <PoemForm action={createPoemAction} />;
}
