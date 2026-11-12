import { ArrowLeftIcon, LockOpenIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { getReaderPoem } from "@/server/board-cache";
import { getUnlockedBody } from "@/server/unlock-cookie";
import { unlockPoemAction } from "./actions";
import { UnlockForm } from "./unlock-form";

type Props = PageProps<"/p/[author]/[poem]">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { author, poem } = await params;
  const p = await getReaderPoem(author, poem);
  if (!p) return { title: "Poem not found" };
  return { title: `${p.title} by ${p.penName}` };
}

export default function PoemPage(props: Props) {
  return (
    <main className="flex-1 bg-background">
      <div className="mx-auto max-w-2xl px-6 py-10 sm:py-16">
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-10">
          <Link href="/">
            <ArrowLeftIcon />
            Back to the board
          </Link>
        </Button>
        <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-muted" />}>
          <Poem {...props} />
        </Suspense>
      </div>
    </main>
  );
}

function PoemBody({ body }: { body: string }) {
  return <div className="font-serif text-xl leading-relaxed whitespace-pre-wrap">{body}</div>;
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

const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "long" });

async function Poem({ params }: Props) {
  const { author, poem: slug } = await params;
  const poem = await getReaderPoem(author, slug);
  if (!poem) notFound();

  return (
    <article>
      <header className="mb-10">
        <h1 className="font-serif text-4xl leading-tight tracking-tight sm:text-5xl">{poem.title}</h1>
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
