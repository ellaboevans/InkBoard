# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

PoemHub is a public, pan/zoom canvas board of poems grouped into per-author sections. Editors manage their poems from `/admin` and sign in with a passwordless email OTP. Poems are public or password-protected. **`docs/PLAN.md` is the source of truth** for requirements (R1–R10, N1–N9), phases, architecture decisions and the traceability matrix. Update its status table when a phase lands.

## Commands

```bash
pnpm dev                      # Next dev server (reads .env.local)
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
```

Use Node 22+ (`.nvmrc`). On Node 20, Vitest 5 crashes while printing failures (`Map.groupBy`), which hides which test failed.

Local setup needs a Postgres on localhost with three databases: `poemhub_dev` (from `.env.local`), `poemhub_test` (Vitest) and `poemhub_e2e` (Playwright). Create them with `createdb`. Test and E2E setup apply migrations and truncate automatically, and refuse to run against a database whose name doesn't contain `test`/`e2e`. Override the URLs with `TEST_DATABASE_URL` / `E2E_DATABASE_URL`. Playwright uses the installed Chrome (`PW_CHANNEL` to change).

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

**Rate limiting** (`src/server/rate-limit.ts`) is a single atomic Postgres upsert per call into `rate_limits` (fixed window). Keys look like `otp:req:email:<sha256>`, `otp:cooldown:<sha256>`, `otp:req:ip:<ip>`, `otp:verify:email:{h,d}:<sha256>`. About 1% of calls also prune rows older than 2 days. Tests clear rows by key prefix to skip cooldowns.

**Database.** Drizzle schema in `src/db/schema.ts`, SQL migrations in `drizzle/`. Always generate migrations, never hand-edit applied ones. `getDb()` (`src/db/index.ts`) picks `@neondatabase/serverless` (WebSocket pool, supports transactions) when the `DATABASE_URL` host is `*.neon.tech`, and `pg` otherwise. Both are typed as a generic `PgDatabase`, so raw `db.execute()` results must be cast to `{ rows: … }`. `poems` has a CHECK that private poems have a `password_hash`. `password_version` exists so that unlock cookies can be revoked when the password changes.

**Env** is validated lazily with zod via `env()` in `src/env.ts`, so the build doesn't need secrets. `resetEnvCache()` lets tests change env. Without `RESEND_API_KEY`, `sendOtpEmail` logs codes to the server console in development (and is a hard error in production). If `E2E_OTP_OUTBOX` is set and the app isn't in production, it also appends codes to that file, which is how Playwright reads them.

**Tests.** `vitest.config.mts` aliases `server-only` to an empty module, mocks `@/server/email` into `tests/support/outbox.ts` (`lastCodeFor(email)`), truncates all tables before each test, and runs files serially against the shared DB. Integration tests exercise real SQL, including concurrency (`Promise.all`) for races.

**UI/theme.** Tailwind v4 is configured via CSS (`src/app/globals.css`) with a custom "paper & ink" palette, a dark "night ink" variant, and extra `--canvas`/`--canvas-dot` tokens for the board. Fonts: Geist (`font-sans`) for UI and Newsreader (`font-serif`, also `font-heading`) for poem titles and text.
