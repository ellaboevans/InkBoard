"use client";

import { QuoteIcon, Loader2Icon, RotateCwIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { cn } from "cn";
import { ShareDialogContent, ShareSheetShell, TOUCH } from "@/components/poem/share-image-button";
import { SelectControl } from "@/components/form-controls";
import { Button } from "@/components/ui/button";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import { encodePassage, PASSAGE_MAX_CHARS, passageLength, type PassagePick } from "@/lib/share-image/passage";
import {
  passageImageFileName,
  passageImagePath,
  passageImageQuery,
  passageOutlinePath,
  passageShareText,
} from "@/lib/share-image/share-text";

/*
 * "Share a passage" (docs/PLAN.md, Phase 25 round 3), at the end of a public
 * novel's chapter (never a private novel's, unlocked or not). The poems'
 * sheet (ShareSheetShell: preview, Design, Size, Share / Download / Copy
 * link / WhatsApp) with a passage picker instead of the lines:
 *
 * - The chapter's paragraphs as real checkboxes, in the novel's `lang`.
 *   Consecutive only: a paragraph can be added next to the pick or taken off
 *   its ends; the others are aria-disabled (still focusable) and say why.
 * - "Start at" and "End after": the first and last paragraph trimmed to whole
 *   sentences, so a single line can be quoted.
 * - A live count against PASSAGE_MAX_CHARS (600, counted as the route counts:
 *   src/lib/share-image/passage.ts). Adding a paragraph that would go past it
 *   is aria-disabled; a first paragraph that is longer on its own can still be
 *   picked and trimmed, and no picture is made until it fits.
 *
 * The paragraphs come from …/share-image/passage once the sheet opens, so the
 * chapter's text isn't sent twice with the page.
 */

type Props = {
  authorSlug: string;
  novelSlug: string;
  chapterSlug: string;
  novelTitle: string;
  chapterNumber: number;
  penName: string;
  /** Absolute, resolved on the server. */
  chapterUrl: string;
  className?: string;
};

type Outline =
  | { status: "loading" | "failed" }
  | { status: "ready"; paragraphs: string[][]; breaks: number[]; language: string | null };

export function SharePassageButton({ className, ...props }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" className={cn("inline-flex min-h-11 items-center gap-1.5", className)} data-share-passage>
          <QuoteIcon className="size-4" aria-hidden />
          Share a passage
        </button>
      </DialogTrigger>
      {/* Mounted only while open (Radix), so nothing is fetched until a reader asks. */}
      <ShareDialogContent>
        <PassageSheet {...props} />
      </ShareDialogContent>
    </Dialog>
  );
}

function PassageSheet({ authorSlug, novelSlug, chapterSlug, novelTitle, chapterNumber, penName, chapterUrl }: Props) {
  const [outline, setOutline] = useState<Outline>({ status: "loading" });
  const [pick, setPick] = useState<PassagePick | null>(null);
  const [attempt, setAttempt] = useState(0);

  // The paragraphs, when the sheet opens (and on "Try again").
  useEffect(() => {
    const controller = new AbortController();
    fetch(passageOutlinePath(authorSlug, novelSlug, chapterSlug), { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`share passage: ${res.status}`);
        const data = (await res.json()) as { paragraphs: string[][]; breaks: number[]; language: string | null };
        setOutline({ status: "ready", ...data });
      })
      .catch(() => {
        if (!controller.signal.aborted) setOutline({ status: "failed" });
      });
    return () => controller.abort();
  }, [authorSlug, novelSlug, chapterSlug, attempt]);

  const paragraphs = outline.status === "ready" ? outline.paragraphs : null;
  const counts = paragraphs?.map((p) => p.length) ?? [];
  const length = paragraphs && pick ? passageLength(paragraphs, pick) : 0;
  const code = paragraphs && pick && length <= PASSAGE_MAX_CHARS ? encodePassage(pick, counts) || null : null;

  return (
    <ShareSheetShell
      heading="Share a passage"
      description={{
        share: "A picture of a passage for your WhatsApp Status, a chat or a Story, with the chapter's InkBoard address.",
        download: "A picture of a passage with the chapter's InkBoard address. Download it, then post it from your gallery.",
      }}
      imagePath={passageImagePath(authorSlug, novelSlug, chapterSlug)}
      queryFor={(format, design) => (code ? passageImageQuery(format, code, design) : null)}
      debounce
      fileName={(format, design) => passageImageFileName(novelSlug, chapterSlug, { format, design })}
      text={passageShareText({ novelTitle, chapterNumber, penName, url: chapterUrl })}
      url={chapterUrl}
      previewAlt={`Preview of the image: a passage from “${novelTitle}”, chapter ${chapterNumber}, by ${penName}, with its InkBoard address.`}
      emptyHint={
        pick && length > PASSAGE_MAX_CHARS
          ? `Trim the passage to ${PASSAGE_MAX_CHARS} characters or fewer.`
          : "Pick the paragraphs for your image."
      }
      cutNote={(ready, format) =>
        ready.picked !== null && ready.shown !== null && ready.shown < ready.picked ? (
          <p className="text-sm text-muted-foreground" data-share-cut>
            Your whole passage doesn&apos;t fit on this picture: it stops at a sentence, with “…”. Pick a shorter passage
            {format === "chat" ? ", or choose Status or Story, which is taller" : ""}.
          </p>
        ) : null
      }
    >
      <PassagePicker
        outline={outline}
        pick={pick}
        length={length}
        onChange={setPick}
        onRetry={() => {
          setOutline({ status: "loading" });
          setAttempt((n) => n + 1);
        }}
      />
    </ShareSheetShell>
  );
}

const sentenceLabel = (text: string) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 60 ? `${flat.slice(0, 57).trimEnd()}…` : flat;
};

function PassagePicker({
  outline,
  pick,
  length,
  onChange,
  onRetry,
}: {
  outline: Outline;
  pick: PassagePick | null;
  length: number;
  onChange: (pick: PassagePick | null) => void;
  onRetry: () => void;
}) {
  const countId = useId();
  const hintId = useId();
  const startId = useId();
  const endId = useId();
  if (outline.status === "failed") {
    return (
      <div className="grid justify-items-start gap-2">
        <p className="text-sm text-destructive">Couldn&apos;t load the chapter&apos;s paragraphs. Check your connection and try again.</p>
        <Button type="button" variant="outline" className={TOUCH} onClick={onRetry}>
          <RotateCwIcon aria-hidden />
          Try again
        </Button>
      </div>
    );
  }
  if (outline.status !== "ready") {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2Icon className="size-4 animate-spin" aria-hidden />
        Loading the chapter&apos;s paragraphs…
      </p>
    );
  }
  const { paragraphs, breaks, language } = outline;
  const counts = paragraphs.map((p) => p.length);
  const last = (p: number) => counts[p - 1];
  const whole = (a: number, b: number): PassagePick => ({ from: { p: a, s: 1 }, to: { p: b, s: last(b) } });
  const over = length > PASSAGE_MAX_CHARS;
  const fits = (next: PassagePick) => passageLength(paragraphs, next) <= PASSAGE_MAX_CHARS;

  /** What ticking or unticking paragraph n would make, or null when it isn't allowed (and why). */
  const change = (n: number): { next: PassagePick | null } | { blocked: "apart" | "cap" } => {
    if (!pick) return { next: whole(n, n) }; // the first pick: always, even if it's long (then trim it)
    const { from, to } = pick;
    if (n === from.p && n === to.p) return { next: null };
    if (n === from.p) return { next: { from: { p: n + 1, s: 1 }, to } };
    if (n === to.p) return { next: { from, to: { p: n - 1, s: last(n - 1) } } };
    if (n === from.p - 1 || n === to.p + 1) {
      const next = n < from.p ? { from: { p: n, s: 1 }, to } : { from, to: { p: n, s: last(n) } };
      return fits(next) ? { next } : { blocked: "cap" };
    }
    return { blocked: "apart" };
  };

  const firstSentences = pick ? paragraphs[pick.from.p - 1] : [];
  const lastSentences = pick ? paragraphs[pick.to.p - 1] : [];
  return (
    <fieldset className="grid min-w-0 gap-2">
      <legend className="mb-1.5 text-sm font-medium">Passage</legend>
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-2">
        <p id={countId} role="status" className={cn("text-sm", over && "text-destructive")} data-passage-count>
          {!pick
            ? `Pick one or more paragraphs next to each other, up to ${PASSAGE_MAX_CHARS} characters.`
            : over
              ? `${length} of ${PASSAGE_MAX_CHARS} characters: too long. Start later or end sooner below.`
              : `${length} of ${PASSAGE_MAX_CHARS} characters.`}
        </p>
        {pick && (
          <Button type="button" variant="ghost" className="h-11 px-3" onClick={() => onChange(null)}>
            Clear
          </Button>
        )}
      </div>
      <p id={hintId} className="sr-only">
        Only paragraphs next to each other: add one before or after the passage, or take one off its ends.
      </p>
      <ul className="max-h-72 min-w-0 overflow-y-auto rounded-lg border bg-card py-1" data-passage-picker>
        {paragraphs.map((sentences, i) => {
          const n = i + 1;
          const on = !!pick && n >= pick.from.p && n <= pick.to.p;
          const result = change(n);
          const blocked = "blocked" in result ? result.blocked : null;
          return (
            <li key={n}>
              {breaks.includes(n) && (
                <p aria-hidden className="py-1 text-center text-xs tracking-[0.4em] text-muted-foreground">
                  * * *
                </p>
              )}
              <label
                className={cn(
                  "flex min-h-11 cursor-pointer items-start gap-3 px-3 py-2 hover:bg-accent has-checked:bg-primary/5",
                  blocked && "cursor-not-allowed opacity-60",
                )}
              >
                <input
                  type="checkbox"
                  checked={on}
                  aria-disabled={blocked ? true : undefined}
                  aria-describedby={blocked === "cap" ? countId : blocked === "apart" ? hintId : undefined}
                  onChange={() => {
                    if (!("blocked" in result)) onChange(result.next);
                  }}
                  className="mt-1 size-5 shrink-0 accent-primary"
                />
                <span className="sr-only">Paragraph {n}: </span>
                <span lang={language ?? undefined} className="line-clamp-4 min-w-0 font-serif text-base [overflow-wrap:anywhere] whitespace-pre-line">
                  {sentences.join(" ")}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {pick && (
        <div className="grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-1">
          <div className="grid gap-1.5">
            <label htmlFor={startId} className="text-sm font-medium">
              Start at
            </label>
            <SelectControl
              id={startId}
              className="h-11 w-full"
              contentClassName="max-w-[calc(100vw-2rem)]"
              value={String(pick.from.s)}
              onValueChange={(v) => onChange({ ...pick, from: { p: pick.from.p, s: Number(v) } })}
              options={firstSentences.map((text, i) => {
                const s = i + 1;
                // In one paragraph, the start can't come after the end.
                const late = pick.from.p === pick.to.p && s > pick.to.s;
                return { value: String(s), disabled: late, lang: language ?? undefined, label: `Sentence ${s}: ${sentenceLabel(text)}` };
              })}
            />
          </div>
          <div className="grid gap-1.5">
            <label htmlFor={endId} className="text-sm font-medium">
              End after
            </label>
            <SelectControl
              id={endId}
              className="h-11 w-full"
              contentClassName="max-w-[calc(100vw-2rem)]"
              value={String(pick.to.s)}
              onValueChange={(v) => onChange({ ...pick, to: { p: pick.to.p, s: Number(v) } })}
              options={lastSentences.map((text, i) => {
                const s = i + 1;
                const early = pick.from.p === pick.to.p && s < pick.from.s;
                return { value: String(s), disabled: early, lang: language ?? undefined, label: `Sentence ${s}: ${sentenceLabel(text)}` };
              })}
            />
          </div>
        </div>
      )}
    </fieldset>
  );
}
