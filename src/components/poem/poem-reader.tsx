import { LockOpenIcon } from "lucide-react";
import { notFound } from "next/navigation";
import { Suspense } from "react";
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
  headingId,
}: {
  params: Promise<{ author: string; poem: string }>;
  /** Lets a dialog point aria-labelledby at the poem title. */
  headingId?: string;
}) {
  const { author, poem: slug } = await params;
  const poem = await getReaderPoem(author, slug);
  if (!poem) notFound();

  return (
    <article>
      <header className="mb-8 sm:mb-10">
        <h1 id={headingId} className="font-serif text-3xl leading-tight tracking-tight sm:text-5xl">
          {poem.title}
        </h1>
        <p className="mt-3 text-muted-foreground">
          by <span className="text-foreground">{poem.penName}</span>
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

export function PoemReaderSkeleton() {
  return (
    <div className="grid animate-pulse gap-4" aria-busy>
      <div className="h-10 w-2/3 rounded-md bg-muted" />
      <div className="h-4 w-40 rounded bg-muted" />
      <div className="mt-6 h-48 rounded-xl bg-muted" />
    </div>
  );
}

function PoemBody({ body }: { body: string }) {
  return (
    <div className="font-serif text-lg leading-relaxed whitespace-pre-wrap sm:text-xl">{body}</div>
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
