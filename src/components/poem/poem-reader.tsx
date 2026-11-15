import { LockOpenIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { languageName } from "@/lib/poem-languages";
import { OVERLAY_LOADING_ID, poemTitleId } from "@/lib/poem-overlay";
import { CollectionNav, CollectionPart } from "./collection-nav";
import { OverlayPoemLoading, OverlayPoemShown } from "./overlay-poem-shown";
import { PoemBody } from "./poem-body";
import { getReaderPoem } from "@/server/board-cache";
import { getUnlockedBody } from "@/server/unlock-cookie";
import { unlockPoemAction } from "./unlock-actions";
import { UnlockForm } from "./unlock-form";
import { PoemOpened } from "@/components/install/install-nudge";

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
   * In the board overlay (src/app/@modal/(.)p): the h1 gets an id from this
   * poem's author and slug, which the overlay shell's aria-labelledby points
   * at for the current URL, so a poem kept hidden in <Activity> can never
   * lend the dialog its (stale) name; and the title is focused when shown.
   */
  inDialog?: boolean;
}) {
  const { author, poem: slug } = await params;
  const poem = await getReaderPoem(author, slug);
  if (!poem) notFound();

  // In the overlay the h1 names the dialog (src/lib/poem-overlay.ts), and is
  // focused when this poem is shown; "Part n of m" is read with it.
  const titleId = poemTitleId(poem.authorSlug, poem.slug);
  const partId = poem.collection ? `${titleId}--part` : undefined;
  return (
    <article>
      <header className="mb-8 sm:mb-10">
        {poem.collection && <CollectionPart id={partId} collection={poem.collection} authorSlug={poem.authorSlug} />}
        <PoemTitle inDialog={inDialog} lang={poem.language} id={inDialog ? titleId : undefined} describedBy={inDialog ? partId : undefined}>
          {poem.title}
        </PoemTitle>
        {inDialog && <OverlayPoemShown titleId={titleId} />}
        {/* Two poems opened is one of the install nudge's triggers (idempotent per poem). */}
        <PoemOpened id={`${poem.authorSlug}/${poem.slug}`} />
        <p className="mt-3 text-muted-foreground">
          by{" "}
          <Link href={`/a/${poem.authorSlug}`} className="text-foreground underline-offset-4 hover:underline">
            {poem.penName}
          </Link>
          {poem.publishedAt && <> · {dateFormat.format(new Date(poem.publishedAt))}</>}
          {languageName(poem.language) && <> · in {languageName(poem.language)}</>}
        </p>
      </header>
      {poem.visibility === "public" ? (
        <PoemBody body={poem.body ?? ""} lang={poem.language} />
      ) : (
        // Per-reader: reads the unlock cookie, so it streams in separately.
        <Suspense fallback={<div className="h-48 animate-pulse rounded-2xl bg-muted" />}>
          <PrivatePoem
            author={author}
            slug={slug}
            penName={poem.penName}
            sharedPassword={poem.sharedPassword}
            lang={poem.language}
          />
        </Suspense>
      )}
      {poem.collection && <CollectionNav collection={poem.collection} authorSlug={poem.authorSlug} inDialog={inDialog} />}
    </article>
  );
}

function PoemTitle({
  inDialog,
  lang,
  id,
  describedBy,
  children,
}: {
  inDialog: boolean;
  lang: string | null;
  id?: string;
  describedBy?: string;
  children: React.ReactNode;
}) {
  return (
    <h1
      id={id}
      lang={lang ?? undefined}
      aria-describedby={describedBy}
      // Focusable from script only (OverlayPoemShown), so it can't be tabbed to.
      tabIndex={inDialog ? -1 : undefined}
      className="font-serif text-3xl leading-tight tracking-tight outline-none sm:text-5xl"
    >
      {children}
    </h1>
  );
}

export function PoemReaderSkeleton({ inDialog = false }: { inDialog?: boolean }) {
  return (
    <div className="grid animate-pulse gap-4" aria-busy>
      {/* Names the overlay while the poem loads (poem-modal.tsx). */}
      {inDialog && (
        <>
          <span id={OVERLAY_LOADING_ID} className="sr-only">
            Loading poem
          </span>
          <OverlayPoemLoading />
        </>
      )}
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
  lang,
}: {
  author: string;
  slug: string;
  penName: string;
  sharedPassword: boolean;
  /** Only the unlocked poem text gets it; the unlock form is English UI. */
  lang: string | null;
}) {
  const body = await getUnlockedBody(author, slug);
  if (body !== null) {
    return (
      <>
        <p className="mb-6 flex items-center gap-1.5 text-xs text-muted-foreground">
          <LockOpenIcon className="size-3.5" aria-hidden />
          Unlocked on this device
        </p>
        <PoemBody body={body} lang={lang} />
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
