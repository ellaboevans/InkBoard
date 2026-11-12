# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

PoemHub is a public, pan/zoom canvas board of poems grouped into per-author sections. Editors manage their poems from `/admin` and sign in with a passwordless email OTP. Poems are public or password-protected. **`docs/PLAN.md` is the source of truth** for requirements (R1–R10, N1–N9), phases, architecture decisions and the traceability matrix. Update its status table when a phase lands.

## Commands

```bash
pnpm dev                      # checks the DB has all migrations, then starts Next (reads .env.local)
pnpm db:check                 # just the migration check
pnpm build                    # Production build; also enforces Cache Components rules
pnpm typecheck                # tsc --noEmit
pnpm lint                     # ESLint (incl. React Compiler-style hook rules)
pnpm test                     # Vitest: unit + DB integration tests (needs local Postgres)
pnpm vitest run tests/auth/otp.test.ts       # single file
pnpm vitest run -t "is single use"           # single test by name
pnpm exec playwright test                    # E2E (spawns its own dev server on :3100)
pnpm exec playwright test -g "first sign-in" # single E2E test
pnpm db:generate --name=<name>  # SQL migration from src/db/schema.ts → drizzle/
pnpm db:migrate                 # apply migrations to DATABASE_URL
pnpm next typegen               # regenerate route types (LayoutProps<"/x"> etc.) after adding routes
pnpm db:seed                    # demo authors + poems (only @seed.poemhub.test editors); --clear removes them
```

Use Node 22+ (`.nvmrc`). On Node 20, Vitest 5 crashes while printing failures (`Map.groupBy`), which hides which test failed.

Local setup needs a Postgres on localhost with three databases: `poemhub_dev` (from `.env.local`), `poemhub_test` (Vitest) and `poemhub_e2e` (Playwright). Create them with `createdb`. Test and E2E setup apply migrations and truncate automatically, and refuse to run against a database whose name doesn't contain `test`/`e2e`. Playwright uses the installed Chrome (`PW_CHANNEL` to change).

Several worktrees of this repo may be checked out side by side, and each test run truncates its database. Use databases and a port dedicated to your worktree, e.g. `TEST_DATABASE_URL=postgresql://localhost:5432/poemhub_test_<name> E2E_DATABASE_URL=…/poemhub_e2e_<name> E2E_PORT=3170` (create them with `createdb` first). The E2E dev server builds into `.next-e2e` (`NEXT_DIST_DIR`), so it can run alongside a normal `pnpm dev`. Next allows only one dev server per build directory, and each `next dev` points `next-env.d.ts` at its own one (the file is gitignored and harmless). E2E specs clear `rate_limits` in `beforeEach`, because every local request shares the client IP `::1`.

Add UI primitives with `npx shadcn@latest add <component>` (Radix base, `radix-nova` style). Generated components import `cn` from the npm package `cn` (shadcn's clsx + tailwind-merge replacement), which is expected.

## Architecture

**Next.js 16 with `cacheComponents` + `partialPrefetching`.** This shapes most code:
- Anything reading `cookies()`/`headers()` (i.e. anything session-aware) must render inside a `<Suspense>` boundary, otherwise the build fails. Pages keep a static shell and put a small async component behind Suspense (see `src/app/admin/page.tsx`, `src/app/sign-in/page.tsx`). Don't `await` the session at the top level of a layout.
- `cookies()` can't be read inside `"use cache"`. Resolve the editor first and pass IDs into cached functions.
- Middleware is `src/proxy.ts`. It only checks optimistically that the session cookie exists for `/admin/*`.
- No `runtime` segment exports (Node runtime only).
- After a Server Action mutates data shown in a shared layout, call `refresh()` from `next/cache` before `redirect()`, or the layout stays stale.

**Auth (custom email OTP, `src/server/auth/`).** Layers, each depending only on the ones above it:
- `email.ts`: pure helpers (normalize, allowlist matching). `crypto.ts`: OTP generation, HMAC (keyed by `AUTH_SECRET`, with a purpose string), SHA-256, constant-time compare.
- `otp.ts`: `requestOtp` / `verifyOtp`. These are framework-free and covered by integration tests. Guarantees: only an HMAC of `email:code` is stored, there is one live code per email, attempts are counted atomically *before* comparing, consumption is a conditional `UPDATE … WHERE consumed_at IS NULL`, and the first successful verify upserts the `editors` row. Non-allowlisted emails get the same response and the same cooldown/rate-limit path as allowed ones (no enumeration), so keep it that way when editing.
- `sessions.ts`: DB sessions (random token in the cookie, SHA-256 in the `sessions` table, 30-day fixed expiry). Times are computed with DB `now()`, not JS `Date`.
- `dal.ts`: the **only** place that maps a request to an editor (`getCurrentEditor`, `requireEditor`, `requireOnboardedEditor`) and sets/clears the cookie (`startSession`/`endSession`, usable from Server Actions only). Every Server Action must re-authorize through the DAL. Never trust `useActionState`'s `prev` state for identity, because it comes from the client.
- An editor with `pen_name` null hasn't onboarded yet. The pen name is the author's section label on the board, and the slug is used in public URLs.

**Client IP** comes from `X-Forwarded-For`, counting `TRUSTED_PROXY_HOPS` entries from the right (`src/server/auth/ip.ts`); entries further left are client-controlled. Requests with no IP share an `unknown` bucket. OTP emails are sent in `after()` so response timing doesn't reveal allowlist membership. Tests mock `after` from `next/server` to run the task immediately.

**Poems** (`src/server/poems.ts`) follow the same pattern as `otp.ts`: framework-free functions that take the DAL-resolved `editorId` and scope **every** query by it. Another editor's poem id behaves like a missing one, and malformed ids are rejected before reaching SQL. Reads return `hasPassword` and never `password_hash`/`password_version`; keep it that way, since the editor UI gets these objects as props.
- Passwords: scrypt (`src/server/passwords.ts`, format `scrypt$N$r$p$salt$hash`, NFKC-normalised). Every password change or removal bumps `password_version`.
- Slugs: unique per editor. A draft's slug follows its title; once the poem is published the slug stays fixed.
- Limits: shared with the client in `src/lib/poem-limits.ts`.
- Server Actions (`src/app/admin/poems/actions.ts`) re-authorize, then call `updateTag(BOARD_TAG)` / `updateTag(poemTag(id))` from `src/server/cache-tags.ts`. Any new mutation that changes what readers see must do the same.

**Private-poem passwords** have two modes per editor (`editors.password_mode`): `per_poem` (`poems.password_hash`) or `shared` (`editors.shared_password_hash`, with poem hashes null).
- Switching is handled in `src/server/password-settings.ts`, the reader side in `src/server/unlock.ts`.
- The rule "a private poem is always readable with some password" is enforced in the DB by triggers (`drizzle/0002_password_mode_triggers.sql`), which raise `check_violation` (23514); `guardPasswordInvariant` in `poems.ts` turns that into a form error.
- **Lock order:** always the editor row first, then poem rows. Poem saves take `FOR NO KEY UPDATE` on the editor, which also makes an editor's own slug allocation race-free. Keep this order in any new write that touches both, or saves and mode switches will deadlock.
- Reader unlock grants are scoped `p:<poemId>:<password_version>` or `a:<editorId>:<shared_password_version>`. Any change that should lock readers out must bump the matching version.
- Reading the unlock cookie checks expiry against the clock, so it calls `connection()`.
- Wrong-guess rate-limit keys: `unlock:<p|a>:<id>:ip:<ip>` and `unlock:ip:<ip>`.

**Board (reader side).** `src/server/board.ts` holds the uncached, tested loaders; `board-cache.ts` wraps them in `"use cache"` + `cacheTag(BOARD_TAG)`. Keep that split, because `next/cache` functions can't run under Vitest.
- Never select `poems.body` for readers without `CASE WHEN visibility = 'public'` (N1). The tests check that the JSON contains no private text.
- `/` is prerendered at build time, so `pnpm build` needs a reachable `DATABASE_URL`. Data written outside the app (the seed) shows up after the hourly revalidation or a server restart.
- The canvas keeps its camera in a ref and writes the transform straight to the DOM. React state only feeds the zoom label and minimap, so don't put the camera in state.
- World elements are absolutely positioned inside a 0×0 container, so give them explicit widths. Shrink-to-fit would truncate them.
- Pointer capture is taken only once a drag passes 4px, so a plain click still reaches the card's link.
- In E2E, call `openBoard()` (it waits for `data-ready="true"`) before interacting.
- Playwright starts the web server *before* globalSetup runs the migrations. That's why its readiness URL is `/sign-in`, which doesn't touch the DB.
- The dev database may also be shared with sibling worktrees, and their seeds overwrite yours. For visual checks use a database of your own (e.g. `poemhub_dev_<name>`).

**Poem overlay.** `src/app/@modal` is a parallel slot rendered by the root layout.
- `(.)p/[author]/[poem]` intercepts soft navigations from the board and shows `PoemReader` in `PoemModal`. Hard loads render `src/app/p/[author]/[poem]/page.tsx`, which uses the same reader.
- `@modal/default.tsx`, `@modal/page.tsx` and `@modal/[...catchAll]/page.tsx` all return null, so the overlay clears when navigating anywhere else. Keep them.
- Client components in the slot can't call `usePathname()` outside Suspense (a build error under Cache Components), so URL-dependent bits are rendered on the server and passed in (`toolbar`).

**Toasts.** Use `notify` from `src/lib/notify.ts` (Sileo, top-centre, `src/components/toaster.tsx`); don't import `sileo` directly.
- Wrap `useActionState` actions in `withErrorToast`, which turns unexpected throws into a toast but still lets `redirect()`/`notFound()` through (`unstable_rethrow`).
- After a redirect, show success with a flash param plus `<FlashToast param=… />` (examples: `?deleted=1`, `?signed-in=1`, `?welcome=1`, `/sign-in?signed-out=1`).
- Toast descriptions often repeat inline text, so in E2E scope inline assertions with `page.getByRole("main")`, and toast assertions with `[data-sileo-toast]`.

**Client patterns.**
- Forms use `useActionState` with controlled inputs, because React resets uncontrolled fields after an action and that would wipe a poem on a validation error.
- Don't show toasts or other one-shot side effects from `useEffect` on action state: effects re-run under StrictMode and when Next re-shows a route kept in `<Activity>`. Fire them from the action wrapper, or for redirect flashes (`?created=1`) use `useOnceToast` (`src/hooks/use-once-toast.ts`).
- Next keeps recently visited routes mounted but hidden (`<Activity>`, `display: none`). So anything that must not outlive the session (sign-out) has to do a full page load, not a router navigation: see `src/app/admin/sign-out-button.tsx`.
- A form's first submit button is what Enter triggers. Multi-button forms put a hidden "keep current status" button first (`poem-form.tsx`).
- In E2E tests, use `getByRole` (it skips hidden Activity routes). For password inputs, which have no role, use `getByLabel(…).filter({ visible: true })`. Plain `getByLabel`/`getByPlaceholder` can match a hidden copy of the page and fail in strict mode.
- Don't start function names with `use` unless they're hooks: the hooks lint rule flags them (hence `switchToPerPoemPasswords`).
- Lint forbids `setState` inside effects. Adjust state during render instead (the `seenState !== state` pattern in `poem-form.tsx` and `sign-in-form.tsx`).

**Rate limiting** (`src/server/rate-limit.ts`) is a single atomic Postgres upsert per call into `rate_limits` (fixed window). Keys look like `otp:req:email:<sha256>`, `otp:cooldown:<sha256>`, `otp:req:ip:<ip>`, `otp:verify:email:{h,d}:<sha256>`. About 1% of calls also prune rows older than 2 days. Tests clear rows by key prefix to skip cooldowns.

**Database.** Drizzle schema in `src/db/schema.ts`, SQL migrations in `drizzle/`. Always generate migrations, never hand-edit applied ones. `getDb()` (`src/db/index.ts`) picks `@neondatabase/serverless` (WebSocket pool, supports transactions) when the `DATABASE_URL` host is `*.neon.tech`, and `pg` otherwise. Both are typed as a generic `PgDatabase`, so raw `db.execute()` results must be cast to `{ rows: … }`. Private poems must be readable with some password: see the password-mode triggers above. `password_version` exists so that unlock cookies can be revoked when the password changes.

**Env** is validated lazily with zod via `env()` in `src/env.ts`, so the build doesn't need secrets. `resetEnvCache()` lets tests change env. Without `RESEND_API_KEY`, `sendOtpEmail` logs codes to the server console in development (and is a hard error in production). If `E2E_OTP_OUTBOX` is set and the app isn't in production, it also appends codes to that file, which is how Playwright reads them.

**Tests.** `vitest.config.mts` aliases `server-only` to an empty module, mocks `@/server/email` into `tests/support/outbox.ts` (`lastCodeFor(email)`), truncates all tables before each test, and runs files serially against the shared DB. Integration tests exercise real SQL, including concurrency (`Promise.all`) for races.

**UI/theme.** Tailwind v4 is configured via CSS (`src/app/globals.css`) with a custom "paper & ink" palette, a dark "night ink" variant, and extra `--canvas`/`--canvas-dot` tokens for the board. Fonts: Geist (`font-sans`) for UI and Newsreader (`font-serif`, also `font-heading`) for poem titles and text.
