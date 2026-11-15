# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

InkBoard (formerly PoemHub) is a public, pan/zoom canvas board of poems grouped into per-author sections. Editors manage their poems from `/admin` and sign in with a passwordless email OTP. Poems are public or password-protected. **`docs/PLAN.md` is the source of truth** for requirements (R1–R10, N1–N9), phases, architecture decisions and the traceability matrix. Update its status table when a phase lands.

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
- `/admin/profile` renames via `updateProfile` (`profile.ts`), which never touches the slug: it is in every `/p/[author]/[poem]` link, so it is fixed once onboarding sets it. Device management (`listSessions`, `revokeSession`, `revokeOtherSessions` in `sessions.ts`) is scoped by editor; the current session's id comes from the DAL (`requireOnboardedSession`). Results never include `token_hash`.

**Naming.** The product is "InkBoard" in everything users see. Internal identifiers keep `poemhub` on purpose: the `poemhub_session`/`poemhub_unlock` cookies (renaming signs everyone out / drops unlocks), the `poemhub-avatar-NN` avatar seeds (renaming changes every avatar), database names, `@seed.poemhub.test` demo accounts and the package name.

**Emails** (`src/server/email.ts`, content in `src/server/email-templates.ts` as pure functions). `sendOtpEmail`, `sendSignInAlertEmail` and `sendWelcomeEmail` share one delivery path; tests mock all three (`outbox`, `alerts`, `welcomes` in `tests/support/outbox.ts`), and the E2E outbox records them as `{ kind: "sign-in-alert" }` / `{ kind: "welcome" }` lines (`alertsFor()`, `welcomesFor()` helpers).
- Welcome email: `sendWelcomeOnce` (`src/server/welcome.ts`) runs in the onboarding action. It claims `editors.welcomed_at` with one conditional UPDATE before sending, so it goes out at most once even on resubmits; migration 0008 marks editors onboarded before it shipped as welcomed. Copy is signed by `WELCOME_SIGNATURE`.
- Code emails are built for client code detection: keep the code unbroken and alone on its line, and add **no other 4–8 digit numbers** (a test checks). Non-code emails must not contain the word "code".
- New sign-in alerts: `notifyIfNewSignIn` runs after `startSession` in the verify action and alerts on a new **device or network** (a new machine on the same Wi-Fi shares the public IP, so networks alone miss it). `sign_in_locations` holds `hmac("sign-in-location", ipBucket(ip))`, never IPs; `sign_in_devices` holds `hmac("sign-in-device", id)` of the long-lived `poemhub_device` cookie (`deviceIdForSignIn` in the DAL; it outlives sign-out on purpose). The first device/network ever recorded stays quiet. E2E simulates networks with `X-Forwarded-For` and devices with fresh browser contexts.

**Client IP** comes from `X-Forwarded-For`, counting `TRUSTED_PROXY_HOPS` entries from the right (`src/server/auth/ip.ts`); entries further left are client-controlled. Requests with no IP share an `unknown` bucket. OTP emails are sent in `after()` so response timing doesn't reveal allowlist membership. Tests mock `after` from `next/server` to run the task immediately.

**Poems** (`src/server/poems.ts`) follow the same pattern as `otp.ts`: framework-free functions that take the DAL-resolved `editorId` and scope **every** query by it. Another editor's poem id behaves like a missing one, and malformed ids are rejected before reaching SQL. Reads return `hasPassword` and never `password_hash`/`password_version`; keep it that way, since the editor UI gets these objects as props.
- Passwords: scrypt (`src/server/passwords.ts`, format `scrypt$N$r$p$salt$hash`, NFKC-normalised). Every password change or removal bumps `password_version`.
- Slugs: unique per editor. A draft's slug follows its title; once the poem is published the slug stays fixed.
- Limits: shared with the client in `src/lib/poem-limits.ts`.
- Server Actions (`src/app/admin/poems/actions.ts`) re-authorize, then call `updateTag(BOARD_TAG)` / `updateTag(poemTag(id))` from `src/server/cache-tags.ts`. Any new mutation that changes what readers see must do the same.

**Revision history** (`poem_revisions`, `src/server/poem-history.ts`, docs/PLAN.md Phase 13). `recordRevision` runs only inside the save transactions in `poems.ts`, after the editor → poem locks, and only when title, text or language changed; it prunes to `REVISIONS_KEPT` (20) in the same transaction.
- Editor-only: reads join `poems` and filter by the DAL-resolved `editorId`; never read it for readers (no board, feed, search or share-card query). A test fails if any other module references the table, or if its loaders are used outside `src/app/admin/`.
- Never add password, hash or visibility columns to it. A restore only fills the editor form (`poem-history.tsx`); the normal save records it, so don't add a second save path.

**Collections** (`src/server/collections.ts`, docs/PLAN.md Phase 14): an editor's ordered groups of their own poems; a poem is in at most one.
- Same scoping as poems (DAL `editorId` on every query, foreign ids look missing, malformed ids rejected before SQL). Lock order: editor row (`FOR NO KEY UPDATE`) → collection rows (`lockCollections`, id order) → poems. Poem saves and deletes in `poems.ts` follow it too; keep it in any new write.
- `collection_position` is 1..n over all the collection's poems (drafts included) and must stay contiguous: change it only through `placePoem`/`compactCollection`/`moveCollectionPoem`, which renumber in two steps (the unique index would trip on a one-step swap). Readers' "Part n of m" counts published poems only (`loadReaderCollection` in `board.ts`): titles, slugs and visibility, never text.
- Public page `/a/[author]/c/[collection]` (`loadCollectionPage`, `getCollectionPage`): published poems only, numbered 1..n without drafts; null (not found) when nothing is published. Board/author-page cards carry a `collection` badge computed with window functions over the query's own rows, so those queries must keep selecting published poems only. `CollectionBadgeLine` uses `contain: inline-size`; grids holding truncated titles need `minmax(0,1fr)` columns (a phone check in `e2e/collection-page.spec.ts` catches sideways scrolling).
- Every collection mutation that readers could see calls `updateTag(BOARD_TAG)`. Reader prev/next links: router links with `replace` in the overlay (closing it is `router.back()`), plain `<a>` on the full page (a soft navigation to `/p/…` is intercepted into the overlay).
- The order page's buttons use `aria-disabled`, never `disabled` (a disabled button drops focus), and move focus to the moved poem after the refresh.
- Drag and drop (@dnd-kit, `collection-order.tsx`) is pointer-only from the grip handle (`aria-hidden`, not focusable, `touch-none` on the handle alone so lists still scroll on phones); the Move buttons stay the keyboard path. A drop shows its order locally, saves it via `reorderCollection` (whole order, checked against the current set under the lock; stale → refused and refreshed) and rolls back with a toast on failure. Create/edit forms live in Dialogs, mounted only while open. List rows are grid items: give the grid `minmax(0,1fr)` so long titles truncate instead of widening the page.

**Private-poem passwords** have two modes per editor (`editors.password_mode`): `per_poem` (`poems.password_hash`) or `shared` (`editors.shared_password_hash`, with poem hashes null).
- Switching is handled in `src/server/password-settings.ts`, the reader side in `src/server/unlock.ts`.
- The rule "a private poem is always readable with some password" is enforced in the DB by triggers (`drizzle/0002_password_mode_triggers.sql`), which raise `check_violation` (23514); `guardPasswordInvariant` in `poems.ts` turns that into a form error.
- **Lock order:** always the editor row first, then poem rows. Poem saves take `FOR NO KEY UPDATE` on the editor, which also makes an editor's own slug allocation race-free. Keep this order in any new write that touches both, or saves and mode switches will deadlock.
- Reader unlock grants are scoped `p:<poemId>:<password_version>` or `a:<editorId>:<shared_password_version>`. Any change that should lock readers out must bump the matching version.
- Reading the unlock cookie checks expiry against the clock, so it calls `connection()`.
- Wrong-guess rate-limit keys: `unlock:<p|a>:<id>:ip:<bucket>`, `unlock:ip:<bucket>`, and `unlock:<p|a>:<id>:all` (all clients combined).
- Always key rate limits on `ipBucket(ip)` (`src/server/auth/ip.ts`, which groups IPv6 by /64), never on the raw IP.
- Unpublishing bumps `password_version`, which revokes unlocks.

**Board (reader side).** `src/server/board.ts` holds the uncached, tested loaders; `board-cache.ts` wraps them in `"use cache"` + `cacheTag(BOARD_TAG)`. Keep that split, because `next/cache` functions can't run under Vitest.
- Never select `poems.body` for readers without `CASE WHEN visibility = 'public'` (N1). The tests check that the JSON contains no private text.
- `/` is prerendered at build time, so `pnpm build` needs a reachable `DATABASE_URL`. Data written outside the app (the seed) shows up after the hourly revalidation or a server restart.
- The canvas keeps its camera in a ref and writes the transform straight to the DOM. React state only feeds the zoom label and minimap, so don't put the camera in state. The initial fit re-runs only when the layout's bounds *values* change (a filter), not on a new but identical layout from a server `refresh()` (e.g. unlocking a poem in the overlay), so returning from the overlay keeps the reader's pan/zoom.
- World elements are absolutely positioned inside a 0×0 container, so give them explicit widths. Shrink-to-fit would truncate them.
- Pointer capture is taken only once a drag passes 4px, so a plain click still reaches the card's link.
- The top board overlays (toolbar, language-filter status, Authors index) share one flow column in `board-canvas.tsx`, so each sits below the previous one however the toolbar wraps. Don't give an overlay its own guessed `top-*`, and don't centre an absolute box with `left-1/2 -translate-x-1/2`: it can only size itself in the space right of its left edge (half the screen), so its text wraps word by word on phones. Centre with a full-width row instead (the zoom bar). `e2e/board-language.spec.ts` checks this at 320/375/1280px.
- Toolbar buttons that go icon-only on phones hide their label with `max-sm:sr-only`, never `hidden sm:inline` (that leaves them unnamed).
- In E2E, call `openBoard()` (it waits for `data-ready="true"`) before interacting.
- The author page (`/a/[author]`, `loadAuthorPage`) follows the same rules as the board: published only, `CASE WHEN visibility = 'public'` for excerpts, never the email. Anything that changes it (profile save, pin) must `updateTag(BOARD_TAG)`.
- Poem text is light Markdown (`src/lib/poem-markdown.ts`, rendered by `PoemText`, inline only). Anything that shows poem text as plain text (meta description, JSON-LD, share cards) must go through `stripPoemMarkdown`.
- Board cards, the author page and the editor preview all render `PoemCardFace` (`src/components/board/poem-card-face.tsx`); excerpts come from `cardExcerpt` (`src/lib/poem-text.ts`), which mirrors the SQL. Change both together (a test compares them).
- Poem cards are stretched links: the `<Link>` wraps only the title (named by it, carrying `data-poem-id`/`data-rect`), and its `::after` covers the `[data-card]` div. Don't put `aria-label` on cards. Highlights and in-view checks target the `[data-card]` div.
- `next dev` compiles routes on first request. globalSetup warms every route (including the intercepted overlay, via RSC + Next-Url headers); add new routes there. Server Actions can't be warmed, hence the long test and expect timeouts in `playwright.config.ts`.
- Playwright starts the web server *before* globalSetup runs the migrations. That's why its readiness URL is `/sign-in`, which doesn't touch the DB.
- The dev database may also be shared with sibling worktrees, and their seeds overwrite yours. For visual checks use a database of your own (e.g. `poemhub_dev_<name>`).

**Poem overlay.** `src/app/@modal` is a parallel slot rendered by the root layout.
- `(.)p/[author]/[poem]` intercepts soft navigations from the board. Hard loads render `src/app/p/[author]/[poem]/page.tsx`, which uses the same `PoemReader`.
- The dialog shell (`PoemModal`, `src/components/poem/poem-modal.tsx`) lives in `@modal/(.)p/layout.tsx`, above `[author]`, so stepping between poems (collection Next/Previous, even across authors) swaps only the page inside it: the dialog, backdrop and scroll container stay mounted and don't replay their animation. The page renders the poem plus its own sticky "Open full page" toolbar (server-rendered from its params).
- The shell must keep the page renderable on the server, or Next drops it from instant-navigation validation ("Could not validate that a segment… has instant navigation"). So: **no portal** (it uses Radix Dialog primitives directly, styled like `ui/dialog.tsx`, whose `DialogContent` always portals; the slot sits at the top of `<body>`, so fixed positioning works in place) and **no URL hooks or Suspense around the children** (`usePathname` would need one).
- Naming: Next keeps previously shown poems mounted but hidden (`<Activity>`), so never name the dialog with a fixed id or Radix's shared title id: both can resolve to a hidden poem. Each poem's `<h1>` gets `poemTitleId(author, slug)` (`src/lib/poem-overlay.ts`), and `OverlayPoemShown` (`overlay-poem-shown.tsx`, a layout effect next to the title) points the dialog's `aria-labelledby` at it when that poem is shown, scrolls the dialog to the top and focuses the title (`tabIndex=-1`, with "Part n of m" as its `aria-describedby`). Hidden poems run no effects, so they never claim the name. The skeleton does the same with "Loading poem" (`OverlayPoemLoading`). It syncs the DOM, not state. Radix's open auto-focus is turned off so it doesn't override this.
- Closing (Esc, X, outside click) is `router.back()`; collection links inside the overlay use `replace`, so one step back always returns to the board with the same pan/zoom (`e2e/collections.spec.ts` checks the same dialog node survives steps, with no replayed animation).
- `@modal/default.tsx`, `@modal/page.tsx` and `@modal/[...catchAll]/page.tsx` all return null, so the overlay (and its layout) clears when navigating anywhere else. Keep them.
- Client components in the slot can't call `usePathname()` outside Suspense (a build error under Cache Components), so URL-dependent bits are rendered on the server per poem.

**Search** (`src/server/search.ts`, `GET /api/search`, `src/components/board/board-search.tsx`) covers pen names and poem titles only. Never add `poems.body`: a test makes body text searchable on purpose and checks that it fails.
- Index expressions use `search_normalize()` from `drizzle/0003_search.sql`, so new queries must use the same expression or they won't hit the index.
- The indexes live only in that SQL migration, not in `schema.ts`; drizzle-kit ignores them.
- Prefix matching comes first; typo matching is a per-group fallback only (see the file header for why).
- The palette uses Dialog directly rather than `CommandDialog`, so that after a pick it can stop Radix returning focus to the Search button.

**Toasts.** Use `notify` from `src/lib/notify.ts` (Sileo, top-centre, `src/components/toaster.tsx`); don't import `sileo` directly.
- Wrap `useActionState` actions in `withErrorToast`, which turns unexpected throws into a toast but still lets `redirect()`/`notFound()` through (`unstable_rethrow`).
- After a redirect, show success with a flash param plus `<FlashToast param=… />` (examples: `?deleted=1`, `?signed-in=1`, `?welcome=1`, `/sign-in?signed-out=1`).
- Toast descriptions often repeat inline text, so in E2E scope inline assertions with `page.getByRole("main")`, and toast assertions with `[data-sileo-toast]`.

**Client patterns.**
- Forms use `useActionState` with controlled inputs, because React resets uncontrolled fields after an action and that would wipe a poem on a validation error.
- Don't show toasts or other one-shot side effects from `useEffect` on action state: effects re-run under StrictMode and when Next re-shows a route kept in `<Activity>`. Fire them from the action wrapper, or for redirect flashes (`?created=1`) use `useOnceToast` (`src/hooks/use-once-toast.ts`).
- Next keeps recently visited routes mounted but hidden (`<Activity>`, `display: none`). So anything that must not outlive the session (sign-out) has to do a full page load, not a router navigation: see `src/components/admin/nav-user.tsx`.
- A form's first submit button is what Enter triggers. Multi-button forms put a hidden "keep current status" button first (`poem-form.tsx`).
- In E2E tests, use `getByRole` (it skips hidden Activity routes). For password inputs, which have no role, use `getByLabel(…).filter({ visible: true })`. Plain `getByLabel`/`getByPlaceholder` can match a hidden copy of the page and fail in strict mode.
- Don't start function names with `use` unless they're hooks: the hooks lint rule flags them (hence `switchToPerPoemPasswords`).
- Lint forbids `setState` inside effects. Adjust state during render instead (the `seenState !== state` pattern in `poem-form.tsx` and `sign-in-form.tsx`).

**Editor dashboard** (`src/app/admin/(dashboard)/`, a route group with the sidebar-08 shell in its `layout.tsx`; onboarding sits outside it and shares `AuthShell` with `/sign-in`).
- `SidebarInset` renders the page's `<main>`; pages must not add another one. URL-aware pieces (`NavMain`, `AdminBreadcrumb`) render inside Suspense.
- Sign out lives in the account menu (`src/components/admin/nav-user.tsx`) and still does a full page load. In E2E use the `signOut()` / `accountButton()` helpers.
- Client components get dates preformatted by the server (`updatedLabel`) to avoid hydration mismatches across time zones.
- Don't use `Math.random()` in client components (Cache Components prerender error); `SidebarMenuSkeleton` was patched to a fixed width.
- Avatars: ids in `src/lib/avatars.ts` are stored in `editors.avatar`. Never reorder or remove them; append only. SVGs come only from `renderAvatarSvg` (server) via `/avatars/[id]`.
- Profile fields: validate in `updateProfile` (`profile.ts`). Links are https-only and normalised. A pinned poem must be the editor's own published poem (an editor-scoped query, like poems).

**Install nudge** (docs/PLAN.md Phase 15; look: `docs/mockups/install-prompt/`). Rules are pure in `src/lib/install-nudge.ts`; state lives in the module-level store `src/lib/install-store.ts` (read with `useSyncExternalStore`; actions are called from event handlers, never from render or effects); UI in `src/components/install/install-nudge.tsx`.
- `beforeinstallprompt` is caught by the inline `INSTALL_CAPTURE_SCRIPT` in the root layout's `<head>` (before hydration) and parked on `window.__inkboardInstallPrompt`. Keep that script static, and keep the constant in the pure module: a value imported from a `"use client"` module into a server component is a client reference, not the string.
- The card renders once (`InstallNudgeHost`, root layout) and is portalled into slots: `board-bottom` (in the board's bottom column with the zoom bar, so they can't overlap), `board-top` (under the toolbar from 640px, its tail pointing at the install button, which must stay the toolbar's **last** item), `editor` (dashboard). Don't position the card yourself; add a slot.
- No install button in the phone toolbar. Never show anything when running installed (display-mode or `navigator.standalone`) or after `appinstalled`.
- "First-ever publish" comes from the save transaction (`firstPublish` in `poems.ts`'s result), not from the client.
- E2E: simulate Chromium with a synthetic `beforeinstallprompt` dispatched on `DOMContentLoaded` from an init script, and seed `localStorage["inkboard-install"]` for a returning visit (guard it with "if not set", or reloads reset dismissals).
- **Manifest icons** are GET route handlers under `src/app/icons/` drawn by `appIconResponse` (`src/components/brand/app-icon.tsx`); they prerender. The maskable one is full-bleed with the glyph inside the 80% safe zone.

**Accessibility.** `e2e/a11y.spec.ts` runs axe (WCAG 2.2 A/AA) on every screen (light only). Add new screens or states there. Error text uses `--destructive`, tuned to ≥4.5:1 on paper and on its own tint, so check contrast if you change it. ARIA lets a listbox contain only options and groups, so put palette messages outside `CommandList`.

**SEO & sharing.** Site identity, brand hex colours and `siteUrl()` (APP_URL, else Vercel's production domain) live in `src/lib/site.ts`. Icons are file conventions in `src/app`: `icon.svg` (the Feather logo tile), `favicon.ico` (generated from it, 16/32/48), `apple-icon.tsx`; plus `manifest.ts`, `robots.ts`, `sitemap.ts` (board data, cached under BOARD_TAG).
- Share cards: `opengraph-image.tsx` at the root, per poem and per author, built from `src/components/brand/og-card.tsx`. Private poems show only title/author, never text (N1). Satori needs **static** fonts (`src/assets/fonts`), not variable ones.
- Never put a relative `alternates.canonical` or `openGraph.url` in the root layout: on the intercepted overlay route it resolves against the request path and fails the build. Pages set their own canonical.
- Next replaces a child's `openGraph`/`twitter` object instead of merging it, so spread `BASE_OPEN_GRAPH` and repeat `card: "summary_large_image"`.
- `/admin` and `/sign-in` are `noindex`. JSON-LD goes through `JsonLd` (`src/components/seo/json-ld.tsx`), which escapes `<`.

**Feeds** (Atom, `/feed.xml` and `/a/[author]/feed.xml`; docs/PLAN.md Phase 12). `src/lib/atom-feed.ts` builds the XML (pure), `src/server/feeds.ts` loads rows, `getSiteFeed`/`getAuthorFeed` in `board-cache.ts` cache them under BOARD_TAG.
- Same reader rules as the board: published only, pen name required, `CASE WHEN visibility = 'public'` for the body, never the email. A private entry gets `PRIVATE_ENTRY_TEXT` only.
- Poem HTML in a feed comes only from `poemToHtml` (escape first, then `<em>`/`<strong>`, `<br>`, `&#160;`). Don't add other tags or pass raw text through.
- Entry ids are `urn:uuid:<poem id>`: feed readers dedupe on them, so never change the scheme.
- Visible links: `SubscribeButton` (`src/components/feeds/`, board toolbar and list view, a Popover) and `AuthorFeedLink` (author page, reading page). Feed links are plain `<a type="application/atom+xml">`, never `next/link`. The copied URL is absolute and is resolved on the server (`page.tsx` passes `feedUrl`): the client has no `APP_URL`.
- The board toolbar must stay at most two rows from 320px up (`e2e/board-language.spec.ts` checks it). Phone icon buttons are square (`max-sm:w-7 max-sm:px-0`), and below 360px "Sign in" is icon-only too. Measure before adding anything else to it.
- Pages advertise feeds with `...feedAlternates(author?)` inside their own `alternates` (Next replaces, not merges, a parent's `alternates`). Keep feeds out of `/api/`, which robots.txt blocks.

**Security headers** (`next.config.ts`): a static CSP without nonces, because nonces would disable prerendering. Only our own origin is allowed, so adding any third-party script, font, image or API means editing `csp` there. HSTS is sent in production only.

**Analytics:** Vercel Web Analytics via `src/components/analytics.tsx` (root layout), production builds only. Its `beforeSend` strips query and fragment from every URL: the sign-in link token is in the fragment, so keep that if you touch it.

**Cleanup cron:** `GET /api/cron/cleanup` (`vercel.json`, daily) calls `cleanupExpiredRows()` in `src/server/maintenance.ts`. It needs `Authorization: Bearer $CRON_SECRET`. Deployment steps are in `docs/DEPLOY.md`.

**Rate limiting** (`src/server/rate-limit.ts`) is a single atomic Postgres upsert per call into `rate_limits` (fixed window). Keys look like `otp:req:email:<sha256>`, `otp:cooldown:<sha256>`, `otp:req:ip:<ip>`, `otp:verify:email-ip:{h,d}:<sha256>:<bucket>`, `otp:verify:email:{h,d}:<sha256>`. Verify limits are checked in tiers (IP → email+client → email): a client over its own budget must never count against the shared per-email cap, or one client could lock an editor out. About 1% of calls also prune rows older than 2 days. Tests clear rows by key prefix to skip cooldowns.

**Database.** Drizzle schema in `src/db/schema.ts`, SQL migrations in `drizzle/`. Always generate migrations, never hand-edit applied ones. `getDb()` (`src/db/index.ts`) picks `@neondatabase/serverless` (WebSocket pool, supports transactions) when the `DATABASE_URL` host is `*.neon.tech`, and `pg` otherwise. Both are typed as a generic `PgDatabase`, so raw `db.execute()` results must be cast to `{ rows: … }`. Private poems must be readable with some password: see the password-mode triggers above. `password_version` exists so that unlock cookies can be revoked when the password changes.

**Env** is validated lazily with zod via `env()` in `src/env.ts`, so the build doesn't need secrets. `resetEnvCache()` lets tests change env. Emails are always really sent through Resend, locally too: `RESEND_API_KEY` is required everywhere and codes are never printed. The only exceptions are Vitest (`NODE_ENV=test`, email module mocked) and the E2E server (no key + `E2E_OTP_OUTBOX`, never production), which appends emails to that file for Playwright.

**Tests.** `vitest.config.mts` aliases `server-only` to an empty module, mocks `@/server/email` into `tests/support/outbox.ts` (`lastCodeFor(email)`), truncates all tables before each test, and runs files serially against the shared DB. Integration tests exercise real SQL, including concurrency (`Promise.all`) for races.

**Ghanaian languages and IPA** (docs/PLAN.md Phase 11; Ewe, Twi/Akan, Nzema, Ga). `src/lib/letters.ts` holds `toNfc` (all user text is NFC-normalised on save and in search queries), `transliterate` (slugs: Ɔdɔ → `odo`, Ŋ → `ng`) and `SEARCH_FOLD`, which must match `search_normalize()` in the latest search migration (a test checks).
- Fonts: Newsreader/Geist lack Ɛ ɛ Ɔ ɔ Ɖ ɖ Ƒ Ɣ ɣ Ʋ ʋ Ʒ ʒ and IPA, so SIL's Gentium Book Plus (serif) and Andika (sans) supply them. They are **self-hosted subsets** in `src/assets/fonts/web` (no basic Latin, with a `unicode-range`, not preloaded): Google Fonts' copies drop the IPA Extensions block, where the lowercase ɛ ɔ ɖ ɣ ʋ ʒ live.
- The stacks are built in `layout.tsx` (`fontStack`) as main font → extension font → next/font's metric fallback. With the fallback before the extension font (next/font's default), Times New Roman/Arial answered for those letters (measured with Chrome's CSS.getPlatformFontsForNode). Keep that order.
- Only list `latin` in Google font `subsets`: every listed subset is preloaded on every page; the others are still declared and load on demand.
- Share cards: Satori gets static `GentiumBookPlus-*.ttf` after Newsreader (`og-fonts.ts`).
- `searchWords` keeps combining marks (`\p{M}`) inside words: Ewe tones on ɛ/ɔ have no precomposed form.
- Ƒ ƒ come from Gentium/Andika even though Newsreader/Geist have them (they draw the slanted florin sign): a tiny `U+0191-0192` face is first in each stack.
- **Special letters bar** (`src/components/special-letters.tsx`, data and IPA search in `src/lib/letter-sets.ts`): tabs Akan (covers Twi, Fante, Nzema), Ewe, Ga, IPA; tone marks on Ewe and Ga only. Pass the ids of the fields it types into (`fields`, last one used wins); it's on the poem editor (body, title), profile (bio, pen name) and onboarding (pen name). Inserts go through `execCommand("insertText")` (undo, maxLength, React onChange); keys cancel mousedown so the field keeps its cursor. E2E: `e2e/special-letters.spec.ts`.
- **Poem language** (`poems.language`, list in `src/lib/poem-languages.ts`, BCP 47 tags): optional, set in the editor. Readers get a label and `lang` on the poem's title/excerpt/text only, never on surrounding UI (a private poem's unlock form must stay English). `PoemCardFace` takes `lang`; JSON-LD carries `inLanguage`. E2E: `e2e/poem-language.spec.ts`.

**UI/theme.** Tailwind v4 is configured via CSS (`src/app/globals.css`) with a custom "paper & ink" palette (**light only**: there is no dark theme; the class-based `dark` variant is kept only so shadcn's `dark:` classes never follow the OS setting), and extra `--canvas`/`--canvas-dot` tokens for the board. Fonts: Geist (`font-sans`) for UI and Newsreader (`font-serif`, also `font-heading`) for poem titles and text, each followed by an SIL font for Ghanaian letters and IPA (see above).
