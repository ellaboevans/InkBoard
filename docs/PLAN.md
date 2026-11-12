# PoemHub — Product & Engineering Plan

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
| Search | Postgres FTS (`tsvector` generated columns + GIN) on poem **title** and author **pen name**, plus `pg_trgm` for typo-tolerant/prefix matches | R10 without an external service; bodies are excluded (N1). |
| Private unlock | Server Action verifies password → sets a signed (HMAC) per-poem cookie bound to the poem's `password_version`, 12h expiry | Stateless, revocable on password change (N6). |
| Rate limiting | Fixed-window counters in a Postgres table (`rate_limits`) | Works on serverless without adding Redis; can be swapped for Upstash later. |

### Data model (Phase 0)

```
editors      id · email (unique, lower-cased) · pen_name · slug (unique) · bio · created_at · updated_at · last_sign_in_at
email_otps   id · email · code_hash · expires_at · attempts · consumed_at · created_at · requested_ip
sessions     id · editor_id → editors · token_hash (unique) · expires_at · created_at · user_agent · ip
poems        id · editor_id → editors · title · slug (unique per editor) · body · visibility(public|private)
             · password_hash · password_version · status(draft|published) · published_at · created_at · updated_at
             CHECK (visibility = 'public' OR password_hash IS NOT NULL)
rate_limits  key (pk) · window_start · count
```

Phase 5 adds `search` tsvector generated columns + GIN/trigram indexes.

### Route map

```
/                      Public canvas board (R1, R9) + search (R10)
/p/[author]/[poem]     Reading view; password gate for private poems (R8)
/sign-in               Email → OTP (R7)
/admin                 Dashboard: my poems (R4)
/admin/onboarding      First sign-in: choose pen name (the section label)
/admin/poems/new       Create poem (R2, R3)
/admin/poems/[id]      Edit poem, visibility, password, publish, delete (R2, R3)
/admin/profile         Pen name, bio, sessions / sign out
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
  - The per-email caps let an attacker lock a specific editor out of sign-in for up to a day (#5). Mitigations to consider: per-(email, IP) budgets, and a "someone is trying to sign in" email.
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
- **Not in this phase:** `/admin/profile` (changing pen name or bio, managing sessions). It moves to Phase 6, unless it's wanted sooner.

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

### Phase 4: Reading view and private unlock (R3, R8, N1, N3, N6)
- `/p/[author]/[poem]` reading page; opened from the board as an intercepted modal route, also directly linkable.
- Password gate → Server Action → signed unlock cookie → full text. Rate-limited.
- **Accept:** wrong password shows an error and never reveals the body; correct password reveals it; changing the password in admin re-locks it for readers.

### Phase 5: Full-text search (R10)
- Migration: generated `tsvector` columns on `editors.pen_name` and `poems.title`, GIN + trigram indexes.
- Search box on the board (⌘K): results grouped as **Authors** and **Poems**; selecting one flies the camera to the section/card and highlights it.
- **Accept:** prefix ("ros" → "Rose"), multi-word and slightly misspelt queries match; poem bodies never match.

### Phase 6: Hardening and launch
- Security review of the full app, CSP/security headers, stale row cleanup (OTPs, sessions, rate limits) via cron.
- E2E tests (Playwright) for the sign-in, publish, board, unlock and search flows.
- Neon production branch + preview branches per PR; deploy (e.g. Vercel) with env setup docs.

## 5. Requirements traceability

| Req | Phase | Status |
| --- | ----- | ------ |
| R1 Canvas board | 3 | ✅ pan/zoom/pinch/keyboard, minimap, list view |
| R2 Poem CRUD | 2 | ✅ tested (unit + E2E) |
| R3 Public/private + password | 2, 4 | 🟡 editor side done; reader unlock in Phase 4 |
| R4 Admin dashboard | 1 (shell), 2 | ✅ |
| R5 Neon | 0 | ✅ schema + driver switch (needs a Neon `DATABASE_URL` to go live) |
| R6 shadcn/ui, custom theme | 0 → all | 🟡 theme, auth, admin and board done |
| R7 Email OTP, passwordless | 1 | ✅ |
| R8 Visitor read/unlock | 4 | 🟡 public reading page done; unlock in Phase 4 |
| R9 Author sections | 1 (pen name), 3 | ✅ |
| R10 Full-text search | 5 | ⏳ |
| N1 Private body never leaked | 3, 4, 5 | 🟡 board + reading page tested (unit + E2E); unlock and search pending |
| N2 OTP rules | 1 | ✅ tested |
| N3 Rate limits | 1, 4 | 🟡 OTP request/verify (per email, IP, global) done; unlock pending |
| N4 Sessions | 1 | ✅ tested |
| N5 Server-side authorisation | 1, 2 | ✅ tested (cross-editor IDOR, unit + E2E) |
| N6 Poem password hashing/revocation | 2, 4 | 🟡 scrypt + version bump done; unlock cookies in Phase 4 |
| N7 Accessibility | 3, 4 | 🟡 board done (links, focus pan, list view) |
| N8 Board caching | 3 | ✅ tag-invalidated on every admin save (E2E) |
| N9 No user enumeration | 1 | ✅ tested |

## 6. Decisions and open questions

Decided:
- **Who may become an editor?** Anyone who verifies their email. `EDITOR_ALLOWLIST` stays empty by default and remains available if you ever want to restrict sign-ups.
- **Do private poems show their title on the board?** Yes: title, author and a lock badge. The text stays hidden until the reader enters the password.

Open (current assumptions in brackets):

3. **Poem formatting?** [Plain text with line breaks and indentation preserved. Light Markdown (italics/bold) could come later.]
4. **How long does an unlock last?** [12 hours per browser, or until the editor changes the password.]
5. **Email provider / sending domain?** [Resend. A verified sending domain is needed for production.]
6. **Board layout?** [Automatic grid of author sections. Editor-arranged positions could be a later phase.]
