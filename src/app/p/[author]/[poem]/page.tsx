import { ArrowLeftIcon, LockIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { getReaderPoem } from "@/server/board-cache";

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
      {poem.body !== null ? (
        <div className="font-serif text-xl leading-relaxed whitespace-pre-wrap">{poem.body}</div>
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed bg-card px-6 py-14 text-center">
          <LockIcon className="size-7 text-muted-foreground" aria-hidden />
          <p className="font-serif text-xl">This poem is password protected</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Unlocking with a password arrives in the next release.
          </p>
        </div>
      )}
    </article>
  );
}
