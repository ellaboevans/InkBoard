"use client";

import { PoemText } from "@/components/poem/poem-text";
import { FeatherIcon, LayoutGridIcon, LockIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { sectionHue } from "@/lib/board-layout";
import type { BoardSection } from "@/lib/board-types";
import { BoardCanvas } from "./board-canvas";

/** Canvas by default, with a plain list as an accessible alternative (N7). */
export function BoardView({ sections }: { sections: BoardSection[] }) {
  const [mode, setMode] = useState<"canvas" | "list">("canvas");
  if (sections.length === 0) return <EmptyBoard />;
  return mode === "canvas" ? (
    <BoardCanvas sections={sections} onListView={() => setMode("list")} />
  ) : (
    <BoardList sections={sections} onCanvasView={() => setMode("canvas")} />
  );
}

function BoardList({ sections, onCanvasView }: { sections: BoardSection[]; onCanvasView: () => void }) {
  return (
    <div className="h-full overflow-y-auto bg-canvas">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <header className="mb-10 flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2 font-serif text-2xl">
            <FeatherIcon className="size-5 text-primary" aria-hidden />
            InkBoard
          </Link>
          <Button variant="outline" size="sm" onClick={onCanvasView}>
            <LayoutGridIcon />
            Board view
          </Button>
        </header>
        <div className="grid gap-12">
          {sections.map((s) => (
            <section key={s.editorId} aria-labelledby={`author-${s.editorId}`} style={{ ["--hue" as string]: sectionHue(s.editorId) }}>
              <h2 id={`author-${s.editorId}`} className="flex items-center gap-2.5 border-b pb-2 font-serif text-2xl">
                <span className="section-dot size-2.5 rounded-full" aria-hidden />
                {s.penName}
                <span className="font-sans text-sm text-muted-foreground">
                  {s.poems.length} {s.poems.length === 1 ? "poem" : "poems"}
                </span>
              </h2>
              <ul className="mt-2 divide-y">
                {s.poems.map((p) => (
                  <li key={p.id}>
                    <Link href={`/p/${s.slug}/${p.slug}`} className="group block rounded-md py-3 focus-visible:outline-2 focus-visible:outline-ring">
                      <span className="flex items-center gap-2 font-serif text-lg group-hover:underline">
                        {p.title}
                        {p.visibility === "private" && (
                          <LockIcon className="size-3.5 text-muted-foreground" aria-label="password protected" />
                        )}
                      </span>
                      {p.excerpt && (
                        <span className="mt-1 line-clamp-2 block font-serif text-sm whitespace-pre-line text-muted-foreground">
                          <PoemText text={p.excerpt} truncated={p.hasMore} />
                        </span>
                      )}
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
