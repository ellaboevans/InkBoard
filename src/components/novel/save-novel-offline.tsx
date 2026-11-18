"use client";

import { CheckIcon, CloudDownloadIcon, Loader2Icon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useReadingPlace } from "@/hooks/use-reading-place";
import { CHAPTER_OFFLINE_CAP, SAVE_NOVEL_MESSAGE } from "@/lib/offline/rules";
import { refreshSavedPages } from "@/lib/offline/saved-store";
import { pluralCount } from "@/lib/plural";
import { continueIndex } from "@/lib/reading-place";

/*
 * "Save this novel for offline" (docs/PLAN.md, Phase 24). One button: the
 * worker saves the novel page and the published chapters, one at a time,
 * through the same storage rules as a visit (src/lib/offline/worker.ts).
 * Only path strings are sent to the worker; it fetches its own cookie-less
 * copies. A device keeps at most CHAPTER_OFFLINE_CAP chapters (all novels
 * together), so a longer novel is saved from where this browser stopped (or
 * chapter 1) for that many chapters, and the result says so. Without a worker
 * (`next dev`, a private window, an old browser) it explains and does nothing.
 */

type State =
  | { kind: "idle" }
  | { kind: "unavailable" }
  | { kind: "saving"; done: number; total: number }
  | { kind: "done"; saved: number; total: number; chapters: number; first: number; last: number; of: number };

export function SaveNovelOffline({
  novelId,
  novelPath,
  chapters,
}: {
  novelId: string;
  novelPath: string;
  /** Published chapters in reading order. */
  chapters: { number: number; slug: string }[];
}) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const place = useReadingPlace(novelId);

  function save() {
    if (state.kind === "saving") return;
    const worker = typeof navigator !== "undefined" && "serviceWorker" in navigator ? navigator.serviceWorker.controller : null;
    if (!worker || typeof MessageChannel === "undefined") {
      setState({ kind: "unavailable" });
      return;
    }
    // From where this browser stopped, if the whole novel doesn't fit.
    const start = chapters.length > CHAPTER_OFFLINE_CAP ? (continueIndex(place, chapters) ?? 0) : 0;
    const picked = chapters.slice(start, start + CHAPTER_OFFLINE_CAP);
    const paths = [novelPath, ...picked.map((c) => `${novelPath}/${c.slug}`)];
    const channel = new MessageChannel();
    setState({ kind: "saving", done: 0, total: paths.length });
    channel.port1.onmessage = (e: MessageEvent<{ done?: number; saved: number; total: number; finished?: boolean }>) => {
      const m = e.data;
      if (!m.finished) {
        setState({ kind: "saving", done: m.done ?? 0, total: m.total });
        return;
      }
      channel.port1.close();
      void refreshSavedPages();
      setState({
        kind: "done",
        saved: m.saved,
        total: m.total,
        chapters: picked.length,
        first: picked[0]?.number ?? 1,
        last: picked.at(-1)?.number ?? 1,
        of: chapters.length,
      });
    };
    worker.postMessage({ type: SAVE_NOVEL_MESSAGE, paths }, [channel.port2]);
  }

  const saving = state.kind === "saving";
  return (
    // `contents`: the button and its status are items of the caller's flex row (heading, button), and the
    // status takes a full line under them, so the heading doesn't jump while saving.
    <div className="contents" data-save-novel={state.kind}>
      <Button
        type="button"
        variant="outline"
        onClick={save}
        // aria-disabled, not disabled: focus stays on the button while it works.
        aria-disabled={saving || undefined}
        aria-describedby="save-novel-status"
        className="min-h-11"
      >
        {saving ? (
          <Loader2Icon className="animate-spin" aria-hidden />
        ) : state.kind === "done" && state.saved === state.total ? (
          <CheckIcon aria-hidden />
        ) : (
          <CloudDownloadIcon aria-hidden />
        )}
        {state.kind === "done" ? "Save again for offline" : "Save this novel for offline"}
      </Button>
      <p id="save-novel-status" role="status" className="basis-full text-sm text-muted-foreground empty:hidden">
        {message(state)}
      </p>
    </div>
  );
}

function message(state: State): string {
  switch (state.kind) {
    case "idle":
      return "";
    case "unavailable":
      return "Offline saving isn’t available in this browser right now (it needs InkBoard’s offline helper, which runs in a regular browser window once the site has loaded).";
    case "saving":
      return `Saving… ${state.done} of ${state.total} pages`;
    case "done": {
      const failed = state.total - state.saved;
      const range = state.chapters < state.of ? ` (chapters ${state.first}–${state.last} of ${state.of}: this device keeps at most ${CHAPTER_OFFLINE_CAP} chapters)` : "";
      if (failed === 0) {
        return `Saved for reading offline: the novel page and ${pluralCount(state.chapters, "chapter")}${range}.`;
      }
      return `Saved ${state.saved} of ${state.total} pages${range}. ${pluralCount(failed, "page")} couldn’t be saved: try again with a better connection.`;
    }
  }
}
