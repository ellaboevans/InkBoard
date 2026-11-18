import { describe, expect, it } from "vitest";
import {
  continueIndex,
  parseReadingStore,
  placeFor,
  READING_KEY,
  READING_PLACES_MAX,
  recordPlace,
  type ReadingStore,
} from "@/lib/reading-place";

/*
 * "Where you stopped" (Phase 23b): the pure half of the browser-only store.
 * One key, at most READING_PLACES_MAX novels, novel id → chapter slug and time.
 */

const empty: ReadingStore = { v: 1, novels: {} };
const t = (minute: number) => new Date(Date.UTC(2026, 10, 17, 20, minute));

describe("the reading-place store", () => {
  it("is one localStorage key holding a versioned object", () => {
    expect(READING_KEY).toBe("inkboard-reading");
    const store = recordPlace(empty, "novel-1", "the-ferry", t(14));
    expect(JSON.parse(JSON.stringify(store))).toEqual({
      v: 1,
      novels: { "novel-1": { chapter: "the-ferry", at: "2026-11-17T20:14:00.000Z" } },
    });
  });

  it("records the latest chapter per novel, replacing the earlier one, without mutating the input", () => {
    const a = recordPlace(empty, "n1", "chapter-1", t(1));
    const b = recordPlace(a, "n1", "chapter-2", t(2));
    const c = recordPlace(b, "n2", "intro", t(3));
    expect(placeFor(c, "n1")).toEqual({ chapter: "chapter-2", at: t(2).toISOString() });
    expect(placeFor(c, "n2")?.chapter).toBe("intro");
    expect(placeFor(c, "n3")).toBeNull();
    expect(placeFor(a, "n1")?.chapter).toBe("chapter-1");
    expect(empty.novels).toEqual({});
  });

  it(`keeps the ${READING_PLACES_MAX} most recently read novels and drops the oldest`, () => {
    let store = empty;
    for (let i = 0; i < READING_PLACES_MAX; i++) store = recordPlace(store, `n${i}`, "c", t(i));
    expect(Object.keys(store.novels)).toHaveLength(READING_PLACES_MAX);
    // Re-reading the oldest makes it the newest, so the next new novel drops n1 instead.
    store = recordPlace(store, "n0", "c2", t(100));
    store = recordPlace(store, "new", "c", t(101));
    expect(Object.keys(store.novels)).toHaveLength(READING_PLACES_MAX);
    expect(placeFor(store, "n0")?.chapter).toBe("c2");
    expect(placeFor(store, "new")).not.toBeNull();
    expect(placeFor(store, "n1")).toBeNull();
    expect(placeFor(store, "n2")).not.toBeNull();
  });

  it("reads anything missing or malformed as empty, and drops bad entries", () => {
    for (const raw of [null, undefined, "", "not json", "null", "[]", "42", '{"v":2,"novels":{}}', '{"v":1}', '{"v":1,"novels":[]}']) {
      expect(parseReadingStore(raw), String(raw)).toEqual(empty);
    }
    const raw = JSON.stringify({
      v: 1,
      novels: {
        good: { chapter: "one", at: "2026-11-17T20:00:00.000Z", extra: "dropped" },
        noChapter: { at: "2026-11-17T20:00:00.000Z" },
        emptyChapter: { chapter: "", at: "2026-11-17T20:00:00.000Z" },
        badTime: { chapter: "x", at: "yesterday" },
        notObject: "x",
      },
    });
    expect(parseReadingStore(raw)).toEqual({ v: 1, novels: { good: { chapter: "one", at: "2026-11-17T20:00:00.000Z" } } });
    // A "__proto__" key can't reach the object's prototype.
    const proto = parseReadingStore('{"v":1,"novels":{"__proto__":{"chapter":"x","at":"2026-11-17T20:00:00.000Z"}}}');
    expect(proto).toEqual(empty);
    expect(placeFor(proto, "toString")).toBeNull();
  });

  it("continues from the saved chapter only while it's still published", () => {
    const chapters = [{ slug: "one" }, { slug: "two" }, { slug: "three" }];
    expect(continueIndex(null, chapters)).toBeNull();
    expect(continueIndex({ chapter: "two", at: t(0).toISOString() }, chapters)).toBe(1);
    expect(continueIndex({ chapter: "unpublished", at: t(0).toISOString() }, chapters)).toBeNull();
  });
});
