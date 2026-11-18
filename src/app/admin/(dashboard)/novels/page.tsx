import { BookOpenIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { FlashToast } from "@/components/flash-toast";
import { NOVELS_MAX } from "@/lib/novel-limits";
import { requireOnboardedEditor } from "@/server/auth/dal";
import { listNovels } from "@/server/novels";
import { NewNovelDialog } from "./novel-forms";

export const metadata: Metadata = { title: "Novels" };

// Formatted on the server, so server and client agree (like updatedLabel).
const dayFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" });

export default function NovelsPage({ searchParams }: PageProps<"/admin/novels">) {
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-8">
      <div>
        <h1 className="font-serif text-3xl">Novels</h1>
        <p className="mt-1 text-muted-foreground">
          Books in chapters, published one chapter at a time. A short story is a novel with one chapter.
        </p>
      </div>
      <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-muted" />}>
        <Novels searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Novels({ searchParams }: Pick<PageProps<"/admin/novels">, "searchParams">) {
  const editor = await requireOnboardedEditor();
  const [list, { deleted }] = await Promise.all([listNovels(editor.id), searchParams]);
  return (
    <>
      {deleted === "1" && <FlashToast param="deleted" title="Novel deleted" description="Its chapters went with it." />}
      <section aria-labelledby="your-novels" className="grid gap-3">
        <h2 id="your-novels" className="font-serif text-xl">
          Your novels
        </h2>
        {list.length === 0 ? (
          <p className="rounded-xl border border-dashed bg-card px-4 py-10 text-center text-muted-foreground">
            No novels yet. Start one, and add its chapters as you write them.
          </p>
        ) : (
          // minmax(0,1fr): long titles truncate instead of widening the page.
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-2">
            {list.map((n) => (
              <li key={n.id}>
                <Link
                  href={`/admin/novels/${n.id}`}
                  data-novel-link={n.id}
                  className="flex min-h-11 items-center gap-3 rounded-xl border bg-card p-4 hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <BookOpenIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-serif text-lg">{n.title}</span>
                    <span className="mt-0.5 flex flex-wrap gap-x-2 text-sm text-muted-foreground">
                      <span>{n.status === "complete" ? "Complete" : "Ongoing"}</span>
                      {n.visibility === "private" && (
                        <>
                          <span aria-hidden>·</span>
                          <span>Password protected</span>
                        </>
                      )}
                      <span aria-hidden>·</span>
                      <span className="tabular-nums">
                        {n.publishedCount} of {n.chapterCount} {n.chapterCount === 1 ? "chapter" : "chapters"} published
                      </span>
                      <span aria-hidden>·</span>
                      <span>Edited {dayFormat.format(n.updatedAt)}</span>
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      {list.length < NOVELS_MAX ? (
        <div className="justify-self-start">
          <NewNovelDialog />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">You have the most novels allowed ({NOVELS_MAX}).</p>
      )}
    </>
  );
}
