/**
 * "Where you stopped" (docs/PLAN.md, Phase 23b; docs/research/novels.md §3):
 * for each novel a reader opens, the last chapter they opened and when. It
 * lives only in the reader's browser, under one localStorage key; it's never
 * sent to the server, no cookie carries it, and the service worker doesn't
 * touch it. Pure: the chapter page records, the novel page reads, the tests
 * check both here.
 *
 *   localStorage["inkboard-reading"] =
 *     { "v": 1, "novels": { "<novelId>": { "chapter": "<slug>", "at": "<ISO time>" } } }
 *
 * At most READING_PLACES_MAX novels; opening another drops the one read
 * longest ago. Anything unreadable (another version, hand-edited, cut short)
 * counts as empty rather than throwing.
 */

export const READING_KEY = "inkboard-reading";
export const READING_PLACES_MAX = 50;

export type ReadingPlace = { chapter: string; at: string };
export type ReadingStore = { v: 1; novels: Record<string, ReadingPlace> };

const empty = (): ReadingStore => ({ v: 1, novels: {} });

const isPlace = (p: unknown): p is ReadingPlace =>
  typeof p === "object" &&
  p !== null &&
  typeof (p as ReadingPlace).chapter === "string" &&
  (p as ReadingPlace).chapter !== "" &&
  typeof (p as ReadingPlace).at === "string" &&
  !Number.isNaN(Date.parse((p as ReadingPlace).at));

/** The stored value, or an empty store for anything missing or malformed. */
export function parseReadingStore(raw: string | null | undefined): ReadingStore {
  if (!raw) return empty();
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return empty();
  }
  if (typeof data !== "object" || data === null || (data as ReadingStore).v !== 1) return empty();
  const novels = (data as ReadingStore).novels;
  if (typeof novels !== "object" || novels === null || Array.isArray(novels)) return empty();
  const store = empty();
  for (const [id, place] of Object.entries(novels)) {
    if (id !== "__proto__" && isPlace(place)) store.novels[id] = { chapter: place.chapter, at: place.at };
  }
  return store;
}

/** The store with `novelId` at `chapter` (now `at`), keeping the READING_PLACES_MAX most recent novels. */
export function recordPlace(store: ReadingStore, novelId: string, chapter: string, at: Date): ReadingStore {
  const entries = Object.entries({ ...store.novels, [novelId]: { chapter, at: at.toISOString() } })
    .sort(([, a], [, b]) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, READING_PLACES_MAX);
  return { v: 1, novels: Object.fromEntries(entries) };
}

/** Where the reader stopped in this novel, or null. */
export function placeFor(store: ReadingStore, novelId: string): ReadingPlace | null {
  return Object.prototype.hasOwnProperty.call(store.novels, novelId) ? store.novels[novelId] : null;
}

/**
 * The published chapter to continue from: the saved slug's position among
 * `chapters` (reader order), or null when nothing is saved or that chapter is
 * no longer published (the novel page then offers "Start reading").
 */
export function continueIndex(place: ReadingPlace | null, chapters: readonly { slug: string }[]): number | null {
  if (!place) return null;
  const i = chapters.findIndex((c) => c.slug === place.chapter);
  return i < 0 ? null : i;
}
