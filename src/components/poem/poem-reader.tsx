import { LockOpenIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { DialogTitle } from "@/components/ui/dialog";
import { PoemBody } from "./poem-body";
import { getReaderPoem } from "@/server/board-cache";
import { getUnlockedBody } from "@/server/unlock-cookie";
import { unlockPoemAction } from "./unlock-actions";
import { UnlockForm } from "./unlock-form";

/*
 * The reading view, shared by the full page (/p/[author]/[poem]) and the
 * overlay shown over the board (@modal/(.)p/[author]/[poem]).
 * Public text comes from the cached loader; private text only from the
 * per-reader unlock check, behind its own Suspense boundary (N1).
 */

const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "long" });

export async function PoemReader({
  params,
  inDialog = false,
}: {
  params: Promise<{ author: string; poem: string }>;
  /**
   * In the board overlay, the poem title is the dialog's title. Radix gives
   * it an id unique to this dialog instance, so a previous overlay kept
   * hidden in <Activity> can't lend the dialog its (stale) name.
   */
  inDialog?: boolean;
}) {
  const { author, poem: slug } = await params;
  const poem = await getReaderPoem(author, slug);
  if (!poem) notFound();

  return (
    <article>
      <header className="mb-8 sm:mb-10">
        <PoemTitle inDialog={inDialog}>{poem.title}</PoemTitle>
        <p className="mt-3 text-muted-foreground">
          by{" "}
          <Link href={`/a/${poem.authorSlug}`} className="text-foreground underline-offset-4 hover:underline">
            {poem.penName}
          </Link>
          {poem.publishedAt && <> · {dateFormat.format(new Date(poem.publishedAt))}</>}
        </p>
      </header>
      {poem.visibility === "public" ? (
        <PoemBody body={poem.body ?? ""} />
      ) : (
        // Per-reader: reads the unlock cookie, so it streams in separately.
        <Suspense fallback={<div className="h-48 animate-pulse rounded-2xl bg-muted" />}>
          <PrivatePoem author={author} slug={slug} penName={poem.penName} sharedPassword={poem.sharedPassword} />
        </Suspense>
      )}
    </article>
  );
}

function PoemTitle({ inDialog, children }: { inDialog: boolean; children: React.ReactNode }) {
  const h1 = <h1 className="font-serif text-3xl leading-tight tracking-tight sm:text-5xl">{children}</h1>;
  return inDialog ? <DialogTitle asChild>{h1}</DialogTitle> : h1;
}

export function PoemReaderSkeleton({ inDialog = false }: { inDialog?: boolean }) {
  return (
    <div className="grid animate-pulse gap-4" aria-busy>
      {/* Radix needs a title while the poem loads; replaced by the real one. */}
      {inDialog && <DialogTitle className="sr-only">Loading poem</DialogTitle>}
      <div className="h-10 w-2/3 rounded-md bg-muted" />
      <div className="h-4 w-40 rounded bg-muted" />
      <div className="mt-6 h-48 rounded-xl bg-muted" />
    </div>
  );
}


async function PrivatePoem({
  author,
  slug,
  penName,
  sharedPassword,
}: {
  author: string;
  slug: string;
  penName: string;
  sharedPassword: boolean;
}) {
  const body = await getUnlockedBody(author, slug);
  if (body !== null) {
    return (
      <>
        <p className="mb-6 flex items-center gap-1.5 text-xs text-muted-foreground">
          <LockOpenIcon className="size-3.5" aria-hidden />
          Unlocked on this device
        </p>
        <PoemBody body={body} />
      </>
    );
  }
  return (
    <UnlockForm
      action={unlockPoemAction.bind(null, author, slug)}
      penName={penName}
      sharedPassword={sharedPassword}
    />
  );
}
