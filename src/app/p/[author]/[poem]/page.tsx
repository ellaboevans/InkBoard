import { ArrowLeftIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PoemReader, PoemReaderSkeleton } from "@/components/poem/poem-reader";
import { Button } from "@/components/ui/button";
import { JsonLd } from "@/components/seo/json-ld";
import { stripPoemMarkdown } from "@/lib/poem-markdown";
import { AuthorFeedLink } from "@/components/feeds/feed-link";
import { feedAlternates } from "@/lib/feed-links";
import { absoluteUrl, BASE_OPEN_GRAPH, SITE_NAME } from "@/lib/site";
import { getReaderPoem } from "@/server/board-cache";

type Props = PageProps<"/p/[author]/[poem]">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { author, poem } = await params;
  const p = await getReaderPoem(author, poem);
  if (!p) return { title: "Poem not found", robots: { index: false } };
  const url = `/p/${p.authorSlug}/${p.slug}`;
  const title = `${p.title} by ${p.penName}`;
  // Private poems: never describe them with their text (N1).
  const description =
    p.visibility === "public" && p.body
      ? metaDescription(p.body)
      : `A password-protected poem by ${p.penName} on ${SITE_NAME}.`;
  return {
    title,
    description,
    alternates: { canonical: url, ...feedAlternates({ slug: p.authorSlug, penName: p.penName }) },
    authors: [{ name: p.penName, url: `/a/${p.authorSlug}` }],
    openGraph: {
      ...BASE_OPEN_GRAPH,
      type: "article",
      url,
      title,
      description,
      authors: [p.penName],
      ...(p.publishedAt && { publishedTime: p.publishedAt }),
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

/** Poem lines joined into one ~160-char sentence for search snippets. */
function metaDescription(body: string) {
  const text = stripPoemMarkdown(body).split("\n").map((l) => l.trim()).filter(Boolean).join(" / ");
  return text.length > 160 ? `${text.slice(0, 157).trimEnd()}…` : text;
}

/** schema.org data for rich results; private poems carry no text. */
async function PoemJsonLd({ params }: Pick<Props, "params">) {
  const { author, poem } = await params;
  const p = await getReaderPoem(author, poem);
  if (!p) return null;
  const data = {
    "@context": "https://schema.org",
    "@type": "CreativeWork",
    genre: "Poetry",
    name: p.title,
    url: absoluteUrl(`/p/${p.authorSlug}/${p.slug}`),
    author: { "@type": "Person", name: p.penName, url: absoluteUrl(`/a/${p.authorSlug}`) },
    ...(p.publishedAt && { datePublished: p.publishedAt }),
    ...(p.language && { inLanguage: p.language }),
    isAccessibleForFree: p.visibility === "public",
    ...(p.collection && {
      isPartOf: { "@type": "CreativeWorkSeries", name: p.collection.title },
      position: p.collection.part,
    }),
    ...(p.visibility === "public" && p.body && { text: stripPoemMarkdown(p.body) }),
    publisher: { "@type": "Organization", name: SITE_NAME, url: absoluteUrl("/") },
  };
  return <JsonLd data={data} />;
}

/**
 * After the poem, a quiet way to follow its author (full page only; in the
 * board overlay, the toolbar's Subscribe covers the site feed).
 */
async function PoemFeedFooter({ params }: Pick<Props, "params">) {
  const { author, poem } = await params;
  const p = await getReaderPoem(author, poem);
  if (!p) return null;
  return (
    <footer className="mt-14 border-t pt-6">
      <AuthorFeedLink slug={p.authorSlug} penName={p.penName} />
    </footer>
  );
}

/** Full page: direct links, refreshes and shared URLs land here. */
export default function PoemPage({ params }: Props) {
  return (
    <main className="flex-1 bg-background">
      <div className="mx-auto max-w-2xl px-6 py-10 sm:py-16">
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-10">
          <Link href="/">
            <ArrowLeftIcon />
            Back to the board
          </Link>
        </Button>
        <Suspense fallback={<PoemReaderSkeleton />}>
          <PoemReader params={params} />
        </Suspense>
        <Suspense>
          <PoemFeedFooter params={params} />
        </Suspense>
        <Suspense>
          <PoemJsonLd params={params} />
        </Suspense>
      </div>
    </main>
  );
}
