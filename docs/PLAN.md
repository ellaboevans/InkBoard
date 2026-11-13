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

## 3. Architecture & key decisions

| Area | Decision | Why |
| ---- | -------- | --- |
| Framework | **Next.js 16** App Router, Cache Components + Partial Prefetching (scaffold defaults), TypeScript strict | Server Components keep private content server-side by default (N1); Server Actions for mutations. |
| DB | **Neon Postgres** via **Drizzle ORM** + drizzle-kit SQL migrations | Typed schema, plain SQL migrations reviewable in PRs. |
| DB driver | `@neondatabase/serverless` (WebSocket pool, supports transactions) when `DATABASE_URL` points at Neon; `pg` for local Postgres | Same code path for prod and local dev/tests; no Neon account needed to develop. |
| Auth | **Custom email-OTP** (≈300 lines, fully tested) rather than a framework | Requirement is narrow (OTP only, no passwords/OAuth). Owning it keeps every rule in N2–N4/N9 explicit and testable. |
| Email | **Resend** in production; codes logged to the server console in development | Simple API, good deliverability. Swappable behind `sendOtpEmail()`. |
| UI | **shadcn/ui** (Radix base, Nova preset) with a custom "paper & ink" theme; serif face for poem text | R6. |
| Board rendering | **Infinite canvas of DOM nodes in a CSS-transformed world layer** (pan/zoom via pointer, wheel, pinch, keyboard) | Behaves like Figma/Miro, but text stays crisp, selectable, translatable, screen-reader accessible and every card is a real link (N7). A raw `<canvas>` would require re-implementing text layout, hit-testing and accessibility. Virtualise off-screen sections if counts grow. |
| Board layout | Deterministic auto-layout: author sections on a grid ("shelves"), poems as cards inside | Predictable catalogue (R9). Free-form placement by editors is a possible later feature. |
| Search | Postgres FTS (GIN expression indexes on `to_tsvector('simple', search_normalize(…))`) on poem **title** and author **pen name**, plus `pg_trgm` for typo-tolerant matches | R10 without an external service; bodies are excluded (N1). |
| Private unlock | Server Action verifies password → adds a grant to one signed (HMAC) cookie, 12h expiry. A grant covers one poem (`p:<poemId>:<password_version>`) or, in shared mode, all of an author's private poems (`a:<editorId>:<shared_password_version>`) | Stateless, revocable on password change (N6). |
| Rate limiting | Fixed-window counters in a Postgres table (`rate_limits`) | Works on serverless without adding Redis; can be swapped for Upstash later. |

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

```
```

"A private poem is always readable with some password" (its own in per-poem mode, the
author's shared one in shared mode) is enforced by triggers in
`drizzle/0002_password_mode_triggers.sql`, which replaced Phase 0's
`CHECK (visibility = 'public' OR password_hash IS NOT NULL)`.

Phase 5 adds GIN expression indexes (tsvector + trigram) over `search_normalize(pen_name)` and
`search_normalize(title)`, in `drizzle/0003_search.sql` only (drizzle-kit doesn't model them).

### Route map

```
/                      Public canvas board (R1, R9) + search (R10)
/p/[author]/[poem]     Reading view; password gate for private poems (R8)
/a/[author]            Author's public page: avatar, tagline, bio, links, poems (pinned first)
/sign-in               Email → OTP (R7)
/admin                 Dashboard: my poems (R4)
/admin/onboarding      First sign-in: choose pen name (the section label)
/admin/poems/new       Create poem (R2, R3)
/admin/poems/[id]      Edit poem, visibility, password, publish, delete (R2, R3)
/admin/settings        Private-poem password mode: per poem or one shared (R11)
/admin/profile         Avatar, pen name, tagline, bio, links, pinned poem, stats, signed-in devices
/avatars/[id]          Curated avatar SVGs (prerendered, cached forever)
/api/search?q=         Search authors and poem titles (R10)
/api/cron/cleanup      Daily cleanup of expired rows (Bearer CRON_SECRET)
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

### Phase 6: Hardening and launch 🟡
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
- **E2E coverage** for sign-in, publish, board, overlay, unlock (both password modes) and search: 24 tests.

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
  - Covers 24 screens and states in both themes: sign-in steps, onboarding, dashboard, poem editor (incl. validation errors and the delete dialog), settings, profile, board, list view, search palette (empty, results, no results), overlay (public, locked, wrong password), and the full poem page (locked, unlocked, not found).
  - Fixed what it found:
    1. Error text was below 4.5:1 contrast (4.42:1 on paper, 4.1:1 on its tint, 3.92:1 in the dark theme). The `--destructive` token was darkened in light mode and lightened in dark mode.
    2. Board cards were links whose `aria-label` hid their visible text (WCAG 2.5.3), so screen readers couldn't read excerpts. Cards are now stretched title links: the title is the link and its name, and the excerpt is plain text.
    3. The search palette rendered an empty `listbox` before any results (an ARIA error). Status messages now sit outside it, and it's hidden until there are results.
    4. Found while scanning: after closing one poem's overlay and opening another, the dialog kept the old poem's name, because the overlay used a fixed id and Next keeps the previous overlay mounted but hidden. The poem's title is now the Radix `DialogTitle`, whose id is unique to each dialog.
  - Note: the dark "night ink" theme is defined and passes these checks, but nothing in the app switches it on yet.

To do:
- **Manual screen-reader pass (N7):** automated checks catch only part of what matters. Try VoiceOver or NVDA on sign-in, the poem editor, the board, the overlay and the search palette.
- **Needs you:** create the Neon project and Vercel project, verify a Resend sending domain, and set the env vars from `docs/DEPLOY.md`.

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
- **New sign-in alert** (`src/server/auth/sign-in-alerts.ts`, `signInAlertEmail`): after a successful sign-in from a network (IPv4 address or IPv6 /64) not seen before for that editor, they get an email with the device ("Chrome on macOS"), IP address and time (UTC), and what to do if it wasn't them: sign the device out under Signed-in devices, and secure their email.
  - No alert on the first sign-in ever (or the first after this shipped), on known networks, or without a client IP. At most 5 alerts per editor per day.
  - `sign_in_locations` stores only an HMAC of the network, never the IP. Rows unused for a year are pruned by the cleanup cron.
  - Sent after the response (like codes); a failure is logged and never blocks the sign-in.
  - The alert never says "code", so clients don't offer to "copy" the date in it (tested).
- **Tests:** template tests (subject, unbroken code, no other digit runs, escaping, UTC time), alert logic (first, known, new, IPv6 /64, unknown IP, per editor, no raw IP stored, daily cap), cleanup, and E2E for a sign-in from a second network.

## 5. Requirements traceability

| Req | Phase | Status |
| --- | ----- | ------ |
| R1 Canvas board | 3 | ✅ pan/zoom/pinch/keyboard, minimap, list view |
| R2 Poem CRUD | 2 | ✅ tested (unit + E2E) |
| R3 Public/private + password | 2, 4 | ✅ |
| R4 Admin dashboard | 1 (shell), 2, 7 | ✅ sidebar shell, stats, filterable table, rich profile |
| R5 Neon | 0 | ✅ schema + driver switch (needs a Neon `DATABASE_URL` to go live) |
| R6 shadcn/ui, custom theme | 0 → all | ✅ every screen (sign-in, admin, settings, profile, board, overlay, search) uses the themed components |
| R7 Email OTP, passwordless | 1 | ✅ |
| R8 Visitor read/unlock | 4 | ✅ incl. board overlay |
| R9 Author sections | 1 (pen name), 3 | ✅ |
| R10 Full-text search | 5 | ✅ prefix, multi-word, typo, accent-insensitive; ⌘K palette |
| R11 Editor picks per-poem or one shared password | 4 | ✅ tested (unit, DB invariant, E2E) |
| N1 Private body never leaked | 3, 4, 5 | ✅ board, reading page, unlock and search tested |
| N2 OTP rules | 1 | ✅ tested |
| N3 Rate limits | 1, 4 | ✅ OTP and unlock |
| N4 Sessions | 1, 6 | ✅ tested; editors can list and revoke devices (Phase 6) |
| N5 Server-side authorisation | 1, 2 | ✅ tested (cross-editor IDOR, unit + E2E) |
| N6 Poem password hashing/revocation | 2, 4 | ✅ |
| N7 Accessibility | 3, 4, 6 | 🟡 board done (links, focus pan, list view); axe passes on every screen in both themes (E2E); manual screen-reader pass still to do |
| N8 Board caching | 3 | ✅ tag-invalidated on every admin save (E2E) |
| N9 No user enumeration | 1 | ✅ tested |

## 6. Decisions and open questions

Decided:
- **Who may become an editor?** Anyone who verifies their email. `EDITOR_ALLOWLIST` stays empty by default and remains available if you ever want to restrict sign-ups.
- **Do private poems show their title on the board?** Yes: title, author and a lock badge. The text stays hidden until the reader enters the password.
- **Password per poem, or one for all?** The editor decides, in Settings (R11). The default is a password per poem.

Open (current assumptions in brackets):

3. **Poem formatting?** [Plain text with line breaks and indentation preserved. Light Markdown (italics/bold) could come later.]
4. **How long does an unlock last?** [12 hours per browser, or until the editor changes the password.]
5. **Email provider / sending domain?** [Resend. A verified sending domain is needed for production.]
6. **Board layout?** [Automatic grid of author sections. Editor-arranged positions could be a later phase.]
