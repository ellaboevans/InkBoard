"use client";

import { CopyIcon, DownloadIcon, ImageIcon, Loader2Icon, MessageCircleIcon, RotateCwIcon, Share2Icon, XIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { notify } from "@/lib/notify";
import { SHARE_DESIGNS, SHARE_DESIGN_NAMES, type ShareDesign } from "@/lib/share-image/designs";
import type { ShareFormat } from "@/lib/share-image/layout";
import { encodeSelection, MAX_PICKED_LINES } from "@/lib/share-image/selection";
import {
  shareImageFileName,
  shareImagePath,
  shareImageQuery,
  shareLinesPath,
  shareText,
  whatsappShareUrl,
} from "@/lib/share-image/share-text";
import { PoemText } from "./poem-text";

/*
 * "Share as image" on a public poem (docs/PLAN.md, Phase 21), under the
 * byline on the reading page and in the board's overlay, and (round 2) for
 * writers on their own public poems in the dashboard. Writers use the same
 * public routes as readers: nothing here is authorised differently.
 *
 * Web Share needs the tap's user activation, and waiting on a download can
 * outlast it (about 5 s in Chromium and WebKit). So the image for the current
 * choice (format, whole poem or picked lines) is fetched as soon as it's
 * chosen (picks after a short pause), the preview is that exact file, and
 * Share calls navigator.share() straight from its own tap. Share and
 * Download are aria-disabled until the file for the *current* choice is
 * there, so they can never send the other format or an older pick. Each
 * loaded file is kept for the sheet's life, so switching back is instant.
 *
 * The sheet's content is mounted only while it's open, so nothing is fetched
 * until a reader asks; the lines for "Choose lines" only once they're asked for.
 */

type Props = {
  authorSlug: string;
  slug: string;
  /** Absolute, resolved on the server (the client has no APP_URL). */
  poemUrl: string;
  title: string;
  penName: string;
};

/** 44 px touch targets, as in the install card. */
export const TOUCH = "h-11 px-4 text-[15px] [&_svg:not([class*='size-'])]:size-[18px]";

export function ShareImageButton({ className, ...props }: Props & { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className={cn("h-11 px-4 sm:h-9 sm:px-3 pointer-coarse:h-11", className)}>
          <ImageIcon aria-hidden />
          Share as image
        </Button>
      </DialogTrigger>
      <ShareImageContent {...props} />
    </Dialog>
  );
}

/** The same sheet opened from elsewhere (the dashboard's row menu); `returnFocus` gets focus back on close. */
export function ShareImageDialog({
  open,
  onOpenChange,
  returnFocus,
  ...props
}: Props & { open: boolean; onOpenChange: (open: boolean) => void; returnFocus?: () => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <ShareImageContent {...props} returnFocus={returnFocus} />
    </Dialog>
  );
}

function ShareImageContent({ returnFocus, ...props }: Props & { returnFocus?: () => void }) {
  return (
    <ShareDialogContent returnFocus={returnFocus}>
      <PoemShareSheet {...props} />
    </ShareDialogContent>
  );
}

/** The sheet's dialog content: focus starts on the main action; `returnFocus` gets it back on close. Shared with passages. */
export function ShareDialogContent({ returnFocus, children }: { returnFocus?: () => void; children: React.ReactNode }) {
  return (
    <DialogContent
      showCloseButton={false}
      className="max-h-[calc(100dvh-2rem)] gap-5 overflow-y-auto p-5 sm:max-w-md lg:max-w-3xl"
      // Focus starts on the main action (Share, or Download image), as in round 1,
      // not on the Size and Lines choices above it.
      onOpenAutoFocus={(e) => {
        const primary = (e.target as HTMLElement | null)?.querySelector<HTMLElement>("[data-share-primary]");
        if (!primary) return;
        e.preventDefault();
        primary.focus();
      }}
      onCloseAutoFocus={
        returnFocus
          ? (e) => {
              e.preventDefault();
              returnFocus();
            }
          : undefined
      }
    >
      {children}
    </DialogContent>
  );
}

type Entry =
  | { status: "ready"; file: File; url: string; picked: number | null; shown: number | null }
  | { status: "failed"; reason: "offline" | "network" | "limited" };
export type ReadyImage = Extract<Entry, { status: "ready" }>;
type Lines = { status: "idle" | "loading" | "failed" } | { status: "ready"; lines: string[]; language: string | null };
type Mode = "whole" | "pick";

/** Whether this browser can hand an image file to the system share sheet. */
function canShareFiles(): boolean {
  try {
    if (typeof navigator.share !== "function" || typeof navigator.canShare !== "function") return false;
    return navigator.canShare({ files: [new File([new Uint8Array(8)], "inkboard.png", { type: "image/png" })] });
  } catch {
    return false;
  }
}

const FAILED: Record<"offline" | "network" | "limited", string> = {
  offline: "You're offline. Connect to the internet to make the image.",
  network: "Couldn't load the image. Check your connection and try again.",
  limited: "Too many images made from this connection. Try again in a few minutes.",
};

/** A count the route sends back: picked lines or characters, and how many fit on the picture. */
const countHeader = (res: Response, kind: "Picked" | "Shown") => {
  for (const h of [`X-Share-Lines-${kind}`, `X-Share-Chars-${kind}`]) if (res.headers.has(h)) return Number(res.headers.get(h));
  return null;
};

export type ShareSheetShellProps = {
  heading: string;
  /** With and without file sharing. */
  description: { share: string; download: string };
  /** The image route (no query). */
  imagePath: string;
  /** The query for the current choice, or null while nothing is picked yet. */
  queryFor: (format: ShareFormat, design: ShareDesign) => string | null;
  /** Wait a moment before fetching (a pick still changing). */
  debounce: boolean;
  fileName: (format: ShareFormat, design: ShareDesign) => string;
  /** The text sent with the image, and the link Copy link copies. */
  text: string;
  url: string;
  previewAlt: string;
  /** In the preview while there's nothing to draw yet. */
  emptyHint: string;
  /** Below the preview when the picture had to leave something out. */
  cutNote?: (ready: ReadyImage, format: ShareFormat) => React.ReactNode;
  /** The choices under Size (the poem's Lines, a passage's picker). */
  children?: React.ReactNode;
};

/**
 * The sheet's shared part (poems, Phase 21; passages, Phase 25): the
 * preview, Design and Size, Share / Download image / Copy link / Send on
 * WhatsApp. Each choice's file is fetched when it's chosen (picks after a
 * short pause) and kept for the sheet's life; Share and Download are
 * aria-disabled until the current choice's file is there.
 */
export function ShareSheetShell({
  heading,
  description,
  imagePath,
  queryFor,
  debounce,
  fileName: fileNameFor,
  text,
  url,
  previewAlt,
  emptyHint,
  cutNote,
  children,
}: ShareSheetShellProps) {
  const [fileShare] = useState(canShareFiles);
  const [format, setFormat] = useState<ShareFormat>("story");
  // Page each time the sheet opens (not remembered: nothing is stored in the browser).
  const [design, setDesign] = useState<ShareDesign>("page");
  const [images, setImages] = useState<Record<string, Entry>>({});
  const [attempt, setAttempt] = useState(0);
  const urls = useRef<string[]>([]);

  const key = queryFor(format, design);
  const current = key !== null ? images[key] : undefined;
  const ready = current?.status === "ready" ? current : null;
  const failed = current?.status === "failed" ? current : null;
  const fileName = fileNameFor(format, design);
  const has = current !== undefined;

  useEffect(() => {
    if (key === null || has) return;
    const controller = new AbortController();
    // Picks wait for a short pause, so ticking five lines makes one image, not five.
    const timer = setTimeout(
      () => {
        fetch(imagePath + key, { signal: controller.signal })
          .then(async (res) => {
            if (res.status === 429) return { status: "failed", reason: "limited" } as const;
            if (!res.ok) throw new Error(`share image: ${res.status}`);
            const file = new File([await res.blob()], fileName, { type: "image/png" });
            const objectUrl = URL.createObjectURL(file);
            urls.current.push(objectUrl);
            return { status: "ready", file, url: objectUrl, picked: countHeader(res, "Picked"), shown: countHeader(res, "Shown") } as const;
          })
          .catch(() => {
            if (controller.signal.aborted) return null;
            return { status: "failed", reason: navigator.onLine === false ? "offline" : "network" } as const;
          })
          .then((entry) => {
            if (entry && !controller.signal.aborted) setImages((prev) => ({ ...prev, [key]: entry }));
          });
      },
      debounce ? 350 : 0,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, has, imagePath, fileName, debounce, attempt]);

  // Every preview URL goes when the sheet closes.
  useEffect(() => {
    const made = urls.current;
    return () => made.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  const retry = () => {
    if (key === null) return;
    setImages((prev) => {
      const copy = { ...prev };
      delete copy[key];
      return copy;
    });
    setAttempt((n) => n + 1);
  };

  const share = () => {
    if (!ready) return;
    const data: ShareData = { files: [ready.file], text };
    if (!navigator.canShare?.(data)) {
      notify.error("Couldn't share the image", "Download it instead, then post it from your gallery.");
      return;
    }
    // Straight from the tap, nothing awaited first (see the header).
    navigator.share(data).catch((error: unknown) => {
      // Closing the share sheet isn't an error.
      if (error instanceof DOMException && error.name === "AbortError") return;
      notify.error("Couldn't share the image", "Download it instead, then post it from your gallery.");
    });
  };

  const download = () => {
    if (!ready) return;
    const a = document.createElement("a");
    a.href = ready.url;
    a.download = ready.file.name;
    document.body.append(a);
    a.click();
    a.remove();
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      notify.success("Link copied", url);
    } catch {
      notify.error("Couldn't copy the link", url);
    }
  };

  const needsImage = { "aria-disabled": ready ? undefined : true } as const;
  const waiting = key !== null && !current;

  return (
    <>
      <DialogHeader className="pr-10">
        <DialogTitle className="text-lg">{heading}</DialogTitle>
        <DialogDescription>{fileShare ? description.share : description.download}</DialogDescription>
      </DialogHeader>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
        <div className="grid min-w-0 gap-3">
          <div
            className={cn(
              "relative mx-auto max-w-full overflow-hidden rounded-xl border bg-muted",
              format === "story" ? "aspect-[9/16] h-[min(52dvh,28rem)]" : "aspect-[4/5] h-[min(40dvh,22rem)]",
            )}
            aria-busy={waiting || undefined}
            data-share-format={format}
            data-share-design={design}
          >
            {ready ? (
              // eslint-disable-next-line @next/next/no-img-element -- a blob: preview of the exact file that will be shared
              <img src={ready.url} alt={previewAlt} className="size-full object-contain" data-share-preview />
            ) : failed ? (
              <div className="flex size-full flex-col items-center justify-center gap-3 p-4 text-center">
                <p className="text-sm text-destructive">{FAILED[failed.reason]}</p>
                <Button type="button" variant="outline" className={TOUCH} onClick={retry}>
                  <RotateCwIcon aria-hidden />
                  Try again
                </Button>
              </div>
            ) : key === null ? (
              <p className="flex size-full items-center justify-center p-4 text-center text-sm text-muted-foreground">{emptyHint}</p>
            ) : (
              <div className="flex size-full items-center justify-center">
                <Loader2Icon className="size-6 animate-spin text-muted-foreground" aria-hidden />
              </div>
            )}
          </div>
          <p role="status" className="sr-only">
            {waiting ? "Making the image…" : ready ? "Image ready." : ""}
          </p>
          {ready && cutNote?.(ready, format)}
        </div>

        <div className="grid min-w-0 gap-4">
          <Choice
            legend="Design"
            value={design}
            onChange={setDesign}
            options={SHARE_DESIGN_NAMES.map((d) => ({ value: d, label: SHARE_DESIGNS[d].label, swatch: <Swatch design={d} /> }))}
          />
          <Choice
            legend="Size"
            value={format}
            onChange={setFormat}
            options={[
              { value: "story", label: "Status or Story", hint: "9:16" },
              { value: "chat", label: "Chat", hint: "4:5" },
            ]}
          />
          {children}

          <div className="grid gap-2 sm:grid-cols-2">
            {fileShare ? (
              <Button type="button" className={`${TOUCH} sm:col-span-2`} onClick={share} data-share-primary {...needsImage}>
                <Share2Icon aria-hidden />
                Share
              </Button>
            ) : null}
            <Button
              type="button"
              variant={fileShare ? "outline" : "default"}
              className={`${TOUCH} ${fileShare ? "" : "sm:col-span-2"}`}
              onClick={download}
              data-share-primary={fileShare ? undefined : true}
              {...needsImage}
            >
              <DownloadIcon aria-hidden />
              Download image
            </Button>
            <Button type="button" variant="outline" className={TOUCH} onClick={() => void copyLink()}>
              <CopyIcon aria-hidden />
              Copy link
            </Button>
            {!fileShare && (
              <Button asChild variant="outline" className={TOUCH}>
                <a href={whatsappShareUrl(text)} target="_blank" rel="noopener noreferrer">
                  <MessageCircleIcon aria-hidden />
                  Send on WhatsApp
                </a>
              </Button>
            )}
          </div>
        </div>
      </div>

      <DialogClose asChild>
        <Button type="button" variant="ghost" size="icon" className="absolute top-2 right-2 size-11">
          <XIcon aria-hidden />
          <span className="sr-only">Close</span>
        </Button>
      </DialogClose>
    </>
  );
}

/** A poem's sheet: the shell, plus "Lines" (Whole poem / Choose lines) and the line picker. */
function PoemShareSheet({ authorSlug, slug, poemUrl, title, penName }: Props) {
  const [mode, setMode] = useState<Mode>("whole");
  const [picked, setPicked] = useState<number[]>([]);
  const [lines, setLines] = useState<Lines>({ status: "idle" });

  // The current pick (null: no lines picked yet).
  const selection = mode === "pick" && lines.status === "ready" ? encodeSelection(picked, lines.lines) || null : null;

  const loadLines = () => {
    setLines({ status: "loading" });
    fetch(shareLinesPath(authorSlug, slug))
      .then(async (res) => {
        if (!res.ok) throw new Error(`share lines: ${res.status}`);
        const data = (await res.json()) as { lines: string[]; language: string | null };
        setLines({ status: "ready", lines: data.lines, language: data.language });
      })
      .catch(() => setLines({ status: "failed" }));
  };

  const chooseMode = (next: Mode) => {
    setMode(next);
    if (next === "pick" && (lines.status === "idle" || lines.status === "failed")) loadLines();
  };

  return (
    <ShareSheetShell
      heading="Share as image"
      description={{
        share: "A picture of the poem for your WhatsApp Status, a chat or a Story, with its InkBoard address.",
        download: "A picture of the poem with its InkBoard address. Download it, then post it from your gallery.",
      }}
      imagePath={shareImagePath(authorSlug, slug)}
      queryFor={(format, design) =>
        mode === "whole" ? shareImageQuery(format, null, design) : selection ? shareImageQuery(format, selection, design) : null
      }
      debounce={mode === "pick"}
      fileName={(format, design) => shareImageFileName(slug, { format, design, lines: mode === "pick" })}
      text={shareText({ title, penName, url: poemUrl })}
      url={poemUrl}
      previewAlt={
        mode === "pick"
          ? `Preview of the image: lines from “${title}” by ${penName}, with its InkBoard address.`
          : `Preview of the image: “${title}” by ${penName}, with lines from the poem and its InkBoard address.`
      }
      emptyHint="Pick the lines for your image."
      cutNote={(ready, format) =>
        mode === "pick" && ready.picked !== null && ready.shown !== null && ready.shown < ready.picked ? (
          <p className="text-sm text-muted-foreground" data-share-cut>
            Only the first {ready.shown} of your {ready.picked} lines fit on this picture. Pick fewer or shorter lines
            {format === "chat" ? ", or choose Status or Story, which is taller" : ""}.
          </p>
        ) : null
      }
    >
      <Choice
        legend="Lines"
        value={mode}
        onChange={chooseMode}
        options={[
          { value: "whole", label: "Whole poem" },
          { value: "pick", label: "Choose lines" },
        ]}
      />
      {mode === "pick" && <LinePicker lines={lines} picked={picked} onChange={setPicked} onRetry={loadLines} />}
    </ShareSheetShell>
  );
}

/** Two real radio buttons styled as a segmented control, 44 px tall. */
export function Choice<T extends string>({
  legend,
  value,
  onChange,
  options,
}: {
  legend: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; hint?: string; swatch?: React.ReactNode }[];
}) {
  const name = useId();
  return (
    <fieldset className="grid min-w-0 gap-1.5">
      <legend className="mb-1.5 text-sm font-medium">{legend}</legend>
      <div className={cn("grid gap-1 rounded-lg bg-muted p-1", options.length === 3 ? "grid-cols-3" : "grid-cols-2")}>
        {options.map((o) => (
          <label
            key={o.value}
            className="flex min-h-11 cursor-pointer flex-wrap items-center justify-center gap-x-1.5 rounded-md px-2 py-1 text-center text-sm font-medium text-muted-foreground transition-colors has-checked:bg-background has-checked:text-foreground has-checked:shadow-sm has-focus-visible:ring-3 has-focus-visible:ring-ring/50"
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              className="sr-only"
            />
            {o.swatch}
            {o.label}
            {o.hint && <span className="text-xs font-normal tabular-nums">{o.hint}</span>}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * A small picture of a design's look, beside its name: its background, a line
 * of "text" and the accent, in the design's own colours (decorative: the
 * name says it).
 */
function Swatch({ design }: { design: ShareDesign }) {
  const look = SHARE_DESIGNS[design];
  const dotted =
    "dots" in look
      ? { backgroundImage: `radial-gradient(${look.dots.color} 1px, transparent 1.5px)`, backgroundSize: "5px 5px" }
      : {};
  return (
    <span
      aria-hidden
      className="relative inline-flex h-6 w-5 shrink-0 items-center justify-center overflow-hidden rounded-[3px] ring-1 ring-foreground/20"
      style={{ backgroundColor: look.background, ...dotted }}
    >
      <span
        className="flex h-4 w-3.5 flex-col justify-center gap-[2px] rounded-[2px] px-[2px]"
        style={{ backgroundColor: look.surface }}
      >
        <span className="block h-[2px] w-full rounded-full" style={{ backgroundColor: look.text }} />
        <span className="block h-[2px] w-2/3 rounded-full" style={{ backgroundColor: look.accent }} />
        <span className="block h-[2px] w-full rounded-full" style={{ backgroundColor: look.text }} />
      </span>
    </span>
  );
}

/**
 * "Choose lines": a checkbox per line of the poem, in the poem's own type
 * and language; blank lines (stanza breaks) are space, not boxes. Up to
 * MAX_PICKED_LINES; at the cap the other boxes are aria-disabled (still
 * focusable, so focus never jumps) and the count says why.
 */
function LinePicker({
  lines,
  picked,
  onChange,
  onRetry,
}: {
  lines: Lines;
  picked: number[];
  onChange: (picked: number[]) => void;
  onRetry: () => void;
}) {
  const countId = useId();
  if (lines.status === "failed") {
    return (
      <div className="grid justify-items-start gap-2">
        <p className="text-sm text-destructive">Couldn&apos;t load the poem&apos;s lines. Check your connection and try again.</p>
        <Button type="button" variant="outline" className={TOUCH} onClick={onRetry}>
          <RotateCwIcon aria-hidden />
          Try again
        </Button>
      </div>
    );
  }
  if (lines.status !== "ready") {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2Icon className="size-4 animate-spin" aria-hidden />
        Loading the poem&apos;s lines…
      </p>
    );
  }
  const chosen = new Set(picked);
  const count = picked.length;
  const full = count >= MAX_PICKED_LINES;
  const toggle = (n: number, on: boolean) => {
    if (on && full) return; // at the cap: the box stays as it was
    onChange(on ? [...picked, n].sort((a, b) => a - b) : picked.filter((x) => x !== n));
  };
  return (
    <fieldset className="grid min-w-0 gap-2">
      <legend className="sr-only">Lines for the image</legend>
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-2">
        <p id={countId} role="status" className="text-sm">
          {count === 0
            ? `Pick up to ${MAX_PICKED_LINES} lines.`
            : full
              ? `${count} of ${MAX_PICKED_LINES} lines picked, the most for one image.`
              : `${count} of ${MAX_PICKED_LINES} lines picked.`}
        </p>
        {count > 0 && (
          <Button type="button" variant="ghost" className="h-11 px-3" onClick={() => onChange([])}>
            Clear
          </Button>
        )}
      </div>
      <ul className="max-h-72 min-w-0 overflow-y-auto rounded-lg border bg-card py-1" data-line-picker>
        {lines.lines.map((line, i) => {
          const n = i + 1;
          if (!line.trim()) return <li key={n} aria-hidden className="h-3" />;
          const on = chosen.has(n);
          const off = full && !on;
          return (
            <li key={n}>
              <label
                className={cn(
                  "flex min-h-11 cursor-pointer items-start gap-3 px-3 py-2 hover:bg-accent has-checked:bg-primary/5",
                  off && "cursor-not-allowed opacity-60",
                )}
              >
                <input
                  type="checkbox"
                  checked={on}
                  aria-disabled={off || undefined}
                  aria-describedby={off ? countId : undefined}
                  onChange={(e) => toggle(n, e.target.checked)}
                  className="mt-1 size-5 shrink-0 accent-primary"
                />
                <span aria-hidden className="mt-1 w-5 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                  {n}
                </span>
                <span className="sr-only">Line {n}: </span>
                <span lang={lines.language ?? undefined} className="min-w-0 font-serif text-base whitespace-pre-wrap [overflow-wrap:anywhere]">
                  <PoemText text={line} />
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}
