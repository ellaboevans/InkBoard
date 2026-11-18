# Novels on InkBoard

Research and design for the next feature: InkBoard becomes a place for poems **and** novels. A novel is a book with ordered chapters that a writer publishes one chapter at a time and readers follow. This round decides how to build it; nothing is built yet.

Written 17 November 2026. Mockups: [docs/mockups/novels/index.html](../mockups/novels/index.html) (board with a book card, novel page, a chapter on a phone, chapter editor; each at 375 and 1280 px).

---

## Decisions in short

1. **New tables: `novels` and `chapters`** (plus `chapter_revisions`). They are *not* poems in a collection. They reuse the poem code's patterns and helpers (slugs, light Markdown, revisions, the password modes, `notified_at`, scoping, lock order), not its rows.
2. **Prose has its own text model.** A blank line starts a new paragraph, a single line break is kept (letters, songs, text messages), and a line holding only `* * *` is a scene break. The inline Markdown (`*italic*`, `**bold**`) is the same parser as poems. The reader renders `<p>` elements, not a `whitespace-pre` block.
3. **Limits:** 60,000 characters per chapter (about 10,000 words), 200 chapters per novel, 10 kept revisions per chapter, 2,000 characters of blurb.
4. **Chapter by chapter.** A novel is published once it has at least one published chapter. Each chapter is a draft until its own Publish. Chapters are reordered like collection poems. "Chapter 3 of 12" counts published chapters only.
5. **Reading:** a **book card in the author's section on the board** (one card slot, no separate shelf). The novel page is a full page (cover, blurb, chapter list). **A chapter is always a full page, never the overlay**, with previous/next chapter at the end, a 65-character measure, 18–19 px serif on phones and a 1.7 line height.
6. **"Where you stopped" lives only in the reader's browser** (`localStorage["inkboard-reading"]`: novel id → chapter slug, paragraph number, time; at most 50 novels). It is never sent to the server and needs no cookie. The novel page shows "Continue: Chapter 4" from it.
7. **Phase 1 is public novels only.** Private novels (one password for the whole book, using the author's password mode) come in phase 3. N1 holds from day one: the chapter body is selected with `CASE WHEN` like poems, so turning private on later is a switch, not a rewrite.

---

## 1. Model

### Option A: build on collections and poems

A novel would be a collection with a `kind = 'novel'`, and chapters would be poems in it.

**What it reuses:** slugs, revisions, the password modes and their triggers, `notified_at`, export and deletion, collection ordering (`collection_position`, `placePoem`, `moveCollectionPoem`, drag and drop), "Part n of m", and the collection page.

**What it bends** (every reader path assumes a poem is a short standalone piece):
- **The board and author page** would show every chapter as a poem card, with an excerpt cut from chapter 7. Each of those queries, plus `cardExcerpt` and its SQL twin, would need `kind` filters.
- **Search** would match chapter titles ("Chapter 3") as if they were poems. **Feeds** would carry 60,000-character entries.
- **Notifications:** `claimAnnouncement` would announce each chapter as "a new poem".
- **Share images:** the lines picker would assume verse lines, and the "whole poem" image would never fit.
- **Limits:** `BODY_MAX` (20,000) is shared; raising it for chapters raises it for poems, or every check needs `kind`.
- **The overlay:** a poem soft-navigates into the board overlay, which is the wrong place for a 40-minute read.
- **Novel-level data has nowhere to go:** blurb, cover, status (ongoing or complete) and novel-level visibility. Collections have none, and per-chapter visibility would let a book be half private.
- **Revisions and export:** `poem_revisions` keeps 20 copies of up to 20 KB; at 60 KB a chapter that is 1.2 MB per chapter. The export's "poems" would contain chapters with no notion of a book.

**Verdict:** it reuses the most rows and code, but each reader-facing path would grow a `WHERE kind = …`, and forgetting one is a bug readers see (a chapter card on the board, a chapter in "new poem" notifications). The N1 guarantees were reasoned about for poems; widening `poems` widens every one of them.

### Option B (recommended): `novels` + `chapters`

New tables, parallel to collections and poems, with the poem code's *functions and rules* reused, not its rows.

```ts
// Sketch only: not a migration.
export const novelStatus = pgEnum("novel_status", ["ongoing", "complete"]);

export const novels = pgTable("novels", {
  id: uuid("id").primaryKey().defaultRandom(),
  editorId: uuid("editor_id").notNull().references(() => editors.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  slug: text("slug").notNull(),               // unique per editor, fixed once a chapter is published
  blurb: text("blurb"),                        // plain text, ≤ 2,000
  language: text("language"),                  // BCP 47, like poems; chapters inherit it
  status: novelStatus("status").notNull().default("ongoing"),
  visibility: poemVisibility("visibility").notNull().default("public"),  // phase 3
  passwordHash: text("password_hash"),         // phase 3; per_poem mode only, same triggers as poems
  passwordVersion: integer("password_version").notNull().default(0),
  coverKey: text("cover_key").unique(),        // phase 3: uploaded cover via the photo pipeline; null = drawn cover
  notifiedAt: timestamp("notified_at", { withTimezone: true }),  // the novel's first public chapter announced
  ...timestamps,
}, (t) => [uniqueIndex("novels_editor_slug_key").on(t.editorId, t.slug)]);

export const chapters = pgTable("chapters", {
  id: uuid("id").primaryKey().defaultRandom(),
  novelId: uuid("novel_id").notNull().references(() => novels.id, { onDelete: "cascade" }),
  title: text("title").notNull(),              // "The Harmattan Road"; may be empty → "Chapter n"
  slug: text("slug").notNull(),                // unique per novel, fixed once published
  body: text("body").notNull(),                // prose text model (§2), ≤ 60,000
  position: integer("position").notNull(),     // 1..n over all chapters, drafts included, contiguous
  status: poemStatus("status").notNull().default("draft"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  notifiedAt: timestamp("notified_at", { withTimezone: true }),  // "new chapter" sent at most once
  wordCount: integer("word_count").notNull().default(0),         // computed on save; reading time
  ...timestamps,
}, (t) => [
  uniqueIndex("chapters_novel_slug_key").on(t.novelId, t.slug),
  uniqueIndex("chapters_novel_position_key").on(t.novelId, t.position),
  index("chapters_status_published_idx").on(t.status, t.publishedAt),
]);

export const chapterRevisions = pgTable("chapter_revisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  chapterId: uuid("chapter_id").notNull().references(() => chapters.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  body: text("body").notNull(),
  savedAt: timestamp("saved_at", { withTimezone: true }).notNull().defaultNow(),
});
```

**How each piece carries over:**

| Concern | In option B |
| --- | --- |
| **Scoping** | `src/server/novels.ts`, framework-free, every query scoped by the DAL editor id (chapters through `novels.editor_id`). Foreign ids look missing; malformed ids are rejected before SQL. |
| **Lock order** | editor row (`FOR NO KEY UPDATE`) → novel row → chapter rows. This matches poems → collections, and a password-mode switch can still lock the editor first. |
| **Slugs** | `slugify`/`firstFreeSlug`/`transliterate` reused. A novel's slug is unique per editor and fixed once any chapter is published (it's in every link). A chapter's slug follows its title while a draft, then stays fixed. |
| **Positions** | `positions.ts`, extracted from collections: two-step renumbering, `move up/down/first/last`, whole-order reorder checked against the current set. Collections keep using it. |
| **Revisions** | `recordRevision` generalised over a table: only in the save transaction, only when title or text changed, pruned to `CHAPTER_REVISIONS_KEPT = 10` (10 × 60 KB worst case). Editor-only, with the same "no other module may read it" test. |
| **Passwords (phase 3)** | Novel-level visibility. In `per_poem` mode the novel has its own hash; in `shared` mode the author's one password. `drizzle/0002`'s triggers are extended to novels. Unlock grants: `n:<novelId>:<password_version>`. Unpublishing every chapter bumps the version. |
| **`notified_at`** | On the novel (first public chapter: "New novel by …") and on each chapter ("New chapter of …"). Each is claimed once in the save transaction, as with `claimAnnouncement`. |
| **Share images** | A new "passage" picker over paragraphs (§4); the layout engine, fonts, designs, short links and caching are reused. |
| **Export / deletion** | `ON DELETE CASCADE` from editors → novels → chapters → revisions, so the deletion test's schema walk needs fixture rows for three new tables. Export adds a `novels` array (JSON version 4) and a Markdown section per novel. |

**Why B:** a novel is a different reading object from a poem: a book with a blurb and a status, read over days, chapter by chapter, at length. With B, the board, search, feeds, notifications and share images each get novel code written for novels, and the poem paths stay exactly as tested. The cost is a second set of queries and admin screens, but they are copies of patterns that already exist, and phase 1 extracts the shared pieces (positions, revisions, slugs) instead of duplicating them.

---

## 2. Writing

### The text model: prose isn't verse

Poems keep every line break and leading space (`whitespace-pre-wrap`, `PoemText`), and a `* * *` line is just a line. Prose needs paragraphs that reflow.

| Typed | Poem (today, unchanged) | Chapter |
| --- | --- | --- |
| Blank line | a stanza gap | **new paragraph** (`<p>`) |
| Single line break | a new line | **kept** as `<br>` inside the paragraph (letters, song lyrics, text messages; Ghanaian fiction often quotes songs) |
| Leading spaces/tabs | kept as indentation | **dropped**; paragraphs get the first-line indent from CSS |
| `* * *`, `***` or `#` alone on a line | literal | **scene break**: an ornament (⁂), `role="separator"`, extra space |
| `*x*`, `**x**`, `\*` | emphasis | the same (`parsePoemLine` reused per line) |
| Three or more blank lines | kept | collapsed to one paragraph break |

A new pure module, `src/lib/prose.ts` (`parseProse(text) → Block[]`, where a block is `{ kind: "p", lines }` or `{ kind: "break" }`), feeds a `ProseText` component, `proseToMarkdown` (export), `proseToHtml` (feeds) and `stripProse` (meta, share images). Tests pin it the same way `poem-markdown.ts` is pinned, including a CommonMark rendering of the export.

**Smart punctuation** (curly quotes, en/em dashes): typed text is shown as typed, as with poems. Writers on phones get curly quotes from their keyboards anyway. A display-time "smart quotes" pass would make Ghanaian and English apostrophes inconsistent, so it is left out.

### The editor (see `chapter-editor.html`)

- **One chapter per screen:** chapter title (optional; empty means "Chapter n"), the text in a tall, wide textarea set in the reading font (serif, 18 px, 1.7), and the Special letters bar (body and title). The textarea grows with the text; the toolbar sticks while scrolling.
- A **word count and reading time** under the field, live ("2,431 words · about 10 min"), plus the character count against the limit once past 80%.
- **Save draft / Publish chapter / Update chapter**, with the hidden "keep current status" button first, as in `poem-form.tsx`.
- **Autosave:** a local draft (`localStorage["inkboard-chapter-draft:<chapterId>"]`, cleared on save) every few seconds, so a dropped connection on a phone doesn't lose a page of work. Only the writer's own browser holds it (on the Privacy page). Server saves stay explicit, so revisions mean "a save".
- **Preview** shows the chapter exactly as readers will see it (same `ProseText`, same measure).
- **The novel's own page in admin** (`/admin/novels/[id]`): title, blurb, language, status (ongoing or complete), the chapter list with drafts marked, *Move up / Move down* buttons, drag and drop from the grip as in collections, "New chapter", and Publish/Unpublish per chapter.

### Limits (in `src/lib/novel-limits.ts`)

| Limit | Number | Why |
| --- | --- | --- |
| Chapter text | **60,000 characters** | About 10,000 English words. Typical chapters are 2,000–5,000 words (12–30 K characters), so this leaves room for long ones without letting a whole book into one chapter (which would defeat chapter-by-chapter reading). It's 3× a poem's 20,000. The server action body (~120 KB in UTF-8 with Ghanaian letters) stays far below the 4 MB `bodySizeLimit` set for photos. |
| Chapters per novel | **200** | Long web serials reach 100+. 200 keeps the chapter list, the reorder page and the export bounded. |
| Total per novel | (200 × 60 K = 12 M chars, worst case) | Not limited separately. In practice a 100,000-word novel is ~600 K characters. |
| Chapter title | 150 (`TITLE_MAX`) | Same as poems. |
| Novel blurb | **2,000** | A back-cover blurb is ~150–250 words. 2,000 characters gives room without becoming a second chapter. |
| Novels per editor | **50** | Bounds the author page and the board card count. |
| Revisions per chapter | **10** (not 20) | 10 × 60 K = 600 KB worst case per chapter; poems keep 20 × 20 K = 400 KB. |

### Drafts, publishing, reordering, revisions

- A **novel** has no publish button of its own. Readers can see it once **at least one chapter is published**; until then the novel and its chapters show only in admin. Unpublishing the last published chapter takes the novel off the board (like a collection with nothing published).
- **Chapters publish one at a time.** Readers see the published chapters in order, numbered 1..n over published chapters only, so a draft never leaves a gap (the "Part n of m" rule from collections). A draft chapter 5 between published 4 and 6 is invisible to readers, and 6 reads as "Chapter 5".
- **Reordering** works on all chapters (drafts included), with the same two-step renumbering and stale-order check as collections. Moving a published chapter changes readers' numbering; that's intended, and the chapter's URL (its slug) doesn't change.
- **Revisions** per chapter, as for poems: view an earlier version, restore it into the form, save. Restore never saves by itself.
- **Status:** "ongoing" or "complete", set by the writer, shown on the card and the novel page ("Complete · 24 chapters").

---

## 3. Reading

### On the board: a book card in the author's section (see `board.html`)

The board's sections are the author's work, so a novel goes in its author's section rather than on a separate shelf. A separate "Novels" shelf would split an author across two places and need its own layout, minimap and keyboard paths.

- The book card takes **one card slot** (`CARD_W × CARD_H`, 264 × 184), so the layout engine and the section packing don't change. Books come first in the section, before the poems.
- **The face:** a narrow cover on the left (about 92 × 138, a 2:3 book proportion, drawn from the title on a paper colour of the section's hue until phase 3 covers), then the title, "Novel · 12 chapters · ongoing", and the first line of the blurb. A quiet "Updated 2 days ago" when a chapter was published in the last 14 days.
- It is a stretched link to the **novel page** (a plain `<a>`, not intercepted into the overlay, because a novel isn't read in the overlay). Keyboard and screen readers get the same "title link names the card" pattern as `PoemCardFace`.
- **List view:** a "Novels" sub-list under the author's heading, above the poems.
- **Author page:** a "Novels" row of book cards above Collections and Poems.
- The **language filter** applies the novel's language like a poem's.

### The novel page: `/a/[author]/n/[novel]` (see `novel-page.html`)

- **Cover** (drawn or uploaded), title, author with their picture (`AuthorPicture`), language, status, chapter count, total reading time, and the blurb.
- **Primary action:** "Start reading" (chapter 1), or **"Continue: Chapter 4 · The Ferry"** when this browser has a saved place, with "Start from the beginning" as a quiet link.
- **The chapter list**: number, title, reading time, published date; the next unread chapter is marked from the browser's saved place, chapters read before it are dimmed. No drafts.
- Feed link ("Follow this novel in a feed reader"), Follow author (notifications), Share.
- A real 404 through the proxy (`/missing/novel`) like the other reader routes. Saved for offline, JSON-LD `Book` with `hasPart` chapters, its own OG card (cover, title, author, blurb; never chapter text).

### The chapter page: `/a/[author]/n/[novel]/[chapter]`, a full page (see `chapter-phone.html`)

- **Full page, not the overlay.** The overlay suits a poem glanced at from the board and closed with Back. A chapter is a long sitting: it needs its own URL to bookmark and its own scroll position, and it has next/previous chapter links (in the overlay those would have to `replace` history, as collections do, and a 40-minute read inside a modal fights the browser's own reading features: reader mode, text size, find).
- **Header:** novel title (link back to the novel page), "Chapter 4 of 12", chapter title, reading time. A thin **progress bar** under the sticky top bar shows how far through the chapter the reader is (scroll-driven, CSS `animation-timeline: scroll()` where supported, else nothing).
- **Text comfort:**
  - **measure** `max-width: 34em` (about 65 characters);
  - **type** the serif stack at **19 px on phones** (18 px under 360 px) and 20–21 px from 768 px; **line height 1.7**;
  - paragraphs with a 1.5 em first-line indent and no gap, except the first paragraph after a heading or scene break (no indent), the book convention, which saves vertical space on phones;
  - `hyphens: auto` with the chapter's `lang`;
  - `text-wrap: pretty`;
  - 20 px side padding at 375 px.
- **The end of the chapter:** "Next: Chapter 5 · The Market" as a large 44 px+ button, previous as a quieter link, "Back to the novel" and Share. Plain `<a>` links (full page loads that the service worker can serve), like collection links on the full page.
- **Reader settings** (later phase, optional): text size A−/A+, serif or sans, kept in `localStorage["inkboard-reader-prefs"]`.

### Remembering where a reader stopped, without accounts or tracking

- **Stored where:** only in the reader's browser, `localStorage["inkboard-reading"]`:
  ```json
  { "v": 1, "novels": { "<novelId>": { "chapter": "the-ferry", "paragraph": 37, "at": "2026-11-17T20:14:00Z" } } }
  ```
- **What:** for each novel opened, the last chapter's slug, the index of the first paragraph on screen (from an `IntersectionObserver` on the `<p>`s, written at most every few seconds and on `pagehide`), and when. At most **50 novels**; the oldest are dropped. Nothing else: no reading time, no history of chapters.
- **Never sent** to the server: no cookie, no request carries it, the service worker doesn't touch it. The novel page renders the same HTML for everyone (cacheable, prerenderable), and a small client component reads the store to show "Continue". Opening a chapter at `#p-37` scrolls to that paragraph. The paragraphs carry `id="p-<n>"`, which also gives stable links to a passage.
- **Privacy page:** a new "On your device" item ("which chapter and paragraph you reached in each novel you open, kept only in your browser; clear this site's data to remove it"), with the cap through `PRIVACY_FACTS`.
- **Not done:** syncing between devices (it needs an account; readers have none), and server-side "readers reached chapter n" counts (that would be tracking).

---

## 4. What else changes

| Area | Change |
| --- | --- |
| **Feeds** | The author feed gains one entry per *published chapter* ("Novel title: Chapter 4 · The Ferry"), with the full chapter as HTML via `proseToHtml` (escape first, `<p>`, `<em>`/`<strong>`, `<br>`, `<hr>` for scene breaks). New per-novel feed `/a/[author]/n/[novel]/feed.xml`. The site feed carries **only the first chapter** of each novel ("New novel by …") so it doesn't flood. Entry ids `urn:uuid:<chapter id>`. Private novels (phase 3): title-only entries like private poems. |
| **Notifications** | "New chapter of *The Ferry* by Ama Serwaa", sent to followers of the author **only** (not to `all` mode: a serial publishing weekly would use up the daily alert budget for poems). "New novel by …" (first public chapter) goes to `all` like a new poem. Payload: the same five fields, `url` the chapter, `tag: novel:<id>` so a second chapter replaces the first. The same limits table, `kind = 'chapter'`. Never text. |
| **Share images** | **"Share a passage":** the reader picks consecutive paragraphs (or selects text), up to ~600 characters, shown with the novel's title, "Chapter 4", the author and the short link. Same Satori pipeline, fonts, designs and safe areas; a new `passage` layout reflows prose instead of keeping verse lines. A "whole chapter" image isn't offered (it never fits). Same order of checks as poems: public first, then parse the selection. Short links get `novel_id`/`chapter_id` targets. |
| **Search** | Novel titles join pen names and poem titles (a "Novels" group in the palette). **Chapter titles aren't indexed** ("Chapter 3" would match everything) and **text never is** (as for poems). Same `search_normalize()` indexes. |
| **Offline reading** | Novel pages and public chapter pages are reader kinds (`novel`, `chapter`) with `OfflineMarker`/`SaveForOffline`. The cap grows by kind (`chapter: 60`). Later: a "Save this novel for offline" button that saves every published chapter (bounded by the cap) for a commute without data. A private novel's chapters render `save={false}`, unlocked or not. |
| **Private novels (N1)** | Phase 3. Until then visibility is fixed `public` in the UI, but the loaders already select `body` with `CASE WHEN visibility = 'public'`, and the tests check no chapter text appears for a private novel in any reader JSON (board, novel page, feeds, search, share, OG). A private novel shows its cover, title, blurb (an owner question: is the blurb public?) and chapter titles; one unlock opens every chapter. |
| **Export** | JSON version 4 adds `novels: [{ title, slug, blurb, language, status, visibility, chapters: [{ title, slug, position, status, publishedAt, text, revisions }] }]`, never hashes. The Markdown download gets one section per novel (`## Novel title`, the blurb, `### Chapter n · title`, paragraphs as Markdown paragraphs, scene breaks as `* * *`, rendered with commonmark.js in the test). Big accounts may need the export to stream; measure at 12 M characters. |
| **Deletion** | Cascades from editors. The deletion test needs fixture rows in `novels`, `chapters`, `chapter_revisions`, plus rate-limit keys naming novel ids. Short links to chapters retire their codes like poems'. Covers (phase 3) are deleted from storage like profile photos. |
| **Privacy page** | Novels and chapters under "When you write"; the reading-place store and (phase 2) the chapter-draft autosave under "On your device"; covers under the photo paragraph (R2) once uploaded covers exist; any new caps via `PRIVACY_FACTS`. |
| **Ghanaian letters** | The Special letters bar on the chapter text, chapter title, novel title and blurb. `lang` from the novel's language on the title, blurb and chapter text, never on the UI around it. `hyphens: auto` only where the browser has a dictionary for the language (Twi and Ewe usually don't, so no hyphenation there rather than wrong breaks). Share images and OG cards use `ogFontFamily` as today. Search folding (`SEARCH_FOLD`) covers novel titles. |
| **Welcome checklist** | Unchanged. Its "Publish your first poem" step also counts a first published chapter. |
| **Reader 404s** | `readerPathExists` and the proxy matcher learn `/a/x/n/y` and `/a/x/n/y/z`, with the existing equality test extended. |

---

## 5. Phased plan

| Phase | What ships | Rough size |
| --- | --- | --- |
| **23a: model and writing** | Tables and migration; `novels.ts` (scoping, locks, slugs, positions extracted from collections, revisions generalised); `prose.ts` + `ProseText`; admin: Novels list, novel page with chapter order, chapter editor with word count and local autosave; limits; export (JSON v4 + Markdown) and deletion; integration tests (scoping, positions under concurrency, N1-ready loaders). Nothing visible to readers yet. | **L** (~1.5–2 weeks) |
| **23b: reading** | Book card on the board and author page, list view; novel page; chapter page (full page, measure, type, next/previous); reader 404s; "where you stopped" in `localStorage` with Continue; OG cards and JSON-LD; offline kinds; Privacy page; a11y and phone E2E. **First release to writers and readers.** | **L** (~1.5 weeks) |
| **24: reach** | Feeds (author and per-novel), "new chapter" notifications to followers, novel titles in search, "Save this novel for offline". | **M** (~1 week) |
| **25: private novels and covers** | Novel-level password (extended triggers, unlock grants), uploaded covers through the photo pipeline (2:3 crop, R2, removal, export, deletion), share a passage as an image. | **M–L** (~1.5 weeks) |
| **Later, if asked** | Reader settings (text size, font: done, Phase 26), reading-time stats for writers (done, Phase 27: data already kept only), scheduled chapters, an "ongoing serials" view on the board. | S each |

23a and 23b can ship together if the owner prefers one release; they are split so the data and writing side can be reviewed before anything is public.

---

## 6. Open questions for the owner

1. **Private novels:** needed in the first release, or fine as phase 25? And is a private novel's **blurb** public (like a private poem's title) or behind the password too?
2. **Covers:** is a drawn cover (title on the author's colour) enough at first, or should uploaded cover images come with the first release (it reuses the photo pipeline and R2, about 3–4 extra days)?
3. **Notifications:** "new chapter" to the author's **followers only** (recommended), or also to readers in "all new poems" mode?
4. **Limits:** do 60,000 characters per chapter and 200 chapters per novel suit the writers you expect? Should single-chapter **short stories** be a novel with one chapter, or something of their own?
5. **The board:** book cards in each author's section (recommended), or should novels also get a "New chapters" strip on the board so serial readers find updates without hunting?
