"use client";

import { RefreshCwIcon } from "lucide-react";
import { useSyncExternalStore } from "react";
import { PAGES_CACHE_PREFIX, SAVED_INDEX_KEY } from "@/lib/offline/rules";

type Entry = { url: string; kind: string; title: string | null; author: string | null; savedAt: number };
type Saved = { poems: Entry[]; board: boolean; from: string | null };

/*
 * The poems saved on this device, read straight from the worker's caches (no
 * server involved, so it works with the connection gone). A tiny external
 * store: loaded once per page load, null until then (and on the server).
 */
let snapshot: Saved | null = null;
let loading = false;
const listeners = new Set<() => void>();

async function load() {
  const from = new URLSearchParams(location.search).get("from");
  const entries = new Map<string, Entry>();
  try {
    for (const name of await caches.keys()) {
      if (!name.startsWith(PAGES_CACHE_PREFIX)) continue;
      const res = await (await caches.open(name)).match(SAVED_INDEX_KEY);
      for (const e of res ? ((await res.json()) as Entry[]) : []) entries.set(e.url, e);
    }
  } catch {
    // No CacheStorage (private mode, old browser): nothing saved.
  }
  const all = [...entries.values()];
  snapshot = {
    poems: all.filter((e) => e.kind === "poem" && e.title).sort((a, b) => b.savedAt - a.savedAt),
    board: all.some((e) => e.url === "/"),
    // Only same-site paths, so the "try again" link can't point anywhere else.
    from: from && from.startsWith("/") && !from.startsWith("//") ? from : null,
  };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!loading) {
    loading = true;
    void load();
  }
  return () => listeners.delete(listener);
}

export function SavedPoems() {
  const saved = useSyncExternalStore(subscribe, () => snapshot, () => null);
  if (!saved) return <p className="text-muted-foreground">Looking for saved poems…</p>;
  return (
    <div className="grid gap-8">
      {saved.from && (
        <p>
          <a href={saved.from} className="inline-flex items-center gap-1.5 font-medium text-primary underline-offset-4 hover:underline">
            <RefreshCwIcon className="size-4" aria-hidden />
            Try that page again
          </a>
        </p>
      )}
      <section aria-labelledby="saved-heading" className="grid gap-3">
        <h2 id="saved-heading" className="font-serif text-2xl">
          Saved on this device
        </h2>
        {saved.poems.length === 0 ? (
          <p className="text-muted-foreground">
            No poems saved yet. Poems you open while online are kept here for reading offline.
          </p>
        ) : (
          <ul className="grid gap-2" data-saved-poems>
            {saved.poems.map((p) => (
              <li key={p.url}>
                {/* A plain link: a full page load, which the worker answers from the saved copy. */}
                <a href={p.url} className="block rounded-xl border bg-card px-4 py-3 hover:bg-muted">
                  <span className="block font-serif text-lg leading-snug">{p.title}</span>
                  {p.author && <span className="text-sm text-muted-foreground">by {p.author}</span>}
                </a>
              </li>
            ))}
          </ul>
        )}
        {saved.board && (
          <p>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a full load, answered by the worker's saved board */}
            <a href="/" className="font-medium text-primary underline-offset-4 hover:underline">
              Open the board as you last saw it
            </a>
          </p>
        )}
      </section>
    </div>
  );
}
