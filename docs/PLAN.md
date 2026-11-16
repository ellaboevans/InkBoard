# InkBoard — Product & Engineering Plan

Living document. Every phase lists the requirements it satisfies and the acceptance
checks that must pass before the phase is considered done. Update the **Status**
column in the traceability matrix as phases land.

---

## 1. Product summary

A public, infinitely pannable/zoomable **canvas board** of poems, organised like an
inventory catalogue: each editor (author) owns a labelled **section** containing
their poems. Visitors browse, search and read. Poems are either **public** (anyone
can read) or **private** (title visible on the board, full text only after the
correct per-poem password is entered).

Editors manage everything from a dedicated **admin dashboard**, signing in with a
**passwordless email one-time code (OTP)** — the first verified code creates their
account; every later sign-in sends a fresh code.

## 2. Requirements

### Functional (from the brief)

| ID  | Requirement |
| --- | ----------- |
| R1  | Public, fully canvas-based board (pan + zoom) displaying poems. |
| R2  | Editors can create, edit and delete poems. |
| R3  | Per-poem visibility: **public** (open to all) or **private** (password required to read). Editors choose per poem. |
| R4  | Dedicated admin dashboard where editors perform all of the above. |
| R5  | Neon (serverless Postgres) is the database. |
| R6  | UI built on shadcn/ui, themed/customised for the product. |
| R7  | Passwordless sign-in: email → OTP. First successful OTP creates the editor record; each return visit requires a newly generated OTP. |
| R8  | Visitors can only *view*: open a poem to read it; private poems prompt for the password first. |
| R9  | Board groups poems by author into labelled sections (catalogue layout). |
| R10 | Full-text search over author names (section labels) and poem titles. |
| R11 | Each editor chooses whether their private poems each have their own password or all share one password, and sets it accordingly. |
| R12 | Poets can write, and readers can read, poems in Ghanaian languages (Ewe, Twi/Akan, Nzema, Ga) with their own letters and tone marks, and linguists can write IPA. Every letter renders in our typefaces, on the site and in share cards, and works in links and search. |
| R13 | Editors can sign in without their email: single-use recovery codes, made on their profile and kept by them, work from any computer. Email codes stay the main way in. |
| R14 | "This isn't my device" at sign-in: a short session that ends when the browser closes, with nothing about the browser remembered, shown as "Public device" in the device list. |
| R15 | Editors can add passkeys on their own computers (from the profile, or from an offer right after a recovery-code sign-in) and sign in with one, with no email and no username. They can name, rename and remove them. |
| R16 | Editors can download everything they wrote: one readable Markdown file, and a complete JSON backup (profile, collections, every poem with its saved versions, drafts and private poems included). |
| R17 | Editors can delete their account: every poem, collection, revision, passkey, recovery code and session goes at once, readers stop seeing the author everywhere, and the author's links never point at anyone else. |

### Non-functional (derived — needed to meet the brief safely)

| ID  | Requirement |
| --- | ----------- |
| N1  | A private poem's body is **never** sent to the browser until unlocked, and is never part of the search index. |
| N2  | OTPs: 6 digits, stored only as HMAC, single-use, 10-minute expiry, max 5 attempts, previous codes invalidated when a new one is issued. |
| N3  | Rate limits on: OTP requests (per email + per IP), OTP verification, private-poem password attempts. |
| N4  | Sessions: opaque random token in an `httpOnly`, `Secure`, `SameSite=Lax` cookie; only a SHA-256 hash is stored; revocable (sign-out deletes the row); 30-day lifetime. |
| N5  | Authorisation is enforced server-side in a Data Access Layer: editors can only see/modify their own poems; every Server Action re-verifies the session. |
| N6  | Poem passwords hashed with scrypt (per-poem salt). Changing the password revokes existing unlocks. |
| N7  | Accessibility: the board is keyboard navigable and has a list/search fallback; reading view is plain semantic HTML. |
| N8  | Performance: public board data is cached (`"use cache"` + tags) and invalidated when an editor publishes/edits. |
| N9  | No user enumeration from the sign-in form (same response whether or not an account exists / is allowed). |
| N10 | Recovery codes: ≥ 50 bits each, stored only as HMAC, compared in constant time, single use under concurrency, tiered guess limits (IP → email+client → email), no enumeration, an email on every use and every new set. Making or replacing them needs proof of inbox access within 10 minutes (step-up). |
| N11 | Passkeys: random single-use challenges (~5 min) tied to the browser, and for registration to the editor and session; exact origin and RP ID from APP_URL; user verification required to sign in; only public key material stored; the counter must rise; IP rate limits; every query scoped by editor; adding and removing need a recent verification (with one documented exception after a recovery-code sign-in), never added on a public device; an email for every passkey added or removed. |
| R18 | Readers can get a notification on their device (phone or computer, including the installed app) when a new public poem is published, and tap it to open the poem. No account; turned on and off per device. |
| N12 | Downloads are the DAL-resolved editor's own data only, never secrets (password hashes or versions, sign-in data, recovery codes, passkeys, the email address); rate-limited per editor; `no-store`. Deletion needs a recent verification plus the pen name typed back, runs in one transaction that leaves no row of the editor in any table, retires the author slug, and emails a notice. |
| N13 | Notifications: a poem is announced at most once ever, and only if it first goes on the board as a public poem by an author with a pen name; private poems never. Payloads carry only title, pen name, link and tag. At most one notification per author per device in 12 hours and three per device in 24 hours, claimed atomically before sending. Subscriptions hold only endpoint, keys and timestamps, on an allowlist of push services; rate-limited per IP bucket; deleted on 404/410, on "off", and after 90 days we couldn't use them. VAPID private key server-only; the subject a real https URL or mailto. |

## 3. Architecture & key decisions

| Area | Decision | Why |
| ---- | -------- | --- |
| Framework | **Next.js 16** App Router, Cache Components + Partial Prefetching (scaffold defaults), TypeScript strict | Server Components keep private content server-side by default (N1); Server Actions for mutations. |
| DB | **Neon Postgres** via **Drizzle ORM** + drizzle-kit SQL migrations | Typed schema, plain SQL migrations reviewable in PRs. |
| DB driver | `@neondatabase/serverless` (WebSocket pool, supports transactions) when `DATABASE_URL` points at Neon; `pg` for local Postgres | Same code path for prod and local dev/tests; no Neon account needed to develop. |
| Auth | **Custom email-OTP** (≈300 lines, fully tested) rather than a framework | Requirement is narrow (OTP only, no passwords/OAuth). Owning it keeps every rule in N2–N4/N9 explicit and testable. |
| Email | **Resend** everywhere, local development included; codes are never printed. Only automated tests skip it (Vitest mocks the module, E2E writes to an outbox file) | Simple API, good deliverability. Swappable behind `sendOtpEmail()`. |
| UI | **shadcn/ui** (Radix base, Nova preset) with a custom "paper & ink" theme; serif face for poem text | R6. |
| Board rendering | **Infinite canvas of DOM nodes in a CSS-transformed world layer** (pan/zoom via pointer, wheel, pinch, keyboard) | Behaves like Figma/Miro, but text stays crisp, selectable, translatable, screen-reader accessible and every card is a real link (N7). A raw `<canvas>` would require re-implementing text layout, hit-testing and accessibility. Virtualise off-screen sections if counts grow. |
| Board layout | Deterministic auto-layout: author sections on a grid ("shelves"), poems as cards inside | Predictable catalogue (R9). Free-form placement by editors is a possible later feature. |
| Search | Postgres FTS (GIN expression indexes on `to_tsvector('simple', search_normalize(…))`) on poem **title** and author **pen name**, plus `pg_trgm` for typo-tolerant matches | R10 without an external service; bodies are excluded (N1). |
| Private unlock | Server Action verifies password → adds a grant to one signed (HMAC) cookie, 12h expiry. A grant covers one poem (`p:<poemId>:<password_version>`) or, in shared mode, all of an author's private poems (`a:<editorId>:<shared_password_version>`) | Stateless, revocable on password change (N6). |
| Rate limiting | Fixed-window counters in a Postgres table (`rate_limits`) | Works on serverless without adding Redis; can be swapped for Upstash later. |
| Feeds | **Atom 1.0** (`/feed.xml`, `/a/[author]/feed.xml`), not RSS 2.0 | Per-entry `xml:lang` for a poem's language (RSS has one channel-wide `<language>`); standard `published` *and* `updated`; `<author><name>` is a name, while RSS's `<author>` must be an email, which we never expose. |
| SEO & sharing | Next.js metadata file conventions (`icon.svg`, `favicon.ico`, `apple-icon`, `opengraph-image`, `robots`, `sitemap`, `manifest`); share cards rendered with `ImageResponse` | No third-party service or CSP change; cards and sitemap reuse the cached board data. |

### Data model

```
editors      id · email (unique, lower-cased) · pen_name · slug (unique) · bio · created_at · updated_at · last_sign_in_at
             · password_mode(per_poem|shared) · shared_password_hash · shared_password_version      (Phase 4)
             CHECK (password_mode = 'per_poem' OR shared_password_hash IS NOT NULL)
email_otps   id · email · code_hash · expires_at · attempts · consumed_at · created_at · requested_ip
sessions     id · editor_id → editors · token_hash (unique) · expires_at · created_at · user_agent · ip
poems        id · editor_id → editors · title · slug (unique per editor) · body · visibility(public|private)
             · password_hash · password_version · status(draft|published) · published_at · created_at · updated_at
rate_limits  key (pk) · window_start · count
```

Phase 7 adds to `editors`: `tagline` · `avatar` (curated id) · `links` (jsonb, ≤ 4 https URLs) · `pinned_poem_id` → poems (ON DELETE SET NULL).

Phase 9 adds:

```
sign_in_locations  id · editor_id → editors · ip_key (HMAC of the network, never the IP) · first_seen_at · last_seen_at
sign_in_devices    id · editor_id → editors · device_key (HMAC of the device-cookie id) · first_seen_at · last_seen_at
                   UNIQUE (editor_id, ip_key)
```

Phase 11c adds `poems.language` (BCP 47 tag, nullable). Phase 13 adds:

```
poem_revisions  id · poem_id → poems (ON DELETE CASCADE) · title · body · language · saved_at (clock_timestamp())
                INDEX (poem_id, saved_at DESC); newest 20 per poem; no password, hash or visibility columns
```

Phase 14 adds:

```
collections  id · editor_id → editors (CASCADE) · title · slug (unique per editor, fixed) · intro · created_at · updated_at
poems        + collection_id → collections (SET NULL) · collection_position (1..n over all its poems, drafts included)
             UNIQUE (collection_id, collection_position)
```

"A private poem is always readable with some password" (its own in per-poem mode, the
author's shared one in shared mode) is enforced by triggers in
`drizzle/0002_password_mode_triggers.sql`, which replaced Phase 0's
`CHECK (visibility = 'public' OR password_hash IS NOT NULL)`.

Phase 16 adds:

```
recovery_codes  id · editor_id → editors (CASCADE) · code_hash (HMAC, unique) · used_at · created_at
                10 per editor; a new set deletes the old one (used rows stay until then, for "n of 10 left")
step_up_codes   id · session_id → sessions (CASCADE) · code_hash (HMAC) · expires_at · attempts · consumed_at · created_at
sessions        + public_device (bool) · sign_in_method (email|recovery) · email_verified_at (null after a recovery sign-in)
editors         + recovery_prompt_dismissed_at
```

Phase 16 round 2 (passkeys) adds:

```
passkeys             id · editor_id → editors (CASCADE) · credential_id (base64url, unique) · public_key (COSE, base64url)
                     · counter (bigint) · transports · device_type · backed_up · name · created_at · last_used_at
webauthn_challenges  id · token_hash (SHA-256 of the cookie token, unique) · purpose (registration|authentication|step-up)
                     · challenge · editor_id · session_id · expires_at (~5 min) · created_at; deleted when taken
editors              + webauthn_user_id (opaque random user handle, unique)
sessions             + sign_in_method 'passkey' · passkey_verified_at · passkey_offer_dismissed_at
```

Phase 17 adds:

```
retired_slugs  slug (pk) · retired_at; author slugs of deleted accounts, never given out again
               (trigger editors_slug_not_retired, drizzle/0016_retired_slugs_guard.sql)
```

Phase 5 adds GIN expression indexes (tsvector + trigram) over `search_normalize(pen_name)` and
`search_normalize(title)`, in `drizzle/0003_search.sql` only (drizzle-kit doesn't model them).

### Route map

```
/                      Public canvas board (R1, R9) + search (R10)
/p/[author]/[poem]     Reading view; password gate for private poems (R8)
/a/[author]            Author's public page: avatar, tagline, bio, links, poems (pinned first)
/sign-in               Email → OTP (R7); "This isn't my device" (R14); "Sign in with a passkey" + autofill (R15)
/sign-in/recovery      Email + recovery code (R13, Phase 16)
/admin                 Dashboard: my poems (R4)
/admin/onboarding      First sign-in: choose pen name (the section label)
/admin/poems/new       Create poem (R2, R3)
/admin/poems/[id]      Edit poem, visibility, password, publish, delete (R2, R3); History panel,
                       ?version=<revision id> opens a saved version read-only (Phase 13)
/admin/settings        Private-poem password mode (R11); download your poems (R16); delete account (R17)
/admin/export/[format] GET: the editor's own poems as a file, format = markdown | json (R16)
/admin/collections     Your collections; create one (Phase 14)
/admin/collections/[id]  Order its poems (keyboard), add/remove poems, rename, intro, delete
/admin/profile         Avatar, pen name, tagline, bio, links, pinned poem, stats, recovery codes, signed-in devices
/avatars/[id]          Curated avatar SVGs (prerendered, cached forever)
/api/search?q=         Search authors and poem titles (R10)
/api/cron/cleanup      Daily cleanup of expired rows (Bearer CRON_SECRET)
/robots.txt            Crawl rules: everything except /admin and /api/
/sitemap.xml           Board, author pages and published poems
/feed.xml              Atom feed: the newest 50 published poems on the board
/a/[author]/feed.xml   Atom feed: one author's newest 50 published poems
/a/[author]/c/[collection]  A collection's public page: its published poems in reading order (Phase 14)
/manifest.webmanifest  Web app manifest (name, colours, icons)
/opengraph-image       Share cards; also under /p/[author]/[poem] and /a/[author]
/icon.svg, /favicon.ico, /apple-icon   Logo icons
```

## 4. Delivery phases

Each phase ends with: typecheck + lint + tests green, a manual check of the
acceptance criteria, and a security review of the diff for phases that touch
auth or private content.

### Phase 0: Foundations ✅
- Next.js 16 + TypeScript + Tailwind v4 + shadcn/ui scaffold, custom theme tokens and fonts.
- Typed env validation (`src/env.ts`).
- Drizzle schema for all core tables, first migration, Neon/local driver switch.
- Vitest set up against a real local Postgres (`poemhub_test`).
- **Accept:** `pnpm db:migrate` creates the schema on a fresh DB; `pnpm typecheck && pnpm lint && pnpm test` pass.

### Phase 1: Passwordless editor auth (R7, N2–N5, N9) ✅
- `/sign-in`: email step → 6-digit OTP step (shadcn `InputOTP`), resend with cooldown.
- OTP issue/verify service, rate limits, session create/read/revoke, `proxy.ts` optimistic redirect, DAL `requireEditor()`.
- Onboarding: first sign-in asks for a pen name (becomes the board section label, R9).
- Optional allowlist (`EDITOR_ALLOWLIST`) to restrict who can become an editor.
- **Accept:** new email → code → account created → onboarding → `/admin`. Same email later → new code → same account. Wrong code ×5 locks that code; reused/expired codes rejected; sign-out revokes the session; `/admin` unreachable when signed out.
- **Security review (done):** an independent review found 7 issues and all but #5 were fixed, each with a regression test:
  1. The verify step revealed allowlist membership. Non-allowed emails now get a decoy code row, so responses are identical.
  2. Response timing revealed allowlist membership. Email is now sent in `after()`, once the response has gone out.
  3. Guesses per email were unbounded across codes. They are now capped at 10 per hour and 30 per day.
  4. `X-Forwarded-For` was spoofable. The IP is now read from the trusted hop (`TRUSTED_PROXY_HOPS`), requests with no IP share one bucket, and there is a global send cap.
  6. Sessions survived removal from the allowlist. The allowlist is now re-checked on every session read.
  7. The `__Host-` cookie wasn't cleared on sign-out. It is now overwritten with the same attributes.

  `rate_limits` rows are also pruned opportunistically.
- **Known trade-offs (revisit in Phase 6):**
  - The per-email caps let an attacker lock a specific editor out of sign-in for up to a day (#5). Fixed in Phase 6 with per-(email, client) budgets.
  - IP limits only hold behind a proxy that sets `X-Forwarded-For` (e.g. Vercel).
  - If the email fails to send, the editor still sees "code sent"; the failure is logged server-side and the editor can press resend.
  - Never deploy with `NODE_ENV=development` and no `RESEND_API_KEY`: codes would go to the logs.

### Phase 2: Admin dashboard and poem management (R2, R3, R4, N5, N6) ✅
- Dashboard: the editor's poems in a table with status and access badges, newest edit first.
- Editor form (`/admin/poems/new`, `/admin/poems/[id]`):
  - Title and body. The body is plain text: line breaks and indentation are kept, line endings are normalised, and outer blank space is trimmed.
  - "Password protected" switch with a password field (min 6 characters). Leave it blank when editing to keep the current password.
  - Save draft / Publish / Save changes / Unpublish; ⌘S saves.
  - Unsaved-changes indicator and a warning before closing the tab.
  - Delete, behind a confirmation dialog.
- Rules (in `src/server/poems.ts`, tested):
  - Every query is scoped to the signed-in editor, so another editor's poem id just looks "not found".
  - Password hashes never leave the server; the UI only gets `hasPassword`.
  - Passwords are hashed with scrypt.
  - A new password bumps `password_version`, which will revoke reader unlocks in Phase 4.
  - Making a poem public removes its password; making it private again requires a new one.
  - Slugs are unique per editor. A draft's slug follows its title, but stays fixed once the poem has been published so links don't break.
  - `publishedAt` is set on first publish only.
- Admin mutations already call `updateTag("board")` and `updateTag("poem:<id>")` (`src/server/cache-tags.ts`) for the Phase 3 board cache.
- **Accept:** an editor can CRUD only their own poems (tested by trying another editor's id); making a poem private without a password is rejected client- and server-side; changing a password bumps `password_version`.
- **Security review (done):** an independent review found no cross-editor access, no password hashes reaching the browser, and no validation bypass. It found three issues, plus a fourth during the fixes. All are fixed, each with a test that failed before the fix:
  1. Pressing Enter in a text field published a draft, because the browser submits with the form's first button ("Publish"). The form's default button now saves without changing the status.
  2. Concurrent saves (e.g. two tabs) could leave a public poem with a stale password, or crash with a constraint error. Password rules are now applied inside the UPDATE, based on the row at write time.
  3. A malformed stored hash (empty key) would accept any password. `verifyPassword` now only accepts the exact parameters and lengths we issue, caps the input length, and never throws.
  4. Found while fixing: signing out kept earlier admin pages, including private poem text, hidden in the tab (Next's `<Activity>`). Sign-out now does a full page reload.
- **Not in this phase:** `/admin/profile` (changing pen name or bio, managing sessions). Done in Phase 6.

### Phase 3: Public canvas board (R1, R9, N7, N8) ✅
- **Data** (`src/server/board.ts`): published poems from onboarded editors, grouped by author A–Z, newest poem first. Excerpts (first 5 lines) and bodies are computed in SQL with `CASE WHEN visibility = 'public'`, so a private poem's text never leaves the database (N1). Cached in `board-cache.ts` with `"use cache"`, `cacheTag("board")` and `cacheLife("hours")`; admin saves invalidate it immediately.
- **Layout** (`src/lib/board-layout.ts`): pure and tested. Each author gets a "shelf" with a card grid of up to 4 columns, and shelves are packed into rows to suit a landscape screen.
- **Canvas** (`src/components/board/board-canvas.tsx`):
  - Move around by dragging, trackpad scrolling, the arrow keys, or one finger on touch.
  - Zoom with ⌘/Ctrl + scroll, a trackpad or two-finger pinch, the ± buttons, or the keys `+` `-` `0` (fit all) and `1` (100%).
  - Every author has a colour. The Authors index jumps to a section, and so does clicking a section's name.
  - The minimap supports click and drag.
  - Below 40% zoom, cards fade and large author names take over.
  - Opens on "fit all", or at a reading zoom on the first shelf when fitting everything would be too small (big boards, phones).
- **Accessibility (N7):** every card is a real link in catalogue tab order, and tabbing to an off-screen card pans it into view. The board has a screen-reader description of its controls. A **List view** shows the same catalogue as plain headings and lists.
- **Reading page** `/p/[author]/[poem]`: full text with indentation kept. Private poems show a lock notice for now; password entry is Phase 4.
- **Demo content:** `pnpm db:seed` (scripts/seed.ts) adds 10 fictional authors and 48 original published poems (11 private, password `moonlight`), plus 2 drafts that must not appear. It only ever touches `@seed.poemhub.test` editors. `pnpm db:seed --clear` removes them.
- **Accept:** board renders N authors × M poems smoothly; tab order reaches every card; private card HTML contains no body text. All three are covered by E2E tests.
- **Deferred:** opening a poem as a modal over the board (an intercepted route) moves to Phase 4, together with the unlock flow.

### Phase 4: Reading view and private unlock (R3, R8, N1, N3, N6, R11) ✅
Done:
- **Password mode, chosen by each editor (R11)** at `/admin/settings`:
  - **A different password for each poem** (the default): set on each private poem in the editor.
  - **One password for all my private poems:** set once in Settings; the poem editor then hides the password field.
  - *Per poem → shared:* the editor must enter the shared password. Poem-level passwords are cleared and stop working.
  - *Shared → per poem:* every private poem starts with the shared password as its own, so none is left unprotected. The editor can then change them one by one.
  - **Database guarantee:** a private poem can never be unreadable. Either it has its own password (per-poem mode) or its author has a shared one. A CHECK on `editors` plus two triggers enforce this (`drizzle/0002_password_mode_triggers.sql`).
  - **Concurrency:** poem saves and mode switches lock the editor row first, so they can't deadlock or race. This is tested with concurrent saves and switches.
- **Reader unlock** (`src/server/unlock.ts`):
  - The password form on `/p/[author]/[poem]` calls a Server Action, which sets an HMAC-signed `httpOnly` cookie of grants lasting 12 hours.
  - A grant covers one poem in per-poem mode, or all of the author's private poems in shared mode, including ones added later.
  - Grants carry the password version, so changing a password, changing the shared password, or switching modes locks every reader out.
- **Wrong-guess limits:** 10 per IP per poem (or per author in shared mode) per 15 minutes, and 60 per IP per hour overall.
- **Accept:** wrong password shows an error and never reveals the body; correct password reveals it; changing the password in admin re-locks it for readers. All covered by unit and E2E tests, for both modes.

- **Board overlay:** clicking a poem on the board opens it in an overlay (`src/app/@modal/(.)p/[author]/[poem]`, an intercepting route in a parallel slot), with the board kept underneath at the same pan/zoom position.
  - Close it with Esc, the X, a click outside, or Back; they all use browser history.
  - The URL is the poem's own, so it can be shared. Opening it directly or refreshing shows the full page, and "Open full page" does too.
  - On phones it becomes a bottom sheet. Private poems unlock inside the overlay.
  - The full page and the overlay share `src/components/poem/poem-reader.tsx`.

### Cross-cutting: action feedback (toasts) ✅
- Every user-facing action result is shown as a [Sileo](https://sileo.aaryan.design) toast at the top centre, sized to fit phone screens. Inline field errors stay next to their inputs as well, because toasts aren't focusable.
- Covered: sign-in (code sent, new code, wrong code, rate limit), signed in/out, onboarding, poem save/publish/validation/delete, password settings, and reader unlock (wrong password, rate limit, unlocked).
- Unexpected failures (Server Action throws) become a friendly "Something went wrong" toast, and what the user typed is kept. Pages that fail to render show `src/app/error.tsx`, with a retry button and a reference code.
- `pnpm dev` first checks that the database has every migration (`scripts/check-migrations.ts`, also `pnpm db:check`). If not, it stops and tells you to run `pnpm db:migrate`, instead of failing later with "column does not exist".

### Phase 5: Full-text search (R10) ✅
- **Index** (`drizzle/0003_search.sql`):
  - GIN indexes on `to_tsvector('simple', …)` and on trigrams (`pg_trgm`), over author pen names and poem titles only.
  - `search_normalize()` is an immutable wrapper around `unaccent` + `lower`, so matching ignores case and accents ("jose" finds "José").
  - Poem bodies are not indexed (N1).
- **Matching** (`src/server/search.ts`):
  - Every word must match, as a prefix ("ros gar" finds "Rose Garden").
  - Only if a group (authors or poems) has no matches does it fall back to typo-tolerant matching, still requiring every word ("dickenson" finds "Dickinson"), and only for queries of 4+ characters. Matching typos on every query flooded short ones with noise.
  - Query words are reduced to letters and digits before reaching `to_tsquery`, so search syntax typed by users is treated as plain text.
- **API:** `GET /api/search?q=` returns titles and names only, for published poems by onboarded editors. Limited to 120 requests per IP per minute.
- **UI:**
  - ⌘K / Ctrl+K, `/`, or the Search button opens a palette with results grouped as **Authors** and **Poems** (private poems show a lock).
  - Picking an author moves the board to their section and focuses its label. Picking a poem moves to its card, highlights it and focuses it, so Enter opens it in the overlay.
- **Accept:** prefix ("ros" → "Rose"), multi-word and slightly misspelt queries match; poem bodies never match. Covered by unit tests (including a mutation check that the text test fails if bodies become searchable) and E2E.

### Phase 6: Hardening and launch ✅
Done:
- **Security headers** (`next.config.ts`, all routes):
  - The CSP allows only our own origin, with no framing, no plugins, and forms posting only to us. Scripts have `'unsafe-inline'` and no nonces, because nonces would disable prerendering; no user HTML is ever rendered.
  - Also HSTS (production only), `nosniff`, `Referrer-Policy`, `Permissions-Policy`, COOP and `X-Frame-Options`. The `X-Powered-By` header is removed.
  - Verified on a production build: the board, search, overlay, unlock, toasts and sign-in all run with zero CSP violations.
- **Cleanup cron** (`src/server/maintenance.ts`, `GET /api/cron/cleanup`, `vercel.json`):
  - Runs daily and deletes expired sign-in codes, expired sessions and stale rate-limit rows, after a grace period.
  - Requires `Authorization: Bearer $CRON_SECRET` (constant-time compare). It returns 503 if the secret isn't set and 401 for any other caller.
- **Deploy guide** (`docs/DEPLOY.md`):
  - Neon via Vercel's integration, with a database branch per preview deployment.
  - Migrations run on every build (`pnpm db:migrate && pnpm build`) over `DATABASE_URL_UNPOOLED`.
  - The env var table, Resend domain verification, and a post-deploy checklist.
- **Launched** (done by the product owner): Neon and Vercel projects created, a Resend sending domain verified (SPF, DKIM, DMARC), and the env vars from `docs/DEPLOY.md` set, including `APP_URL`. The site is live.
- **E2E coverage** for sign-in, publish, board, overlay, unlock (both password modes) and search. 24 tests at the time; 35 today, after Phases 7–9.

- **Full-app security review (done):**
  - No high-severity issues, and no path for private poem text to reach a browser without a valid grant. This covered RSC payloads, the cache, the overlay, error pages, search and metadata.
  - Four smaller findings, all fixed with tests:
    1. *(Medium)* Wrong-guess limits could be dodged by rotating IPs. Every rate limit now groups IPv6 addresses by /64 (`ipBucket`), and unlocks have an extra cap of 300 per hour per poem (or per author in shared mode) across all clients.
    2. Unpublishing a poem now revokes its unlocks.
    3. Settings now says that a shared-password unlock also covers poems made private later.
    4. `CRON_SECRET` must be 32+ characters when set.

- **Profile** (`/admin/profile`, linked from the admin header):
  - Change pen name and bio (bio: plain text, up to 500 characters). Saving invalidates the board cache, so the new section label shows at once.
  - The author slug stays fixed after onboarding, so every shared `/p/<author>/<poem>` link keeps working after a rename (same rule as published poem slugs).
  - **Signed-in devices:** lists the editor's live sessions (browser and OS, sign-in date, IP, expiry), marks "This device", and can sign out any other device or all of them. Revoking is scoped by editor, so another editor's session id behaves like a missing one.
  - Covered by integration tests (rename keeps slug, bio normalisation, cross-editor revoke, sign out others) and two E2E tests.

- **Sign-in lockout (#5 from the Phase 1 review), fixed** (`src/server/auth/otp.ts`):
  - Code guesses are now limited per (email, client) at 10/hour and 30/day, so the editor's own connection has its own budget. A shared per-email backstop of 30/hour and 100/day still bounds brute force across rotating IPs (at most ~3.7% a year of nonstop effort against one account).
  - Limits are checked in tiers. A client that is over its own budget never counts against the shared one, so a single attacker can't lock an editor out. It now takes 4+ clients a day. Tested, including a check that the test fails without the tiering.
  - Still possible: an attacker with many IPs can exhaust the backstop, and anyone can use up the 5-requests-per-15-minutes limit on sending codes to one email. Both are bounded and short-lived. A magic link in the email (a long random token, which can't be guessed and so can skip guess limits) would remove the first entirely, and is the follow-up if this becomes a problem.

- **Automated accessibility checks (N7)** (`e2e/a11y.spec.ts`, axe-core, WCAG 2.2 A/AA):
  - Covers every screen and state (29 scans today, light theme only since Phase 7): sign-in steps, onboarding, dashboard, poem editor (incl. validation errors and the delete dialog), settings, profile, board, list view, search palette (empty, results, no results), overlay (public, locked, wrong password), and the full poem page (locked, unlocked, not found).
  - Fixed what it found:
    1. Error text was below 4.5:1 contrast (4.42:1 on paper, 4.1:1 on its tint, 3.92:1 in the dark theme). The `--destructive` token was darkened in light mode and lightened in dark mode.
    2. Board cards were links whose `aria-label` hid their visible text (WCAG 2.5.3), so screen readers couldn't read excerpts. Cards are now stretched title links: the title is the link and its name, and the excerpt is plain text.
    3. The search palette rendered an empty `listbox` before any results (an ARIA error). Status messages now sit outside it, and it's hidden until there are results.
    4. Found while scanning: after closing one poem's overlay and opening another, the dialog kept the old poem's name, because the overlay used a fixed id and Next keeps the previous overlay mounted but hidden. The poem's title is now the Radix `DialogTitle`, whose id is unique to each dialog.
  - The dark theme that was scanned at the time was removed in Phase 7, so only the light theme is checked now.

- **Manual screen-reader pass (N7)** (done by the product owner): VoiceOver on sign-in, the poem editor, the board, the overlay and the search palette. Passed.

### Phase 7: Editor dashboard redesign ✅
Decided with the product owner: shadcn **sidebar-08** shell, **login-02** sign-in, **Navii** avatars via `@usenavii/core`, **light mode only**. The public author page followed in Phase 8.
- **Shell** (`src/app/admin/(dashboard)/layout.tsx`): inset sidebar that collapses to icons (⌘B / Ctrl+B) and becomes a drawer on phones. It has a "New poem" button, Poems / Profile / Settings, "View the board", and an account menu (avatar, pen name, email → Profile, Settings, Sign out) with breadcrumbs in the top bar. This fixes the old header, where Sign out was pushed off-screen on phones.
- **Dashboard home:** stat cards with real counts only (published, drafts, private, last/first published; no reader analytics, so no charts), and a poems table with All / Published / Drafts / Private tabs, title search and a row menu (Edit, View on the board, Copy link, Pin to profile, Delete with confirmation). Phones get a card list.
- **Sign-in and onboarding** (`src/components/auth/auth-shell.tsx`): two columns, with the form on the left and a typographic panel on the dotted canvas (an original poem) on the right, large screens only. No images, no social buttons.
- **Avatars** (`src/lib/avatars.ts`, `src/server/avatar-svg.ts`, `/avatars/[id]`): 36 curated Navii mascots (fixed seeds, 12 muted palettes, hue drift off, paper tile), rendered on our server, so there is no third-party request or CSP change. Editors who haven't chosen get a stable default derived from their id.
- **Profile:** avatar picker, tagline (≤ 80), bio, up to 4 links (https only, no credentials, normalised), pinned poem (only the editor's own published poems, checked server-side), and a summary with stats. Tagline, links and the pinned poem appear on the public author page (Phase 8).
- **Light only:** the dormant dark theme was removed; `color-scheme: light`.
- **Tests:** unit tests for links, tagline, avatar ids, pin ownership (incl. another editor's poem and FK unpin on delete), stats and avatar rendering. E2E covers the rich profile, dashboard filters/search, the phone drawer and sign-out. axe covers the new screens (row menu, phone view, drawer).

### Phase 8: Public author page ✅
- **`/a/[author]`** (`src/app/a/[author]/page.tsx`): avatar, pen name, tagline, bio, links (open in a new tab with `rel="me nofollow ugc noopener noreferrer"`), poem count and "on InkBoard since". Then the author's published poems as board cards, pinned poem first, then newest first. Unknown or not-yet-onboarded authors get "Author not found".
- **Data** (`loadAuthorPage` in `src/server/board.ts`, cached as `getAuthorPage` with `BOARD_TAG`): published poems only; private poems are title-only cards (bodies cut in SQL, N1). The email is never selected. A pinned poem that has since been unpublished is ignored.
- **Links in:** the "by …" byline on every poem (full page and overlay), and "View public page" on the editor's profile. Pinning from the poems list now invalidates the cache, so the page updates at once.
- Also this phase: the editor's live card preview (shared `PoemCardFace` and `cardExcerpt`, tested against the board SQL), and the blooming poem stack on the sign-in page.
- **Tests:** loader integration tests (no private text or email in the payload, drafts excluded, pinned first and dropped when unpublished, unknown authors). E2E for the whole flow, and an axe scan of the page.

### Phase 9: Security emails ✅
- **Sign-in code email** (`otpEmail` in `src/server/email-templates.ts`), laid out for mail clients' one-time-code detection (Gmail "Copy code", Apple Mail AutoFill, Outlook):
  - Subject "Your InkBoard One Time Password" (a fixed subject, chosen by the product owner). "code" and the code itself lead the preview text and the first line.
  - The code alone on its own line, bold, as one unbroken run of digits. A plain-text part has the same structure.
  - No other 4–8 digit numbers in the message, so a detector can't pick the wrong one (tested).
  - `Auto-Submitted` / `X-Auto-Response-Suppress` headers; no images or tracking.
  - Detection itself is heuristic and up to the client. It also requires SPF, DKIM and DMARC on the sending domain (docs/DEPLOY.md §3). We don't add an `OTP-Token` header: we couldn't confirm any standard or client support, and it would copy the code into more logs.
- **Welcome email** (`src/server/welcome.ts`, `welcomeEmail`): sent once to a newcomer when they finish onboarding (first sign-in, pen name chosen): what they can do on InkBoard and where to start, signed by Evans Elabo, Creator. `editors.welcomed_at` is claimed atomically before sending, so resubmitted or concurrent onboarding can't send it twice; editors who onboarded before it shipped are marked welcomed by the migration. A failed send is logged, not retried.
- **New sign-in alert** (`src/server/auth/sign-in-alerts.ts`, `signInAlertEmail`): after a successful sign-in from a device (browser, recognised by a long-lived random cookie) or a network (IPv4 address or IPv6 /64) not seen before for that editor, they get an email that says which was new with the device ("Chrome on macOS"), IP address and time (UTC), and what to do if it wasn't them: sign the device out under Signed-in devices, and secure their email.
  - Networks alone missed a new machine on the same Wi-Fi (same public IP), so devices were added. No alert for the first device or network ever recorded (or the first after each shipped), or on a known device and network. A new device is caught even without a client IP. At most 5 alerts per editor per day.
  - `sign_in_locations` stores only an HMAC of the network, never the IP; `sign_in_devices` only an HMAC of the device id. Rows unused for a year are pruned by the cleanup cron.
  - Sent after the response (like codes); a failure is logged and never blocks the sign-in.
  - The alert never says "code", so clients don't offer to "copy" the date in it (tested).
- **Tests:** template tests (subject, unbroken code, no other digit runs, escaping, UTC time), alert logic (first, known, new, IPv6 /64, unknown IP, per editor, no raw IP stored, daily cap), cleanup, and E2E for a sign-in from a second network and from a second device on the same network.

### Phase 10: SEO and link sharing ✅
- **Logo icons:** the favicon is the InkBoard logo (white Feather on the ink-red tile) instead of the Next.js default: `src/app/icon.svg`, a multi-size `favicon.ico` (16/32/48) generated from it, and a 180px `apple-icon` for iPhone home screens. A web manifest uses the same icons and the paper colour.
- **Share cards** (Open Graph and Twitter/X, 1200×630, `src/components/brand/og-card.tsx`): one for the site, one per poem (title, author, first three lines) and one per author (pen name, tagline, poem count), set in Newsreader. Private poems show only title and author, never text (N1).
- **Metadata:** `metadataBase` from `APP_URL` (Vercel's production domain as fallback), a canonical URL, title and description on every public page, `og:type` article/profile, and large image previews in search results. Public poems use their opening lines as the description; private ones a generic line.
- **Crawling:** `robots.txt` (blocks `/admin` and `/api/`, links the sitemap) and `sitemap.xml` (board, authors, published poems; cached with `BOARD_TAG`, so it follows publishes). `/admin`, onboarding and `/sign-in` are `noindex`.
- **Structured data (JSON-LD):** the site on `/`, each poem as a `CreativeWork` with author and date (text only when public), each author as a `ProfilePage`. Never the email.
- **Lessons recorded in CLAUDE.md:** a relative canonical in the root layout breaks prerendering of the intercepted poem overlay, so each page sets its own; Next replaces rather than merges a child's `openGraph`/`twitter`; Satori needs static fonts.
- **Checked:** typecheck, lint, build, 201 Vitest (unit + DB integration) tests and 35 E2E tests pass, and all four card types plus the icons were checked visually on a production build.
- **`APP_URL`** is set to the live domain (done at launch). Every share card and sitemap URL is built from it, so it must change if the domain does.

### Phase 11: Ghanaian languages and IPA (R12)

**Why.** Our poem typeface (Newsreader) has no glyphs for Ɛ ɛ Ɔ ɔ Ɖ ɖ Ƒ Ɣ ɣ Ʋ ʋ Ʒ ʒ (checked glyph by glyph), so a Twi word like *ɔdɔ* rendered with letters borrowed from another font mid-word, and share cards (Satori, which only has the fonts we give it) could show empty boxes. Slugs dropped these letters (*Ɔdɔ* → `d`), search treated ɔ and o as unrelated, and the same accented letter could be stored two ways (precomposed or with a combining mark), depending on the keyboard.

**Languages in scope** (decided with the product owner): Ewe, Twi/Akan (incl. Fante), Nzema (Nzima) and Ga, plus IPA for linguists. The interface itself is **not** translated.

| Language | Letters beyond A–Z | Tone marks |
| --- | --- | --- |
| Twi / Akan (Fante) | Ɛ ɛ, Ɔ ɔ | rarely written |
| Ewe | Ɖ ɖ, Ɛ ɛ, Ƒ ƒ, Ɣ ɣ, Ŋ ŋ, Ɔ ɔ, Ʋ ʋ | acute, grave, tilde (nasal), caron, macron |
| Ga | Ɛ ɛ, Ŋ ŋ, Ɔ ɔ | acute, grave (optional) |
| Nzema | Ɛ ɛ, Ɔ ɔ: the same letters as Akan (confirmed by the product owner), so it shares the Akan tab | |
| IPA | the full IPA set (Latin Extended-B, IPA Extensions, combining diacritics) | |

**Phase 11a: render and store correctly** ✅ (no visible change for existing poems)
- **Fonts:** Gentium Book Plus (SIL, OFL, made for African Latin alphabets and IPA) follows Newsreader, and Andika (SIL's sans) follows Geist, so only the letters our main fonts lack come from them. They're **self-hosted subsets** of SIL's full fonts (Google Fonts' copies drop the IPA Extensions block, which holds the lowercase ɛ ɔ ɖ ɣ ʋ ʒ), with a `unicode-range` and no preload, so pages without such letters never download them. The extension font sits *before* next/font's metric fallback in each stack; otherwise Times New Roman/Arial answer first (measured in Chrome). Preloading only the Latin subsets also cut the sign-in page from 13 font files to 4.
- **Share cards:** static Gentium Book Plus files in `src/assets/fonts`, given to Satori as a fallback after Newsreader.
- **One stored form:** titles, poem text, pen names, bios and taglines are NFC-normalised on save, so a letter typed with a combining mark and its precomposed form are the same text.
- **Slugs:** a transliteration step before ASCII folding (Ɛ→e, Ɔ→o, Ɖ→d, Ƒ→f, Ɣ→g, Ŋ→ng, Ʋ→v, Ʒ→z, plus IPA letters with an obvious base), so *Ɔdɔ* → `odo`. Existing slugs are untouched (published slugs never change).
- **Search:** `search_normalize()` folds the same letters (ŋ→n there, since search matches letter for letter), so "odo" finds *ɔdɔ* and *ɔdɔ* still finds itself. New migration; indexes rebuilt.
- **Tests:** real Ewe, Twi, Nzema and Ga lines through save (NFC), excerpt, slug and search (with and without the letters, upper and lower case, with tone marks), and `search_normalize()` checked against `SEARCH_FOLD`.
- **Checked:** typecheck, lint, production build, 257 Vitest tests, and E2E for board, poems, author page, search, profile and the full accessibility scan. On a production build, Chrome reported Gentium/Andika for every in-scope letter in regular, italic and bold, including tone-marked ɔ̃ ɛ́ ŋ̀, and no system-font fallback; the reading page and a poem's share card were checked visually.

**Phase 11b: typing them** ✅ (preview approved with changes, see below)
- A **Special letters** bar, closed by default, under the poem field and under the profile's pen name and bio (and onboarding's pen name). It types into whichever of its fields was used last (e.g. title or poem).
- **Tabs: Akan, Ewe, Ga, IPA.** Akan covers Twi, Fante and Nzema, which use the same letters (decided with the product owner: no separate Twi or Nzema tab).
  - Akan: ɛ ɔ. Ewe: ɖ ɛ ƒ ɣ ŋ ɔ ʋ. Ga: ɛ ŋ ɔ. A **Capitals** toggle works like Shift (one letter).
  - **Tone marks** (high, low, nasal, rising, falling, mid) on Ewe and Ga only; Akan tone marks wait until the product owner knows which are used.
  - **IPA** for linguists: grouped symbols (vowels, consonants, implosives/clicks, stress/length/tone letters, diacritics), searchable by name.
- Clicks insert at the cursor through the browser's editing path, so ⌘Z undoes them and length limits hold. Tone marks and diacritics attach to the letter before the cursor. Every key has a spoken name. The last tab is remembered per browser.
- A help line: Gboard (Android/iPhone) has Akan, Ewe and Ga keyboards; SIL Keyman covers Mac and Windows.
- **Font fix found in the preview:** Newsreader draws ƒ as the slanted florin sign, so Ƒ ƒ come from Gentium (and Andika in sans) even though the main fonts have them.
- **Accessibility:** axe scans of the editor with the bar open (Ewe tab with tone marks, IPA tab) and of the profile found the shared tab labels at 4.16:1; raised to 6.7:1 (`text-foreground/75`).
- **Checked:** typecheck, lint, 265 Vitest tests (letter data, Unicode marks, IPA search), E2E for the bar in onboarding, the poem editor (title and poem: letters, capitals, tone marks, undo, the refused mark, IPA search) and the profile (remembered tab, pen name, bio), plus the full accessibility, auth, poems and profile specs. On a production build, Chrome reported Gentium/Andika for ƒ Ƒ and the Ghanaian letters, and Newsreader/Geist for plain Latin.

**Phase 11c: a poem's language** ✅ (tagging, and browsing the board by language)
- **Editor:** a *Language* picker in the poem sidebar: Not set, Akan (Twi, Fante, Nzema), Ewe, Ga, English (`src/lib/poem-languages.ts`). Optional; existing poems stay "not set" (migration 0010 adds a nullable `poems.language`). Validated against the list on the server.
- **Readers:** a small label on board cards, the list view, the author page and the reading page ("· in Ewe"); `lang` (BCP 47: `ak`, `ee`, `gaa`, `en`) on the poem's title, excerpt and text, so screen readers, hyphenation and spell-check treat it as that language. Never on UI around it: a private poem's unlock form stays English. Private poems show their language like their title, never their text (N1).
- **Search engines:** `inLanguage` in the poem's JSON-LD.
- **Browsing by language:** a *Language* filter in the board toolbar (and the list view): All languages, plus only the languages at least one published poem uses. Picking one keeps only that language's poems, drops authors left with none, and lays the shelves out again with no gaps (`src/lib/board-filter.ts` + the pure `layoutBoard`). The choice is in the URL (`/?lang=ee`; All removes it; an unknown or unused value means All), so reloads and shared links keep it. The list view, minimap, Authors index and *Fit* follow it; search still covers everything (a filtered-out author says so, a filtered-out poem opens directly). A status line ("Showing Ewe poems · 7", a live region) has *Show all languages*. `/` stays prerendered with one cached board for every language: the client reads `?lang` behind Suspense and filters, and the static shell is the unfiltered board. Tests: `tests/board/filter.test.ts`, `e2e/board-language.spec.ts`, a11y scan of the filtered board and list.

### Phase 12: Feeds ✅
Readers can follow InkBoard, or one poet, in a feed reader, with no account and no email list.
- **Feeds** (Atom 1.0, see the architecture table for why not RSS): `/feed.xml` for the whole board and `/a/[author]/feed.xml` per author (404 for unknown or not-yet-onboarded authors). The newest 50 published poems by `published_at` each. Served as `application/atom+xml; charset=utf-8`.
- **Entries:** title, author (pen name and author page, never the email), the absolute `/p/…` link, `published` and `updated` (the poem's last save, never earlier than publishing), a permanent `urn:uuid:<poem id>` id, and, when set, the language as `xml:lang` on the title and text plus a `<category>` ("Ewe").
  - **Public poems:** the full text as `type="html"`: the light Markdown rendered as `<em>`/`<strong>` only, everything else escaped, line breaks as `<br>`, indentation and runs of spaces as non-breaking spaces. Characters XML 1.0 forbids are dropped.
  - **Private poems:** the title, with a fixed English line ("This poem is password protected…") as `type="text"`. Their text is cut in SQL (`CASE WHEN visibility = 'public'`), so it never reaches the builder (N1).
  - Drafts and poems by editors without a pen name never appear.
- **Code:** `src/lib/atom-feed.ts` (pure XML builder), `src/server/feeds.ts` (framework-free loader), `getSiteFeed`/`getAuthorFeed` in `board-cache.ts` (`"use cache"`, `BOARD_TAG`, so a publish, edit, unpublish or rename shows up at once), and two route handlers. `/feed.xml` is prerendered at build time like `/`. URLs come from `siteUrl()`.
- **Discovery:** `<link rel="alternate" type="application/atom+xml">` via `feedAlternates()` (`src/lib/feed-links.ts`): the board's feed on `/`; the author's feed then the board's on author pages and poem pages. Visible entry points: a **Subscribe** button in the board toolbar (canvas and list view; icon-only on phones, still named) opens a small popover that says what a feed is, shows the absolute feed URL (from `siteUrl()`), and offers *Copy feed link* (toast) and *Open feed*. Author pages and full reading pages have a "Follow … in a feed reader" link to the author's feed (`AuthorFeedLink`); the board overlay doesn't, since the toolbar's Subscribe is right behind it. `robots.txt` doesn't block either feed, and no CSP change was needed (same origin, no scripts).
- **Tests:** builder unit tests (escaping, Markdown, whitespace, language, private entries, empty feeds) and loader integration tests (drafts and non-onboarded editors excluded, no private text or email, ordering, the 50 limit, author scoping). E2E fetches both feeds and parses them with the browser's XML parser, follows an unpublish, a retitle and a rename, checks autodiscovery on the board, author and poem pages, the author-page link and robots.txt.

### Phase 13: Revision history ✅
A bad save or a mistaken paste can be undone: editors see earlier versions of a poem and bring one back.
- **Data** (`poem_revisions`, migration 0011, `src/server/poem-history.ts`): a snapshot of the title, text and language each time a save *changes* one of them, written in the save's own transaction in `poems.ts`. Creating a poem records version 1; a status, visibility or password change, or an identical re-save, records nothing. The newest snapshot always equals the poem.
  - Poems from before history existed (or inserted by the seed) have no snapshots; their first content edit records the replaced state first (dated by the poem's `updated_at`), so that edit can be undone too.
  - The newest 20 per poem are kept, pruned in the same transaction. Saves already lock the editor row, then the poem row, so one editor's saves (and their pruning) run one at a time, and `saved_at` uses `clock_timestamp()` so queued saves keep their real order.
  - Deleting a poem deletes its history (FK cascade). The table has no password, hash or visibility columns.
- **Editor-only:** reads join `poems` and filter `poems.editor_id` by the DAL-resolved editor, so another editor's poem or revision id behaves like a missing one; malformed ids are rejected before SQL. Nothing reader-facing (board, author page, reading page, feeds, search, share cards, the board cache) reads the table, and a test checks that only `schema.ts`, `poem-history.ts` and `poems.ts` reference it, and only `/admin` uses its loaders. History changes nothing readers see, so it needs no `updateTag` of its own.
- **Editor UI** (`poems/poem-history.tsx`): a *History* panel in the poem editor's sidebar lists versions newest first with a server-formatted time (UTC) and a preview (the first line that save added, else the first line); the newest is marked *Current*. A version is opened by URL (`?version=<id>`, so Back closes it) in a read-only dialog that compares it with the text in the editor now: a line diff (`src/lib/line-diff.ts`) with `−` lines only in the editor and `+` lines only in the version, marked by symbol, strike-through and screen-reader text as well as colour; title and language differences are listed too.
- **Restore** puts the version's title, text and language into the editor as unsaved changes (with a toast); the editor saves as usual, so a restore is itself recorded as a version and can be undone, and a published poem keeps its slug. There is no second save path.
- **Tests:** integration tests (versions only on content changes, normalised whitespace isn't a change, the legacy baseline, the 20-version cap per poem, cascade on delete, cross-editor and malformed ids, no password data, concurrent saves in order and at the cap, the reader-isolation check), line-diff unit tests, an E2E for viewing (keyboard, diff, focus back on Escape), restoring and saving, readers seeing only the current text, malformed and foreign `?version=` ids, and axe scans of the History panel and the version dialog.

### Phase 14: Collections ✅ (rounds 1 and 2)
Many poems are sequences (a cycle, a chapbook). Editors group their poems into named, ordered collections; readers read them in order. The board layout is unchanged.
- **Rules (product decisions):** a poem is in at most one collection; a collection is one editor's and holds only their poems. Readers see only published poems; "Part 3 of 7" counts published poems only (no gaps from drafts). A private poem in a collection shows its title and lock, never its text (N1).
- **Data** (migration 0012): `collections` (title, slug unique per editor and fixed once created, optional intro) and `poems.collection_id` / `collection_position`. Positions are 1..n over all of a collection's poems, drafts included, and stay contiguous through every add, move, removal and poem delete; a unique index forbids duplicates (reorders renumber in two steps, via negative positions, so the index never trips mid-update). Deleting a collection keeps its poems (they leave it); the FK's `SET NULL` is only a safety net. Limits in `src/lib/collection-limits.ts`: title 100, intro 500, 50 collections per editor, 100 poems per collection; all validated on the server.
- **Server** (`src/server/collections.ts`, like `poems.ts`): framework-free; every query scoped by the DAL-resolved editor id; another editor's collection or poem id behaves like a missing one; malformed ids are rejected before SQL. Lock order: editor row (`FOR NO KEY UPDATE`, like poem saves) → collection rows (`FOR NO KEY UPDATE`, in id order) → poem rows. Moves are relative (up/down/first/last), applied under the lock, so a stale page can't undo another change. Poem saves (`poems.ts`) take part: the editor's *Collection* field moves a poem to the end of another collection (or out), inside the same transaction; deleting a poem closes its collection's gap.
- **Admin:** *Collections* in the sidebar. `/admin/collections` lists them (with counts) and creates one; `/admin/collections/[id]` orders its poems with *Move up / Move down* buttons named after each poem (`aria-disabled`, never `disabled`, so focus survives reaching an end; focus follows the moved poem; a live region announces "Moved … to position 2 of 4"), adds poems that aren't in a collection, removes them, renames, edits the intro and deletes (with confirmation). The poem editor has a *Collection* picker under *Language* ("None", or a collection; a poem added there goes to the end).
- **Readers:** the reading page and the board overlay show "Part 3 of 7 · <collection>" above the title and previous/next links to the neighbouring published poems after it (private ones title-only, with a lock); JSON-LD adds `isPartOf` and `position`. In the overlay the links replace the history entry, so closing it (`router.back()`) still returns to the board; on the full page they're plain `<a>`s, since a soft navigation to `/p/…` is intercepted by the overlay. The data comes with `getReaderPoem` (cached under `BOARD_TAG`): titles, slugs and visibility of published neighbours only, never text, an email or a draft. Every collection mutation calls `updateTag(BOARD_TAG)` (and `poemTag` for the poems it moved).
- **Tests:** integration tests (slugs and renames, limits, counts, one collection per poem, contiguous positions after add/move/remove/delete/unpublish, readers' parts and neighbours skipping drafts, no private text, draft titles or email in the reader payload, cross-editor and malformed ids, a race mixing reorders, moves, saves, deletes, renames and a password-mode switch, and concurrent adds); E2E for creating a collection from the sidebar, adding poems, ordering it from the keyboard, assigning a poem from the editor, a reader stepping through it in the overlay (Escape returns to the board) and on the full page (Back returns), removing a poem and deleting the collection, and another editor's collection being not found; axe scans of the admin pages, the delete dialog, the picker and the reading navigation (page and overlay).

- **Round 2: a public home** (`/a/[author]/c/[collection]`, `loadCollectionPage` in `board.ts`, cached as `getCollectionPage` under `BOARD_TAG`): the collection's title, the author (linking to their page), the intro, and its published poems in reading order as `PoemCardFace` cards numbered 1..n over published poems only. Private poems are title-only with the lock (excerpts cut in SQL, N1); drafts never appear; never the email. An unknown slug, a collection with no published poems, or a not-yet-onboarded author gets "Collection not found" (noindex). A static shell with the data behind Suspense, like the author page.
  - **Links in:** "Part 3 of 7 · <collection>" on the reading page and in the overlay links to it (a plain router link: `/a/…` isn't intercepted, so it leaves the overlay). The author page lists the author's collections that have a published poem (title, poem count, two lines of intro) above their poems.
  - **Board badge:** `PoemCardFace` (board, author page) and the list view show a quiet "Harmattan Cycle · 2/4" line at the bottom of the card (`CollectionBadgeLine`), numbered over published poems by window functions in the board and author-page queries; screen readers hear "part 2 of 4". It takes its room from the excerpt, so card sizes and the board layout don't change; long titles truncate, the numbers never do. `contain: inline-size` keeps a long title from widening the grid it sits in.
  - **SEO and sharing:** its own canonical, title and description (the intro, else a generic line); JSON-LD `CollectionPage` with a `CreativeWorkSeries` (`author`, `hasPart` with positions, `inLanguage` when every poem shares one); an Open Graph card (`opengraph-image.tsx`: title, author, intro, poem count, never poem text); sitemap entries for collections with a published poem. Per-collection feeds are out of scope.
  - Every round-1 mutation readers could see already calls `updateTag(BOARD_TAG)` (rename/intro, delete, move, reorder, add/remove; poem saves and profile renames too), so the page follows edits at once.
  - **Tests:** loader integration tests (order and numbering skip drafts, no private text, draft or email, unknown/empty/all-draft/not-onboarded → null, same slug for two authors, badges and the author page's list); E2E for the page from the reading page, the overlay and the author page, order, private title-only, canonical/description/JSON-LD, the share card image and the sitemap entry, a reorder in admin showing up, no sideways scrolling at 320px, the not-found cases, and the board badge at 375 and 1280px (one line, inside the card, clear of the language label and lock, truncated); axe scans of the author page with collections and the collection page (desktop and 320px).

### Phase 15: Install InkBoard (round 1: installability and the nudge) ✅
InkBoard already had a manifest (`display: standalone`), but nothing told people it could be installed. Round 1 makes it properly installable and adds a gentle nudge; there is no service worker or offline support yet. Design reference: `docs/mockups/install-prompt/` (gallery + PNGs).
- **Installability:** the manifest (`src/app/manifest.ts`) gains `id: "/"` and `scope: "/"`, plus PNG icons at 192 and 512 (`purpose: "any"`, the rounded tile) and a maskable 512 (full-bleed ink red, the Feather inside the 80% safe zone). They're drawn with `ImageResponse` from the logo mark like `apple-icon.tsx` (`src/components/brand/app-icon.tsx`) and served by GET route handlers under `/icons/`, which Cache Components prerender (○ in the build); no binary files are committed. No screenshots yet (only real captures would do). Checked with the installed Chrome over CDP against `next start`: `Page.getAppManifest` reports no parse errors, `Page.getInstallabilityErrors` is empty in a normal (persistent) profile, and Chrome fires a real `beforeinstallprompt`.
- **Rules** (pure, `src/lib/install-nudge.ts`, unit-tested): platform from the user agent (iPhone/iPad incl. iPadOS's "Macintosh" + touch, Mac Safari 17+, other phones/desktops); method: the browser's prompt when `beforeinstallprompt` was captured (Chrome, Edge, Samsung Internet), iOS share-sheet steps, the Mac menu, else nothing (Firefox desktop, old Safari). Never when running installed (`display-mode` standalone / minimal-ui / window-controls-overlay, or `navigator.standalone`), or after `appinstalled`. Readers: from the second visit (a new visit after 30 minutes away), or after opening two distinct poems, never in the first 20 seconds of a first visit. Writers: right after their first-ever publish (10-minute window). "Not now" (and Esc) hides it for 30 days, "Got it" (no-API platforms) for good; remembered per browser in localStorage (`inkboard-install`), every access in try/catch.
- **First-ever publish** is decided in the save transaction (`poems.ts`, under the editor lock, so concurrent saves can't both be first): `firstPublish` in the mutation result. The update action returns it and the form arms the card from its action wrapper; a create redirects with `?first-publish=1`, which `FirstPublishFlash` consumes once and strips.
- **Client** (`src/lib/install-store.ts`, `src/components/install/install-nudge.tsx`): `/install-capture.js` (a prerendered route handler), loaded by the root layout as an async resource script, catches `beforeinstallprompt` and parks it on `window` (cleanup round: an inline `<script>` made React warn whenever the root layout client-rendered; checked in real Chrome that the event, which Chrome fires after `load`, is still caught); a module-level store (read with `useSyncExternalStore`, server snapshot "nothing") counts the visit once per page load, so routes re-shown from `<Activity>` can't re-show a closed card. `InstallNudgeHost` (root layout) portals the card into a slot: `board-bottom` (phones: the bottom column with the zoom bar, so they can't overlap; on iPhone Safari below it, with an arrow at Safari's Share button), `board-top` (≥640px: a right-hand column of the top overlay flow, beside the language-filter pill and Authors, so it never covers them (cleanup round; it used to be absolutely positioned and overlapped them from 640 to 1024px), its tail pointing at the toolbar's install button, the toolbar's last item; "Not now" folds it back into the button, which then rings and takes focus), or `editor` (dashboard corner). The card is a labelled, non-modal region that never takes focus, Esc dismisses it unless a dialog or menu is open, buttons are 44px on phones, motion only with `motion-safe`.
- **Entry points:** an icon button at the end of the board toolbar on wide screens only (the phone toolbar is at its two-row budget), and "Install app" in the account menu; both only where installing is possible, opening the native prompt or the instructions card. CSP unchanged (the capture script is inline, which `script-src 'unsafe-inline'` already allows).
- **Tests:** unit tests for platform, method, installed, visits, poem counting, timing, the writer window and dismissal expiry; integration tests for `firstPublish` (first only, per editor, on create, under concurrency); E2E (`e2e/install-nudge.spec.ts`): a synthetic `beforeinstallprompt` showing the card and `prompt()` on Install, `appinstalled` hiding everything, first visit quiet, Esc and "Not now" persisting across reloads with the toolbar button still installing, two opened poems, iPhone instructions and "Got it", Mac Safari from the toolbar button, standalone and no-prompt browsers showing nothing, the writer card after a first publish (edit and create) but not later, the account-menu item (prompt, instructions, absent), and no overlap with the zoom bar or minimap at 320/375/768/1280px; axe scans of every card state.
- **Later rounds:** real screenshots in the manifest. (Offline reading: round 2 below. The two Sileo toast issues were fixed separately.)

- **Round 2: offline reading** ✅. A reader who has opened a poem can read it again with no connection, the board opens as last seen, and anything not saved gets a friendly offline page instead of the browser's error.
  - **Service worker:** small and hand-written, no library (Serwist and friends bring a webpack plugin and a build step; the whole worker is ~250 lines). Its rules are pure JS in `src/lib/offline/rules.ts` (embedded verbatim and evaluated by the unit tests), its plumbing in `src/lib/offline/worker.ts`, served by `GET /sw.js` (scope `/`, `Cache-Control: no-cache, no-store`, rendered per request so that header is kept) and registered by `ServiceWorkerRegistration` in production builds only; under `next dev` it unregisters any worker instead. CSP unchanged: `default-src 'self'` already covers the worker, which only talks to our origin.
  - **Strategies:** hashed assets (`/_next/static/*`, next/font files), icons, avatars, the manifest and `/install-capture.js`: cache-first. Reader pages (`/`, `/p/a/b`, `/a/a`, `/a/a/c/c`): network-first, then the saved copy, then the offline page. Other documents (`/admin`, `/sign-in`, feeds…): network, else the offline page; never stored. Never touched: non-GET requests (Server Actions), other origins, `/api/*`, `/sw.js`, RSC prefetches, and Next's connectivity `HEAD`.
  - **Soft navigations offline:** RSC requests are never cached. When an RSC *navigation* (the poem overlay, collection links, search picks) can't reach the network, the worker answers with an empty non-RSC response, which makes Next load the URL as a document; that comes from the saved page or the offline page. (With `useOffline`, a network error would instead park the navigation until the connection returns.) So a saved poem opens offline from the board as a full page.
  - **What may be stored (the privacy rule):** the worker never stores the response the reader got. It fetches its own copy with `credentials: "omit"` (no session, no unlock cookie, so identical for everyone and free of unlocked text or editor data), and keeps it only if it's a 200 HTML page with `<meta name="inkboard-offline" content="save">` and without `content="never"`. `OfflineMarker` renders "save" on the board, public poems, author and collection pages, and "never" on every private poem's page, unlocked or not. Poem text can't forge a marker (it's escaped). A 404/410, a "never" page or an unmarked page deletes the saved copy, so an unpublished, deleted or now-private poem disappears on the next online visit. Pages shown by a soft navigation ask to be saved (`SaveForOffline` posts the path; the worker applies the same rules).
  - **Versions and limits:** caches are `inkboard-static-<build>` and `inkboard-pages-<build>`; the build id is inlined at build time (`INKBOARD_BUILD_ID`, else Vercel's deployment id or commit, else a timestamp), so each deploy is a new worker. A new worker refetches every saved page into its own caches under the same rules (10 s budget, then drops the rest) and deletes every older cache, so old HTML whose chunks may be gone is never served. Kept: the 50 most recent poems and 30 other pages (board, author, collection pages); assets are those the saved pages reference, per build.
  - **Offline experience:** `experimental.useOffline` is on. `OfflineIndicator` ("You're offline · showing saved poems") uses `useOffline()` or `navigator.onLine` (a page loaded from the saved copy may not have failed a fetch yet); a `role="status"` region, always rendered. On the board it sits in the top overlay flow column (clear of the zoom bar and the install card), elsewhere at the bottom. `/offline` (static, precached at install) lists the poems saved on this device straight from CacheStorage, offers "Try that page again" and the saved board.
  - **Tests:** unit tests for the strategy of each request kind, what's never touched, the storage verdicts (including forged markers), listing metadata, asset discovery, caps and the worker source. A production E2E (`playwright.offline.config.ts`: fixtures, `next build` into `.next-offline`, `next start`; command in the config header) covers reading online then offline (reload and from the board), the board offline, an unread poem → the offline page with the saved list, a private poem unlocked online never stored (no cache body contains its text), `/admin` and `/sign-in` never cached, an unpublished poem dropped on the next online visit, and a rebuilt app picking up the new worker, migrating saved poems and loading without failed chunks. axe scans of the indicator (board, poem page) and the offline page (empty, with poems, phone).

### Phase 16: Signing in without email (round 1: recovery codes, "This isn't my device"; round 2: passkeys) ✅ (R13, R14, R15, N10, N11)
Some editors read their email only on their phone, so a computer without it (their own new laptop, a library PC) can't sign in. SMS is out (cost, and it's the same phone). Round 1 adds recovery codes and a public-device option; **round 2 is passkeys**. Email codes and links are unchanged and stay the main way in.
- **Codes** (`src/lib/recovery-code-format.ts`, pure; `src/server/auth/recovery-codes.ts`): 10 per set, 12 Crockford base32 symbols each (60 bits; `generateRecoveryCode` in `crypto.ts`, unbiased), shown as `XXXX-XXXX-XXXX` in Geist Mono with a slashed zero. Input is normalised before checking: NFKC, case, whitespace, any dash or underscore, and O→0, I/L→1 (U isn't in the alphabet). Stored as `hmac("recovery-code", editorId:code)` only.
- **Using one** (`/sign-in/recovery`, linked quietly from both sign-in steps as "Can't get to your email? Use a recovery code"): email + code. Rate limits are counted first, in tiers: `recovery:verify:ip:<bucket>` (20/15 min), then `recovery:verify:email-ip:{h,d}:<sha256>:<bucket>` (10/h, 20/day), then `recovery:verify:email:{h,d}:<sha256>` (30/h, 100/day); a client over its own budget never reaches the shared tier, so it can't lock the editor out. Then the same work for everyone: one editor lookup, one code lookup (a nil id stands in for no editor / not allowlisted), and ten constant-time comparisons against real or decoy hashes, without early exit. Unknown email, not allowed, no codes, wrong and used codes all get one message. A match is used with `UPDATE … WHERE used_at IS NULL` (one winner under concurrency). Success starts the session through the DAL (`sign_in_method = 'recovery'`), runs the usual new-device/network alert, and emails "A recovery code was used to sign in · N left" (device, time, what to do).
- **Making them** (profile → "Recovery codes"): status ("7 of 10 codes left", made on), Create / "Make a new set" (with a confirm dialog). The codes are returned once and kept only in the panel's state: Copy, Download (.txt) and Print (a portalled sheet; `globals.css` hides everything else in print), the advice to keep them in a password manager or printed in a wallet, and "I've saved my codes". A new set replaces the old one (same transaction, under the editor row lock) and emails a notice; codes never go in email.
- **Step-up** (`src/server/auth/step-up.ts`): making or replacing codes needs `sessions.email_verified_at` within 10 minutes, checked inside the generating transaction. An email sign-in sets it; a recovery sign-in doesn't (it never touched the inbox), and sessions from before this phase have none. Otherwise the editor confirms with a 6-digit code emailed to them: HMAC only, bound to the session that asked, 10-minute expiry, newest only, attempts counted before comparing (5), 60 s resend cooldown, per-session and per-editor limits. A stolen long-lived cookie alone can't quietly replace codes.
- **Dashboard:** a one-time setup prompt for editors with no codes ("Set up recovery codes so you can sign in without your email"), with "Not now" stored on the editor (`recovery_prompt_dismissed_at`), so it doesn't come back on any device; it also goes once codes exist. With 2 or fewer unused codes, a notice ("Only 2 recovery codes left", "You've used all your recovery codes") links to a new set until there is one.
- **"This isn't my device"** (both sign-in steps, the link page and the recovery form): the session cookie has no Expires/Max-Age, the server session lasts 12 hours instead of 30 days, and the long-lived device cookie is neither read nor written (a throwaway id makes the alert treat it as a new device). The device list marks it "Public device" (and "Recovery code" for recovery sign-ins). Radix's Checkbox resets itself on the form `reset` React fires after each action, so `PublicDeviceCheckbox` ignores reset-driven changes and posts through its own hidden input.
- **Emails:** the two recovery notices say "code", so they carry no 4–8 digit numbers at all (time without the year, no IP address, never a code); the step-up email follows the code-email rules (code first, alone, no other digit runs, no sign-in link). Templates are pure, in `email-templates.ts`; the E2E outbox records `recovery-used`, `recovery-codes-changed` and `step-up`.
- **Data:** migration `0013_recovery_codes.sql` (generated). The cleanup cron also deletes step-up codes a day after expiry or use; recovery codes don't expire (a new set replaces them).
- **Tests:** integration (`tests/auth/recovery-codes.test.ts`): format, entropy and normalisation; generation and hashing; replacement; concurrent new sets; single use with concurrent attempts; wrong codes; every rate-limit tier, including that blocked guesses never reach the shared tier; no enumeration (same answer and the same five rate-limit keys for unknown, not allowed, no codes and wrong); the step-up rule (fresh, aged, pre-feature, recovery sign-in, other editor, expired, session-bound codes, attempt cap under concurrency, cooldown); the remaining count; the emails; public-device sessions. Template tests for the three emails. E2E: `e2e/recovery-codes.spec.ts` (set up, Copy, Download, Print, sign in from a fresh context, used code refused, generic error, step-up, setup prompt and dismissal across devices, low-codes notice), `e2e/public-device.spec.ts` (cookie without expiry, 12 h, no device cookie, "Public device", unticked unchanged, box survives an error); new states in `e2e/a11y.spec.ts`.
- **Round 2: passkeys** ✅ (R15, N11). The flow it's designed for: an editor makes recovery codes on their phone, signs in on their own laptop with one, and adds a passkey there; from then on that laptop signs in with the passkey. SimpleWebAuthn (`@simplewebauthn/server` 14.1, `@simplewebauthn/browser` 14.0).
  - **Server** (`src/server/auth/passkeys.ts`, framework-free like `otp.ts`): registration (discoverable credential: resident key required, user verification preferred, "none" attestation, the editor's passkeys excluded, an opaque random user handle per editor in `editors.webauthn_user_id`), sign-in (usernameless, user verification required), passkey step-up, list/rename/remove, and the offer. The relying party comes from APP_URL (`webauthn-config.ts`): RP ID = its host, the only accepted origin = its exact origin; `playwright.config.ts` sets APP_URL to the E2E server.
  - **Challenges** (`webauthn_challenges`): SimpleWebAuthn's random 32 bytes, about 5 minutes, deleted when taken (`DELETE … RETURNING`, whatever happens next, so each works once), tied to the browser through a random token in a short-lived httpOnly SameSite=Strict cookie (`webauthn-cookie.ts`, one per ceremony kind, stored here only as SHA-256) and, for registration and step-up, to the editor and session. The cleanup cron deletes expired ones.
  - **Verification:** origin, RP ID, challenge and signature by SimpleWebAuthn; user verification checked twice (the library's flag and our own); the counter must rise unless both sides are 0 (synced passkeys), checked again here and moved with a conditional `UPDATE … WHERE counter = old`, so a replayed or raced assertion loses; the response's user handle must be the passkey's editor's; allowlist re-checked. Every failure is one generic answer. Sign-in verification is rate-limited per IP bucket (30/15 min, counted first), options too (60/15 min), registration per editor, passkey confirmation per session. Only the credential id, COSE public key, counter, transports and backup flags are stored.
  - **Step-up:** a passkey sign-in or a passkey confirmation (profile, "Use a passkey") now counts as a recent verification (`sessions.passkey_verified_at`), for passkeys and recovery codes alike. Adding or removing a passkey needs one (`passkeyGate`). **Exception:** within 10 minutes of a recovery-code sign-in, in that same session, a passkey may be added without one, because that editor has no email on that computer. The trade-off: a stolen recovery code (plus the email address) could also add a passkey and keep access; the "recovery code used" and "passkey added" emails (the latter says it followed a recovery sign-in) are what warn the editor, and removing a passkey or replacing codes from such a session still needs a step-up. **Never on a public device:** a "This isn't my device" session can't add a passkey (it would stay on a computer the editor doesn't control); removing is allowed with a step-up.
  - **Fix (during Phase 17):** the sign-in options moved from a Server Action to `POST /sign-in/passkey/options` (route handler, Origin-checked). The autofill's action on page load could finish after the "Signed out" flash had stripped `?signed-out=1`, and Next's router then put the param back (poems.spec's sign-out test caught it).
  - **UI:** `/sign-in` gets "Sign in with a passkey" and autofill on the email field (`autocomplete="email webauthn"`, conditional UI), both only where the browser has WebAuthn; "This isn't my device" applies; the button aborts the autofill request, which restarts afterwards; a cancelled prompt shows nothing; failures get one calm message. Profile → "Passkeys" (after Recovery codes): name (from the device, editable), added, last used, "Synced"; Add, Rename (dialog), Remove (confirm); the shared "Confirm it's you" card (`step-up-card.tsx`: email code or passkey). After a recovery-code sign-in on a non-public device, the dashboard offers once to add a passkey here ("Not now" is stored on the session). Device list: "Passkey" badge.
  - **Emails:** "A passkey was added" (device, time, what to do; a warning when it followed a recovery sign-in) and "A passkey was removed". Same digit rule as the recovery notices; a passkey name containing a 4+ digit run is left out of them rather than altered.
  - **CSP:** unchanged. WebAuthn isn't governed by CSP, the actions are same-origin, and Permissions-Policy leaves `publickey-credentials-*` at its same-origin default; an E2E test records no `securitypolicyviolation` through registration and sign-in.
  - **Tests:** integration (`tests/auth/passkeys.test.ts`) with a software authenticator (`tests/support/fake-authenticator.ts`: real P-256 keys and real signed responses, so SimpleWebAuthn's checks run unmocked): registration options and storage; duplicates; wrong origin, port, RP ID or challenge; malformed responses; challenge single use (sequential and concurrent), expiry, browser binding, editor/session/purpose binding; missing user verification; forged signature; unknown and removed credentials; user-handle mismatch; allowlist; IP rate limits (incl. IPv6 /64); counter rising, replayed, rewound, zero, non-counting and raced; scoping of list, rename, remove and confirmation; the step-up rules incl. the recovery exception's limits and the public-device block (also re-checked at finish); emails; the offer. Template tests for both emails. E2E (`e2e/passkeys.spec.ts`, Chromium's virtual authenticator): add, sign out, sign in; rename and remove (a removed passkey can't sign in; public-device passkey sign-in); recovery code → offer → passkey in a fresh context; "Not now"; public device can't add; step-up by email code to add and by passkey to remove; cancelled prompt shows nothing; autofill; user verification required; no WebAuthn, no buttons. Chrome's virtual authenticator answers autofill requests by itself (a real browser waits for the person to pick the passkey), so specs switch autofill off unless they test it (`virtualAuthenticator(page, { autofill })`). New states in `e2e/a11y.spec.ts`.

### Phase 17: Your poems as files, and leaving ✅ (R16, R17, N12)
Anyone can sign up, but there was no way to take your work with you or to leave. Both now live on **Settings**, below the private-poem passwords: "Download your poems", then, set apart by a rule, "Delete account". Settings rather than Profile: the profile is about how readers see you and how you sign in (it already holds recovery codes, passkeys and devices); Settings is about your work and the account as a whole, which is where people look for export and deletion.
- **Download** (`GET /admin/export/markdown|json`, a route handler that re-authorises through the DAL; data from `src/server/export.ts`, files from the pure `src/lib/export-format.ts`):
  - **Markdown:** one `.md` file to read in any text editor: the profile (pen name, tagline, bio, links, author page), then each collection with its poems in order, then the poems not in a collection, oldest first. Each poem: its title as a heading, then language, visibility, draft/published (with date), collection and part, created and last edited, then the text exactly as written (light Markdown, line breaks, blank lines and indentation kept; no whitespace clean-up).
  - **JSON:** the complete backup: `format: "inkboard-export"`, `version: 1`, the profile (pen name, slug, tagline, bio, links, avatar, pinned poem, joined), collections in the order of the editor's Collections page with their poems' ids in reading order, and every poem (drafts and private ones with their text, language, visibility, status, dates, collection and position) with its saved revisions, oldest first.
  - **Never in either file:** password hashes, password versions, the shared password, the email address, sessions, sign-in history, recovery codes, passkeys, rate limits, or anything of another editor's. Every query names its columns and is scoped by the editor id; revisions come from `revisionsForExport` in `poem-history.ts` (still the only module touching that table).
  - UTF-8, NFC; text exactly as stored (Ghanaian letters, IPA, Ewe tone marks). Headers: `Content-Disposition: attachment; filename="inkboard-<slug>-<YYYY-MM-DD>.md|json"`, `text/markdown; charset=utf-8` / `application/json; charset=utf-8`, `Cache-Control: no-store`. No step-up, no email (decided); 10 downloads an hour per editor (`export:<editorId>`), past that a short 429 page.
- **Delete account** (`src/server/account-deletion.ts`, action in `settings/actions.ts`, UI `settings/delete-account.tsx`):
  - The section says what goes and links to the download; it notes that copies readers saved for offline reading stay in their browsers. It needs a recent verification (`isSessionFresh`: email or passkey; a recovery-code sign-in alone doesn't count) through the shared "Confirm it's you" card, then the pen name typed back (NFC, spacing ignored, case matters) in a dialog. The server checks both again inside the transaction.
  - **One transaction**, editor row locked first: retire the slug; delete what has no foreign key to the editor (`email_otps` by address; `rate_limits` keys naming the editor id, one of their session ids or their email's hash); delete the editor row, and `ON DELETE CASCADE` takes sessions (with their step-up codes and WebAuthn challenges), poems (with revisions), collections, passkeys, recovery codes, WebAuthn challenges, and known devices and networks.
  - Then `updateTag(BOARD_TAG)` (board, author page, poem and collection pages, feeds and the sitemap are all cached under it; search is uncached) and `poemTag` for each poem, the session cookie is cleared, and the browser does a full page load to `/?account-deleted=1` (replacing the history entry), where the board shows "Your account was deleted". The flash is read in the browser, so the board stays prerendered.
  - "Your InkBoard account was deleted" email (device, time, what to do if it wasn't you; no 4–8 digit numbers, never "code").
  - **Retired slugs** (`retired_slugs`: the slug and when, nothing personal): onboarding's allocation reads taken and retired slugs in one statement (one snapshot), and a trigger refuses a retired slug on any editor (raising `unique_violation`, which `setPenName` already retries). Old `/a/<slug>` and `/p/<slug>/…` links stay "not found" for good.
  - Signing up again with the same email is a fresh account: a new editor row, a new slug (`<slug>-2`), the welcome email again; no cooldown left over (the old counters went).
- **Tests:** integration (`tests/account/export.test.ts`, `deletion.test.ts`): export contents and scoping (another editor's data never appears, drafts and private poems do), no secrets (every hash, password, token, code, credential, the email, the IP and user agent checked absent from both files, and no JSON key that could hold them), both formats, the Ghanaian round trip, file names and content types, the rate limit; deletion walks the schema's foreign keys from `editors` (directly or through sessions, poems and collections), requires fixture rows in every such table, and checks none is left, nor sign-in codes or rate-limit counters, while another editor's rows all stay; step-up (old session, recovery sign-in, passkey confirmation), the pen-name check, readers' loaders (board, author page, poem, collection, feeds, search), the retired slug (allocation and trigger), the email, re-signup. Mutations (dropping the email-code delete, the rate-limit delete or the slug retirement) each fail a test. Email template tests. Revision-history hygiene: the export loader is used only by `export.ts`, whose callers are under `src/app/admin`. E2E (`e2e/account.spec.ts`): both downloads from the UI with a private poem and a draft, headers, 404 for an unknown format, signed-out redirect; deletion through step-up and the pen name, then signed out, author page and poem "not found", gone from the board, search, author feed and sitemap, and the same email signs up fresh (`-2` slug, second welcome). New states in `e2e/a11y.spec.ts`.

### Phase 18: Notifications about new poems (R18, N13) ✅
Research and the prototype: `docs/research/push-notifications.md`; setup and device testing: `docs/NOTIFICATIONS.md`. Standard Web Push with `web-push` (3.6.7, pinned) and our own worker; no third party, no CSP change.
- **When:** a poem is announced at most once, ever: in the save that *first publishes it as a public poem* (`claimAnnouncement` in `poems.ts` sets `poems.notified_at` with a conditional UPDATE in the save transaction, only if the author has a pen name). The mutation result's `announce` makes the action send in `after()`, so a save never waits on push services. Editing, unpublishing and republishing never announce again (`notified_at` is never cleared). **Decided:** a poem published private and later made public is *not* announced (only a first publish can announce); private poems are never announced, not even by title. Poems published before this phase were back-filled (`drizzle/0018`).
- **Limits** (owner's decision): per device, at most one notification per author in 12 hours and three in 24 hours. Poems over a limit simply aren't announced to that device (they're on the board and in the feeds); nothing silent is ever sent, since iOS revokes subscriptions after silent pushes. `claimDeliveries` (`src/server/push.ts`) locks the subscription rows (id order), then counts and inserts `push_deliveries` rows in a second statement (fresh snapshot after the locks), so two poems published at once can't both take a device's last slot. A claimed slot stays used even if the send fails.
- **Sending:** `announcePoem` re-checks the poem (claimed, published, public, pen name), pages through subscriptions in batches of 200 claims, 20 requests in flight, 10 s timeout each, and stops starting batches after 180 s (well inside the 300 s function limit; `after()` shares it). TTL 1 day, `Urgency: normal`, `Topic` = the poem id without dashes (32 chars). 2xx → `last_success_at`; 404/410 → the row is deleted; 429/5xx/timeouts → `last_attempt_at`; 400/403/413 are logged (host only, never the endpoint). Payload: exactly `{ title, author, url, tag }` (`newPoemPayload` in `src/lib/push-rules.ts`); never poem text.
- **Subscriptions:** `push_subscriptions` (endpoint unique, `p256dh`, `auth`, `created_at`, `last_success_at`, `last_attempt_at`); no link to any person. `POST/DELETE /api/push/subscription` (route handlers: same-origin, `push:{subscribe,unsubscribe}:ip:<bucket>` 30/hour, body ≤ 2 KB, an https endpoint on the allowlist of Google FCM, Mozilla autopush, Apple and Microsoft WNS hosts, keys of exactly 65 and 16 bytes). The cleanup cron deletes subscriptions we tried but couldn't use for 90 days (no success, or none in 90 days, with an attempt since), and delivery rows after two days.
- **VAPID:** `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` (both or neither; neither = feature off and the switch hidden) and `VAPID_SUBJECT`, validated in `src/env.ts`. The subject must be an https URL or mailto on a real domain (Apple answers `BadJwtToken` for localhost and placeholders); it defaults to the site URL when that is public https, and env validation fails clearly otherwise. The public key reaches the client and the worker through `next.config.ts` `env` (`INKBOARD_VAPID_PUBLIC_KEY`).
- **UI:** "Notifications on this device" in the Subscribe popover (board toolbar and list view): a switch with the owner's short wording and a "How notifications work" disclosure with the full wording. States: off, on, blocked (disabled, says how to allow it in the browser's site settings), unsupported, and iPhone/iPad outside the Home Screen app ("Add InkBoard to your Home Screen first", no switch). Permission is requested only from the switch. After installing (`appinstalled`, or running installed), a one-time card offers the same switch in the install card's slot, until it's turned on or "Not now" (`inkboard-push-offer` in localStorage). `src/lib/push-store.ts` holds the state; on each app open with permission granted, `syncOnOpen` (after the worker registers) re-posts this browser's subscription once per session, re-subscribing if the VAPID key changed, so a subscription the server lost comes back quietly. Turning off unsubscribes in the browser and deletes the row.
- **Worker** (`src/lib/offline/`): pure `notificationFor`/`clickUrl` in `rules.ts` (title, "New poem by …", `/icons/192.png`, badge `/icons/badge-96.png` (white on transparency), a tag per poem, the URL; malformed pushes still show a notification linking to the board; only `/p/a/b` links); `push`, `notificationclick` (a window already on the poem is focused; else an InkBoard window is navigated, then focused; else a new window) and `pushsubscriptionchange` (re-subscribe with the old key or the baked-in public key, post the new address, delete the old) in `worker.ts`. A push also saves the announced poem through the offline storage rules, so the tap works offline. Declarative Web Push (Safari 18.4+) is left for later: its `navigate` URL must be absolute and same-origin, which preview deployments with a production `APP_URL` would break, and it can't be tested without a device.
- **Tests:** unit (allowlist, subscription shape, VAPID subject rule and env validation, exact payload, Topic, outcomes, worker notification and click rules); integration (once-only on create/update/republish/edit, private never and private→public never, no pen name, re-check at send, per-author and per-device limits with windows, concurrent publishes for the last slot and the same author twice, 404/410 cleanup, retries kept, time budget, the 90-day cron, the route's validation, origin check and IP-bucket rate limit, account deletion covering `push_deliveries`). E2E against `next dev` with the browser's push half stubbed (`e2e/push-stub.ts`; real API and DB): on/off with the row created and deleted, permission only on the tap, blocked (from settings and from the prompt), unsupported, iPhone not installed, the after-install offer (Not now remembered; turned on from the installed app); axe for every state at 375 and 1280 px. Production E2E (`e2e-offline/notifications.spec.ts`) with CDP `ServiceWorker.deliverPushMessage`: the real worker's notification fields, the poem saved and readable offline, tag replacement, malformed pushes, a private poem's page never saved, a (synthetic) click navigating the open window to the poem, and the quiet re-registration on open. Not automated: a real push service delivery and a real tap (no user activation for synthetic clicks), and real phones; see `docs/NOTIFICATIONS.md`.

## 5. Requirements traceability

| Req | Phase | Status |
| --- | ----- | ------ |
| R1 Canvas board | 3 | ✅ pan/zoom/pinch/keyboard, minimap, list view |
| R2 Poem CRUD | 2, 13, 14 | ✅ tested (unit + E2E); revision history and restore (Phase 13); ordered collections (Phase 14) |
| R3 Public/private + password | 2, 4 | ✅ |
| R4 Admin dashboard | 1 (shell), 2, 7 | ✅ sidebar shell, stats, filterable table, rich profile |
| R5 Neon | 0, 6 | ✅ schema + driver switch; live on Neon since launch |
| R6 shadcn/ui, custom theme | 0 → all | ✅ every screen (sign-in, admin, settings, profile, board, overlay, search) uses the themed components |
| R7 Email OTP, passwordless | 1 | ✅ |
| R8 Visitor read/unlock | 4 | ✅ incl. board overlay |
| R9 Author sections | 1 (pen name), 3 | ✅ |
| R10 Full-text search | 5 | ✅ prefix, multi-word, typo, accent-insensitive; ⌘K palette |
| R11 Editor picks per-poem or one shared password | 4 | ✅ tested (unit, DB invariant, E2E) |
| R12 Ghanaian languages and IPA | 11 | ✅ 11a (fonts, share cards, NFC, slugs, search), 11b (Special letters bar), 11c (poem language tag, browse by language) |
| N1 Private body never leaked | 3, 4, 5, 12, 14 | ✅ board, reading page, unlock, search, feeds and collection navigation tested |
| N2 OTP rules | 1 | ✅ tested |
| N3 Rate limits | 1, 4 | ✅ OTP and unlock |
| N4 Sessions | 1, 6 | ✅ tested; editors can list and revoke devices (Phase 6) |
| N5 Server-side authorisation | 1, 2, 13, 14 | ✅ tested (cross-editor IDOR, unit + E2E; revision and collection ids too) |
| N6 Poem password hashing/revocation | 2, 4 | ✅ |
| N7 Accessibility | 3, 4, 6 | ✅ board done (links, focus pan, list view); axe passes on every screen (E2E, light theme); manual VoiceOver pass passed |
| N8 Board caching | 3, 12 | ✅ tag-invalidated on every admin save (E2E); feeds share the tag |
| N9 No user enumeration | 1, 16 | ✅ tested (sign-in codes; recovery codes too) |
| R13 Sign in without email (recovery codes) | 16 | ✅ round 1 tested (unit + E2E) |
| R14 "This isn't my device" | 16 | ✅ tested (unit + E2E: cookie without expiry, 12 h, no device cookie, "Public device") |
| N10 Recovery code security and step-up | 16 | ✅ tested (hashing, concurrency, rate-limit tiers, enumeration, step-up, emails) |
| R15 Passkeys (add, name, remove, sign in without email) | 16 (round 2) | ✅ tested (integration with real signatures + E2E with Chromium's virtual authenticator) |
| N11 Passkey security (challenges, origin/RP ID, UV, counter, scoping, step-up, emails) | 16 (round 2) | ✅ tested (see Phase 16 round 2) |
| R16 Download your poems (Markdown, JSON) | 17 | ✅ tested (integration + E2E) |
| R17 Delete account | 17 | ✅ tested (every-table check, readers, retired slug, re-signup; E2E) |
| N12 Export scoping and secrets; complete deletion | 17 | ✅ tested (see Phase 17) |
| R18 Notifications about new poems | 18 | ✅ tested (integration + E2E with stubbed push and CDP push delivery); real phones: manual, see docs/NOTIFICATIONS.md |
| N13 Notification rules (once, public only, limits, allowlist, payload, VAPID subject) | 18 | ✅ tested (see Phase 18) |
| Installable app (manifest, icons, install nudge, offline reading) | 15 | ✅ round 1: installability (Chrome, no errors) and the nudge; round 2: service worker and offline reading (production E2E, private poems never stored) |

## 6. Decisions and open questions

Decided:
- **Who may become an editor?** Anyone who verifies their email. `EDITOR_ALLOWLIST` stays empty by default and remains available if you ever want to restrict sign-ups.
- **Do private poems show their title on the board?** Yes: title, author and a lock badge. The text stays hidden until the reader enters the password.
- **Password per poem, or one for all?** The editor decides, in Settings (R11). The default is a password per poem.
- **Poem formatting?** Plain text, with line breaks and indentation kept, plus light Markdown: `*italic*`, `**bold**`, `\*` for a literal asterisk (⌘I / ⌘B in the editor). Emphasis stays within a line; nothing else is special.
- **How long does an unlock last?** 12 hours per browser, or until the editor changes the password (or unpublishes the poem).
- **Email provider?** Resend, with a verified sending domain (done at launch).
- **Which local languages?** Ewe, Twi/Akan, Nzema and Ga for poets, and IPA for linguists (Phase 11). The interface stays in English.
- **Board layout?** An automatic grid of author sections. Letting editors arrange positions could be a later phase.
- **Signing in without email?** Recovery codes and "This isn't my device" (Phase 16), then passkeys (round 2). No SMS (cost, and it's the same phone).

No open questions remain.

Possible later work (not planned):
- **Magic link in the sign-in email,** next to the code. A long random token can't be guessed, so it would remove the remaining bounded lockout described in Phase 6. Worth doing only if that becomes a problem.
- **Editor-arranged board positions** (see above).
