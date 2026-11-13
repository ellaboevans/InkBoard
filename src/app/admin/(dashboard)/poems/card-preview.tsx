"use client";

import { LockIcon } from "lucide-react";
import { useState } from "react";
import { cardTitleClass, PoemCardFace } from "@/components/board/poem-card-face";
import { PoemBody } from "@/components/poem/poem-body";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { CARD_H, CARD_W } from "@/lib/board-layout";
import { cardExcerpt, normalizePoemBody } from "@/lib/poem-text";

/**
 * Live preview of the poem as a board card, updated as the editor types. It
 * uses the board's own card face and excerpt rule, so line breaks, stanza
 * spacing and indentation look exactly as readers will see them. Clicking the
 * card opens the full reading view.
 */
export function CardPreview({
  title,
  body,
  isPrivate,
  published,
  penName,
  language,
}: {
  title: string;
  body: string;
  isPrivate: boolean;
  published: boolean;
  penName: string;
  /** The chosen language tag, or null; only applied to real text, not placeholders. */
  language: string | null;
}) {
  const [open, setOpen] = useState(false);
  const shownTitle = title.trim() || "Untitled poem";
  const text = normalizePoemBody(body);
  const { excerpt, hasMore } = cardExcerpt(text);

  return (
    <section className="grid gap-3 rounded-xl border bg-card p-4" aria-labelledby="card-preview-heading">
      <div className="grid gap-0.5">
        <h2 id="card-preview-heading" className="text-sm font-medium">
          Card preview
        </h2>
        <p className="text-xs text-muted-foreground">
          {published ? "How it looks on the board." : "How it will look on the board once published."}
        </p>
      </div>

      {/* The board's canvas behind a real-size card. */}
      <div className="flex justify-center rounded-lg bg-canvas px-2 py-4 [background-image:radial-gradient(var(--canvas-dot)_1px,transparent_1px)] [background-size:18px_18px]">
        <PoemCardFace
          className="relative shrink-0"
          style={{ width: CARD_W, height: CARD_H }}
          isPrivate={isPrivate}
          lang={text ? language : null}
          excerpt={text ? excerpt : "Start writing — your first lines appear here."}
          hasMore={hasMore}
          title={
            <button
              type="button" // inside the poem form: must never submit it
              onClick={() => setOpen(true)}
              aria-haspopup="dialog"
              className={cardTitleClass}
            >
              <span className={title.trim() ? undefined : "text-muted-foreground"}>{shownTitle}</span>
              <span className="sr-only"> (open the full preview)</span>
            </button>
          }
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {isPrivate
          ? "Readers see the title; the text unlocks with the password. Click the card to read it in full."
          : "Click the card to preview the full poem."}
      </p>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[min(88dvh,56rem)] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
          <div className="border-b px-6 py-3 pr-12 text-xs text-muted-foreground">
            Preview{published ? "" : " · not published yet"} · includes unsaved changes
          </div>
          <article className="overflow-y-auto overscroll-contain px-6 py-8 sm:px-10 sm:py-10">
            <header className="mb-8 sm:mb-10">
              <DialogTitle asChild>
                <h1 className="font-serif text-3xl leading-tight tracking-tight sm:text-5xl">{shownTitle}</h1>
              </DialogTitle>
              <DialogDescription asChild>
                <p className="mt-3 text-muted-foreground">
                  by <span className="text-foreground">{penName}</span>
                </p>
              </DialogDescription>
            </header>
            {isPrivate && (
              <p className="mb-6 flex items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-sm text-secondary-foreground">
                <LockIcon className="size-4 shrink-0" aria-hidden />
                Readers see this after entering the password.
              </p>
            )}
            {text ? <PoemBody body={text} lang={language} /> : <p className="text-muted-foreground">Nothing written yet.</p>}
          </article>
        </DialogContent>
      </Dialog>
    </section>
  );
}
