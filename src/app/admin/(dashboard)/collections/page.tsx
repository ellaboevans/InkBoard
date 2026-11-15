import { LibraryIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { FlashToast } from "@/components/flash-toast";
import { COLLECTIONS_MAX } from "@/lib/collection-limits";
import { pluralCount } from "@/lib/plural";
import { requireOnboardedEditor } from "@/server/auth/dal";
import { listCollections } from "@/server/collections";
import { NewCollectionDialog } from "./collection-forms";

export const metadata: Metadata = { title: "Collections" };

export default function CollectionsPage({ searchParams }: PageProps<"/admin/collections">) {
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-8">
      <div>
        <h1 className="font-serif text-3xl">Collections</h1>
        <p className="mt-1 text-muted-foreground">
          Group poems into a sequence, like a cycle or a chapbook, so readers can read them in order.
        </p>
      </div>
      <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-muted" />}>
        <Collections searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Collections({ searchParams }: Pick<PageProps<"/admin/collections">, "searchParams">) {
  const editor = await requireOnboardedEditor();
  const [list, { deleted }] = await Promise.all([listCollections(editor.id), searchParams]);
  return (
    <>
      {deleted === "1" && (
        <FlashToast param="deleted" title="Collection deleted" description="Its poems are still yours, just not in a collection." />
      )}
      <section aria-labelledby="your-collections" className="grid gap-3">
        <h2 id="your-collections" className="font-serif text-xl">
          Your collections
        </h2>
        {list.length === 0 ? (
          <p className="rounded-xl border border-dashed bg-card px-4 py-10 text-center text-muted-foreground">
            No collections yet.
          </p>
        ) : (
          <ul className="grid gap-2">
            {list.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/admin/collections/${c.id}`}
                  className="flex items-center gap-3 rounded-xl border bg-card p-4 hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <LibraryIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-serif text-lg">{c.title}</span>
                    {c.intro && <span className="block truncate text-sm text-muted-foreground">{c.intro}</span>}
                  </span>
                  <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
                    {pluralCount(c.poemCount, "poem")}
                    {c.poemCount > c.publishedCount && <> · {c.publishedCount} published</>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      {list.length < COLLECTIONS_MAX ? (
        <div className="justify-self-start">
          <NewCollectionDialog />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">You have the most collections allowed ({COLLECTIONS_MAX}).</p>
      )}
    </>
  );
}
