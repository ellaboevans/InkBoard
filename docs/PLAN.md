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

### Phase 2: Admin dashboard and poem management (R2, R3, R4, N5, N6)
- Dashboard shell (sidebar, my-poems table with status/visibility badges).
- Create/edit form: title, body (plain text, whitespace preserved), visibility toggle; password field required for private, optional "change password".
- Draft/publish, delete with confirmation, slug generation.
- **Accept:** an editor can CRUD only their own poems (tested by trying another editor's id); making a poem private without a password is rejected client- and server-side; changing a password bumps `password_version`.

### Phase 3: Public canvas board (R1, R9, N7, N8)
- Board data query (published poems grouped by author; private ones expose title only).
- Canvas engine: pan (drag/space+drag), zoom (wheel/pinch/±), fit-to-content, zoom-to-section, keyboard navigation, minimap.
- Author section "shelves" with label, count and poem cards; locked badge on private cards.
- Cached with `"use cache"` + `cacheTag('board')`, invalidated from admin mutations.
- **Accept:** board renders N authors × M poems smoothly; tab order reaches every card; private card HTML contains no body text.

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
| R1 Canvas board | 3 | ⏳ |
| R2 Poem CRUD | 2 | ⏳ |
| R3 Public/private + password | 2, 4 | ⏳ |
| R4 Admin dashboard | 1 (shell), 2 | ⏳ |
| R5 Neon | 0 | ✅ schema + driver switch (needs a Neon `DATABASE_URL` to go live) |
| R6 shadcn/ui, custom theme | 0 → all | 🟡 theme and auth screens done |
| R7 Email OTP, passwordless | 1 | ✅ |
| R8 Visitor read/unlock | 4 | ⏳ |
| R9 Author sections | 1 (pen name), 3 | 🟡 pen name captured |
| R10 Full-text search | 5 | ⏳ |
| N1 Private body never leaked | 3, 4, 5 | ⏳ |
| N2 OTP rules | 1 | ✅ tested |
| N3 Rate limits | 1, 4 | 🟡 OTP request/verify (per email, IP, global) done; unlock pending |
| N4 Sessions | 1 | ✅ tested |
| N5 Server-side authorisation | 1, 2 | 🟡 DAL in place |
| N6 Poem password hashing/revocation | 2, 4 | ⏳ |
| N7 Accessibility | 3, 4 | ⏳ |
| N8 Board caching | 3 | ⏳ |
| N9 No user enumeration | 1 | ✅ tested |

## 6. Open questions (current assumptions in brackets)

1. **Who may become an editor?** [Anyone who verifies an email, unless `EDITOR_ALLOWLIST` is set to specific emails / `@domains`.]
2. **Do private poems show their title on the board?** [Yes: title, author and a lock badge. The body stays hidden.]
3. **Poem formatting?** [Plain text with line breaks and indentation preserved. Light Markdown (italics/bold) could come later.]
4. **How long does an unlock last?** [12 hours per browser, or until the editor changes the password.]
5. **Email provider / sending domain?** [Resend. A verified sending domain is needed for production.]
6. **Board layout?** [Automatic grid of author sections. Editor-arranged positions could be a later phase.]
