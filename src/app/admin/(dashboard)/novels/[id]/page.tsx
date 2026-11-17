import { ArrowLeftIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { FlashToast } from "@/components/flash-toast";
import { Button } from "@/components/ui/button";
import { requireOnboardedEditor } from "@/server/auth/dal";
import { getNovel } from "@/server/novels";
import { ChapterOrder, DeleteNovel } from "../chapter-order";
import { NovelDetailsForm } from "../novel-forms";

export const metadata: Metadata = { title: "Edit novel" };

const dayFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" });

export default function EditNovelPage(props: PageProps<"/admin/novels/[id]">) {
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2 justify-self-start max-sm:h-11">
        <Link href="/admin/novels">
          <ArrowLeftIcon />
          All novels
        </Link>
      </Button>
      <Suspense fallback={<div className="h-96 animate-pulse rounded-xl bg-muted" />}>
        <EditNovel {...props} />
      </Suspense>
    </div>
  );
}

async function EditNovel({ params, searchParams }: PageProps<"/admin/novels/[id]">) {
  const editor = await requireOnboardedEditor();
  const { id } = await params;
  // Scoped to the signed-in editor: someone else's novel is simply "not found".
  const [novel, flags] = await Promise.all([getNovel(editor.id, id), searchParams]);
  if (!novel) notFound();
  return (
    <>
      {flags.created === "1" && (
        <FlashToast param="created" title="Novel created" description="Add its first chapter when you're ready." />
      )}
      {flags["chapter-deleted"] === "1" && <FlashToast param="chapter-deleted" title="Chapter deleted" />}
      <div className="min-w-0">
        <h1 className="font-serif text-3xl break-words">{novel.title}</h1>
        <p className="mt-1 text-muted-foreground">
          {novel.status === "complete" ? "Complete" : "Ongoing"} · Readers can&apos;t see novels yet: they come to the board
          soon. Until then, write and publish chapters here.
        </p>
      </div>
      <ChapterOrder
        novelId={novel.id}
        chapters={novel.chapters.map((c) => ({
          id: c.id,
          title: c.title,
          status: c.status,
          wordCount: c.wordCount,
          updatedLabel: dayFormat.format(c.updatedAt),
        }))}
      />
      <NovelDetailsForm
        key={novel.id}
        novelId={novel.id}
        slug={novel.slug}
        initial={{ title: novel.title, blurb: novel.blurb ?? "", language: novel.language ?? "", status: novel.status }}
      />
      <DeleteNovel title={novel.title} novelId={novel.id} chapterCount={novel.chapters.length} />
    </>
  );
}
