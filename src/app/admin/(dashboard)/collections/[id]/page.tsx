import { ArrowLeftIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { FlashToast } from "@/components/flash-toast";
import { Button } from "@/components/ui/button";
import { requireOnboardedEditor } from "@/server/auth/dal";
import { getCollection, poemsWithoutCollection } from "@/server/collections";
import { EditCollectionDialog } from "../collection-forms";
import { CollectionOrder, DeleteCollection } from "../collection-order";

export const metadata: Metadata = { title: "Edit collection" };

export default function EditCollectionPage(props: PageProps<"/admin/collections/[id]">) {
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2 justify-self-start">
        <Link href="/admin/collections">
          <ArrowLeftIcon />
          All collections
        </Link>
      </Button>
      <Suspense fallback={<div className="h-96 animate-pulse rounded-xl bg-muted" />}>
        <EditCollection {...props} />
      </Suspense>
    </div>
  );
}

async function EditCollection({ params, searchParams }: PageProps<"/admin/collections/[id]">) {
  const editor = await requireOnboardedEditor();
  const { id } = await params;
  // Scoped to the signed-in editor: someone else's collection is simply "not found".
  const [collection, available, { created }] = await Promise.all([
    getCollection(editor.id, id),
    poemsWithoutCollection(editor.id),
    searchParams,
  ]);
  if (!collection) notFound();

  return (
    <>
      {created === "1" && (
        <FlashToast param="created" title="Collection created" description="Now add poems and put them in order." />
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-serif text-3xl break-words">{collection.title}</h1>
          {collection.intro && <p className="mt-1 whitespace-pre-line text-muted-foreground">{collection.intro}</p>}
        </div>
        <EditCollectionDialog
          collectionId={collection.id}
          title={collection.title}
          intro={collection.intro ?? ""}
          slug={collection.slug}
        />
      </div>
      <CollectionOrder
        collectionId={collection.id}
        poems={collection.poems.map(({ id, title, status, visibility }) => ({ id, title, status, visibility }))}
        available={available}
      />
      <DeleteCollection title={collection.title} collectionId={collection.id} />
    </>
  );
}
