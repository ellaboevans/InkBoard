"use client";

import { PoemText } from "@/components/poem/poem-text";
import { languageName } from "@/lib/poem-languages";
import { FeatherIcon, LayoutGridIcon, LockIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  boardLanguages,
  filterSectionsByLanguage,
  LANG_PARAM,
  parseLanguageFilter,
  withLanguageParam,
  type LanguageOption,
} from "@/lib/board-filter";
import { sectionHue } from "@/lib/board-layout";
import type { BoardSection } from "@/lib/board-types";
import { SubscribeButton } from "@/components/feeds/subscribe-button";
import { BoardCanvas } from "./board-canvas";
import { CollectionBadgeLine } from "./poem-card-face";
import { LanguageFilter, LanguageFilterStatus } from "./language-filter";
import { pluralCount } from "@/lib/plural";

/**
 * Canvas by default, with a plain list as an accessible alternative (N7).
 *
 * The language filter (`/?lang=ee`) is read with useSearchParams, which must
 * sit behind Suspense to keep `/` prerendered (Cache Components). The static
 * shell holds the whole board (no filter); the client then renders the
 * filtered one. The board data itself stays one cached list for every
 * language, narrowed here (src/lib/board-filter.ts).
 */
export function BoardView({ sections, feedUrl }: { sections: BoardSection[]; feedUrl: string }) {
  if (sections.length === 0) return <EmptyBoard />;
  return (
    <Suspense fallback={<Board sections={sections} language={null} feedUrl={feedUrl} />}>
      <UrlBoard sections={sections} feedUrl={feedUrl} />
    </Suspense>
  );
}

function UrlBoard({ sections, feedUrl }: { sections: BoardSection[]; feedUrl: string }) {
  const pathname = usePathname();
  const params = useSearchParams();
  // The board stays mounted under the poem overlay (/p/…), whose URL has no
  // ?lang. Only follow the URL on the board itself, or opening a poem would
  // re-lay out the board behind it.
  const fromUrl = pathname === "/" ? params.get(LANG_PARAM) : undefined;
  const [raw, setRaw] = useState<string | null>(fromUrl ?? null);
  if (fromUrl !== undefined && fromUrl !== raw) setRaw(fromUrl);
  return <Board sections={sections} language={raw} feedUrl={feedUrl} />;
}

function Board({
  sections,
  language,
  feedUrl,
}: {
  sections: BoardSection[];
  language: string | null;
  /** Absolute URL of the site feed, for the Subscribe popover. */
  feedUrl: string;
}) {
  const [mode, setMode] = useState<"canvas" | "list">("canvas");
  const options = useMemo(() => boardLanguages(sections), [sections]);
  const active = parseLanguageFilter(language, options);
  const shown = useMemo(() => filterSectionsByLanguage(sections, active), [sections, active]);
  const filter: BoardFilter = {
    options,
    active,
    // Native history: Next syncs useSearchParams, with no server round trip.
    onChange: (code) => window.history.pushState(null, "", `/${withLanguageParam(window.location.search, code)}`),
  };
  return mode === "canvas" ? (
    <BoardCanvas
      sections={shown}
      allSections={sections}
      filter={filter}
      feedUrl={feedUrl}
      onListView={() => setMode("list")}
    />
  ) : (
    <BoardList sections={shown} filter={filter} feedUrl={feedUrl} onCanvasView={() => setMode("canvas")} />
  );
}

export type BoardFilter = {
  options: LanguageOption[];
  active: string | null;
  onChange: (code: string | null) => void;
};

function BoardList({
  sections,
  filter,
  feedUrl,
  onCanvasView,
}: {
  sections: BoardSection[];
  filter: BoardFilter;
  feedUrl: string;
  onCanvasView: () => void;
}) {
  const total = sections.reduce((n, s) => n + s.poems.length, 0);
  return (
    <div className="h-full overflow-y-auto bg-canvas">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <header className="mb-10 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <Link href="/" className="flex items-center gap-2 font-serif text-2xl">
            <FeatherIcon className="size-5 text-primary" aria-hidden />
            InkBoard
          </Link>
          <div data-board-toolbar className="flex flex-wrap items-center justify-end gap-2">
            <LanguageFilter id="list-language" filter={filter} />
            <SubscribeButton feedUrl={feedUrl} />
            <Button variant="outline" size="sm" onClick={onCanvasView} className="max-sm:w-7 max-sm:px-0">
              <LayoutGridIcon />
              {/* Icon-only on phones (like List view on the canvas), but still named. */}
              <span className="max-sm:sr-only">Board view</span>
            </Button>
          </div>
        </header>
        <LanguageFilterStatus filter={filter} total={total} selectId="list-language" className="-mt-6 mb-8" />
        <div className="grid gap-12">
          {sections.map((s) => (
            <section key={s.editorId} aria-labelledby={`author-${s.editorId}`} style={{ ["--hue" as string]: sectionHue(s.editorId) }}>
              <h2 id={`author-${s.editorId}`} className="flex items-center gap-2.5 border-b pb-2 font-serif text-2xl">
                <span className="section-dot size-2.5 rounded-full" aria-hidden />
                {s.penName}
                <span className="font-sans text-sm text-muted-foreground">
                  {pluralCount(s.poems.length, "poem")}
                </span>
              </h2>
              <ul className="mt-2 divide-y">
                {s.poems.map((p) => (
                  <li key={p.id}>
                    <Link href={`/p/${s.slug}/${p.slug}`} className="group block rounded-md py-3 focus-visible:outline-2 focus-visible:outline-ring">
                      <span className="flex items-center gap-2 font-serif text-lg group-hover:underline">
                        <span lang={p.language ?? undefined}>{p.title}</span>
                        {p.visibility === "private" && (
                          <LockIcon className="size-3.5 text-muted-foreground" aria-label="password protected" />
                        )}
                        {languageName(p.language) && (
                          <span className="rounded-full border px-2 py-0.5 font-sans text-[11px] text-muted-foreground">
                            {languageName(p.language)}
                          </span>
                        )}
                      </span>
                      {p.excerpt && (
                        <span
                          lang={p.language ?? undefined}
                          className="mt-1 line-clamp-2 block font-serif text-sm whitespace-pre-line text-muted-foreground"
                        >
                          <PoemText text={p.excerpt} truncated={p.hasMore} />
                        </span>
                      )}
                      {p.collection && <CollectionBadgeLine collection={p.collection} className="mt-1" />}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

function EmptyBoard() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 bg-canvas p-6 text-center [background-image:radial-gradient(var(--canvas-dot)_1px,transparent_1px)] [background-size:24px_24px]">
      <FeatherIcon className="size-8 text-primary" aria-hidden />
      <h1 className="font-serif text-5xl tracking-tight">InkBoard</h1>
      <p className="max-w-md font-serif text-lg text-muted-foreground italic">
        A living board of poems, catalogued by author.
      </p>
      <p className="text-sm text-muted-foreground">No poems have been published yet.</p>
      <Button asChild variant="outline">
        <Link href="/sign-in">Editor sign in</Link>
      </Button>
    </div>
  );
}
