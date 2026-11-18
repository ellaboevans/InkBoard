"use client";

import { useMemo, useSyncExternalStore } from "react";
import { parseReadingStore, placeFor, READING_KEY, recordPlace, type ReadingPlace } from "@/lib/reading-place";

/*
 * The browser half of "where you stopped" (src/lib/reading-place.ts). Every
 * storage access is wrapped: private windows and blocked site data throw, and
 * the pages must work the same without it.
 *
 * The server snapshot is null, so the prerendered HTML (and the first client
 * render, during hydration) is the same for everyone: "Start reading". React
 * then re-renders with the stored value, so there's no hydration mismatch.
 */

const listeners = new Set<() => void>();

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(READING_KEY);
  } catch {
    return null;
  }
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  // Another tab moved on in the same novel.
  const onStorage = (e: StorageEvent) => {
    if (e.key === READING_KEY || e.key === null) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** The saved place in this novel, or null (also on the server and while hydrating). */
export function useReadingPlace(novelId: string): ReadingPlace | null {
  // The raw string is the snapshot: stable between calls, so React doesn't loop.
  const raw = useSyncExternalStore(subscribe, readRaw, () => null);
  return useMemo(() => placeFor(parseReadingStore(raw), novelId), [raw, novelId]);
}

/** Remember that the reader opened this chapter. Call from an effect or an event handler, never during render. */
export function rememberChapter(novelId: string, chapterSlug: string) {
  try {
    const next = recordPlace(parseReadingStore(readRaw()), novelId, chapterSlug, new Date());
    window.localStorage.setItem(READING_KEY, JSON.stringify(next));
  } catch {
    return; // Storage unavailable or full: nothing is remembered, nothing breaks.
  }
  for (const l of listeners) l();
}
