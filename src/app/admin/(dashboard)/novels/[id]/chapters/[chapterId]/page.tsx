import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { firstAddedLine } from "@/lib/line-diff";
import { chapterDisplayTitle } from "@/lib/novel-limits";
import { requireOnboardedEditor } from "@/server/auth/dal";
import { getChapter, getChapterRevision, getNovel, listChapterRevisions } from "@/server/novels";
import { EditorSkeleton } from "../../../../poems/skeleton";
import { ChapterEditor } from "../../../chapter-editor";

export const metadata: Metadata = { title: "Edit chapter" };

// Formatted here, not in the browser, so server and client agree (like updatedLabel).
const savedFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
const savedLabel = (d: Date) => `${savedFormat.format(d)} UTC`;
const PREVIEW_CHARS = 80;
const firstLine = (body: string) => body.split("\n").find((l) => l.trim())?.slice(0, PREVIEW_CHARS) ?? "";

export default function EditChapterPage(props: PageProps<"/admin/novels/[id]/chapters/[chapterId]">) {
  return (
    <Suspense fallback={<EditorSkeleton />}>
      <EditChapter {...props} />
    </Suspense>
  );
}

async function EditChapter({ params, searchParams }: PageProps<"/admin/novels/[id]/chapters/[chapterId]">) {
  const editor = await requireOnboardedEditor();
  const { id, chapterId } = await params;
  // Both scoped to the signed-in editor; the chapter must also be this novel's.
  const [novel, chapter] = await Promise.all([getNovel(editor.id, id), getChapter(editor.id, chapterId)]);
  if (!novel || !chapter || chapter.novelId !== novel.id) notFound();
  const { created, version } = await searchParams;
  const [revisions, selected] = await Promise.all([
    listChapterRevisions(editor.id, chapter.id),
    typeof version === "string" ? getChapterRevision(editor.id, chapter.id, version) : null,
  ]);
  const index = novel.chapters.findIndex((c) => c.id === chapter.id);
  const neighbour = (i: number) => {
    const c = novel.chapters[i];
    return c ? { id: c.id, label: chapterDisplayTitle(c.title, i + 1), n: i + 1 } : null;
  };
  const currentId = revisions[0]?.id;

  return (
    <ChapterEditor
      // Fresh state per chapter (Previous/Next keep the same component otherwise).
      key={chapter.id}
      novel={{ id: novel.id, title: novel.title, language: novel.language }}
      chapter={{
        id: chapter.id,
        title: chapter.title,
        body: chapter.body,
        status: chapter.status,
        position: index + 1,
        total: novel.chapters.length,
        updatedAt: chapter.updatedAt.getTime(),
        savedLabel: savedLabel(chapter.updatedAt),
      }}
      publishedCount={novel.chapters.filter((c) => c.status === "published").length}
      prev={neighbour(index - 1)}
      next={neighbour(index + 1)}
      justCreated={created === "1"}
      history={revisions.map((r, i) => ({
        id: r.id,
        savedLabel: savedLabel(r.savedAt),
        title: chapterDisplayTitle(r.title, index + 1),
        // What this save changed (the first line it added), else its first line.
        preview: (revisions[i + 1] && firstAddedLine(revisions[i + 1].body, r.body))?.slice(0, PREVIEW_CHARS) ?? firstLine(r.body),
        current: r.id === currentId,
      }))}
      selectedVersion={
        selected && {
          id: selected.id,
          savedLabel: savedLabel(selected.savedAt),
          title: selected.title,
          body: selected.body,
          current: selected.id === currentId,
        }
      }
    />
  );
}
