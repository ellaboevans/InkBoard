"use client";

import { HistoryIcon, RotateCcwIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { diffLines, linesChanged } from "@/lib/line-diff";
import { languageName } from "@/lib/poem-languages";
import { pluralCount } from "@/lib/plural";

/*
 * Revision history in the poem editor (docs/PLAN.md, Phase 13). The list and
 * the selected version come from the server (scoped to the editor, times
 * preformatted there); a version is selected by URL (?version=<id>), so Back
 * closes it. Restoring only fills the editor's fields: the editor then saves
 * as usual, which records the restore as a new version.
 */

export type HistoryItem = {
  id: string;
  /** Server-formatted ("Nov 14, 2026, 8:41 PM UTC"), like updatedLabel. */
  savedLabel: string;
  title: string;
  preview: string;
  /** The newest version: what's saved now. */
  current: boolean;
};

export type SelectedVersion = {
  id: string;
  savedLabel: string;
  title: string;
  body: string;
  language: string | null;
  current: boolean;
};

export type EditorContent = { title: string; body: string; language: string };

const versionHref = (poemId: string, id?: string) => `/admin/poems/${poemId}${id ? `?version=${id}` : ""}`;

export function HistoryPanel({
  poemId,
  items,
  selectedId,
}: {
  poemId: string;
  items: HistoryItem[];
  selectedId: string | null;
}) {
  const earlier = items.length - 1;
  return (
    <section aria-labelledby="history-heading" className="grid gap-2 rounded-xl border bg-card p-4">
      <h2 id="history-heading" className="flex items-center gap-1.5 text-sm font-medium">
        <HistoryIcon className="size-3.5" aria-hidden />
        History
      </h2>
      <p id="history-help" className="text-xs text-muted-foreground">
        {earlier > 0
          ? `${pluralCount(earlier, "earlier version")}. Open one to compare it or bring it back.`
          : "Earlier versions appear here when you save changes to the title, text or language."}
      </p>
      {items.length > 0 && (
        <ol className="-mx-1 grid max-h-80 gap-0.5 overflow-y-auto" aria-describedby="history-help">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                href={versionHref(poemId, item.id)}
                scroll={false}
                data-version-link={item.id}
                aria-current={item.id === selectedId ? "true" : undefined}
                className="grid gap-0.5 rounded-lg px-2 py-1.5 text-sm hover:bg-muted focus-visible:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none aria-[current=true]:bg-muted"
              >
                <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className="tabular-nums">{item.savedLabel}</span>
                  {item.current && (
                    <span className="rounded-full border px-1.5 text-[11px] text-foreground">Current</span>
                  )}
                </span>
                <span className="truncate font-serif text-[15px]">{item.title}</span>
                {item.preview && <span className="truncate text-xs text-muted-foreground">{item.preview}</span>}
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function VersionDialog({
  poemId,
  version,
  editor,
  dirty,
  onRestore,
}: {
  poemId: string;
  version: SelectedVersion | null;
  /** What's in the editor right now (maybe unsaved): the diff's baseline. */
  editor: EditorContent;
  /** The editor has unsaved changes that restoring would replace. */
  dirty: boolean;
  onRestore: (v: SelectedVersion) => void;
}) {
  const router = useRouter();
  // Close at once, without waiting for the URL change to round-trip.
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (!version && dismissed) setDismissed(null);
  const open = !!version && dismissed !== version.id;
  const restored = useRef(false);

  const diff = useMemo(() => (version ? diffLines(editor.body, version.body) : null), [editor.body, version]);
  const changed = diff ? linesChanged(diff) : 0;
  const titleDiffers = !!version && version.title !== editor.title;
  const languageDiffers = !!version && (version.language ?? "") !== editor.language;
  const same = !!version && !titleDiffers && !languageDiffers && version.body === editor.body;

  // `lang` only on the poem's own words, never on the UI around them.
  const lang = version?.language ?? undefined;

  const close = () => {
    if (!version) return;
    setDismissed(version.id);
    router.replace(versionHref(poemId), { scroll: false });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      {version && (
        <DialogContent
          className="grid max-h-[90dvh] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-2xl"
          onCloseAutoFocus={(e) => {
            // The dialog opened from a link (by URL), so Radix has no trigger
            // to return to: send focus back to that version, or to the title.
            e.preventDefault();
            const target = restored.current
              ? document.getElementById("title")
              : document.querySelector<HTMLElement>(`[data-version-link="${version.id}"]`);
            restored.current = false;
            target?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {version.current ? "Current version" : "Earlier version"}, saved {version.savedLabel}
            </DialogTitle>
            <DialogDescription>
              Read-only. Compared with the text in the editor now:{" "}
              {same
                ? "they're the same."
                : diff
                  ? `${pluralCount(changed, "line")} ${changed === 1 ? "differs" : "differ"}.`
                  : "too long to compare line by line."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid content-start gap-4 overflow-y-auto pr-1">
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Title</dt>
              <dd className="min-w-0 font-serif">
                <span lang={lang}>{version.title}</span>
                {titleDiffers && (
                  <span className="block text-xs text-muted-foreground">In the editor: {editor.title || "(empty)"}</span>
                )}
              </dd>
              <dt className="text-muted-foreground">Language</dt>
              <dd className="min-w-0">
                {languageName(version.language) ?? "Not set"}
                {languageDiffers && (
                  <span className="block text-xs text-muted-foreground">
                    In the editor: {languageName(editor.language) ?? "Not set"}
                  </span>
                )}
              </dd>
            </dl>

            <div>
              <h3 className="sr-only">Text</h3>
              {diff && !same && (
                <p className="mb-2 text-xs text-muted-foreground" id="diff-legend">
                  <span className="font-mono">+</span> only in this version (restoring brings it back) ·{" "}
                  <span className="font-mono">−</span> only in the editor (restoring removes it)
                </p>
              )}
              <ol
                aria-describedby={diff && !same ? "diff-legend" : undefined}
                className="rounded-lg border bg-background p-3 font-serif text-base leading-relaxed whitespace-pre-wrap"
              >
                {(diff ?? version.body.split("\n").map((text) => ({ kind: "same" as const, text }))).map((line, i) => (
                  <li key={i} className="grid grid-cols-[1.25rem_minmax(0,1fr)]">
                    <span aria-hidden className="font-mono text-xs leading-[inherit] text-muted-foreground select-none">
                      {line.kind === "added" ? "+" : line.kind === "removed" ? "−" : ""}
                    </span>
                    {line.kind === "added" ? (
                      <ins className="rounded-sm bg-emerald-50 text-emerald-950 no-underline">
                        <span className="sr-only">Only in this version: </span>
                        <span lang={lang}>{line.text || " "}</span>
                      </ins>
                    ) : line.kind === "removed" ? (
                      <del className="rounded-sm bg-destructive/10 text-destructive">
                        <span className="sr-only">Only in the editor: </span>
                        <span lang={lang}>{line.text || " "}</span>
                      </del>
                    ) : (
                      <span lang={lang}>{line.text || " "}</span>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          </div>

          <DialogFooter className="items-center gap-2 sm:justify-between">
            <p className="text-xs text-muted-foreground">
              {same
                ? "The editor already has this version."
                : dirty
                  ? "Restoring replaces your unsaved changes in the editor. Nothing is saved until you save."
                  : "Restoring puts it in the editor; nothing is saved until you save."}
            </p>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={close}>
                Close
              </Button>
              <Button
                type="button"
                disabled={same}
                onClick={() => {
                  restored.current = true;
                  onRestore(version);
                  close();
                }}
              >
                <RotateCcwIcon />
                Restore this version
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}
