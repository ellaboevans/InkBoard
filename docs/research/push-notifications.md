# Push notifications for new poems: research

Status: research + throwaway prototype (Nov 2026). Not a phase in `docs/PLAN.md` yet. The prototype's code (files marked PUSH PROTOTYPE) is kept on the local branch `research/push-prototype`, not on `main`. Sources are numbered **[n]** and listed with their dates at the end. Where a claim rests on my own measurement in this repo, it says so (§6).

## 1. The answer

**Yes, on every platform the owner cares about, with one big condition on iPhone.** Standard Web Push (Push API + a service worker + VAPID) [2] works in Chrome, Edge, Firefox and Samsung Internet on Android and the desktop, and in Safari on macOS, without installing anything. On iPhone and iPad it works **only after the reader has added InkBoard to the Home Screen** and opened it from there (iOS/iPadOS 16.4+), whichever browser they used to add it. It costs nothing per message (the browsers' push services are free), needs no third-party service or script, fits the existing hand-written `/sw.js` without touching the offline rules, and the core path is proven on this Mac with a real push through Google's push service (§6).

### 1.1 Support matrix

"Tab" = a normal browser tab; "installed" = the installed web app (Home Screen / Dock / "Install app"). Versions are the first with the Push API, from MDN's compatibility data [1] unless noted.

| Platform | Tab | Installed | Since | Permission prompt | App/browser closed | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| **Android, Chrome** | ✅ | ✅ | Chrome 42 (2015) | No hard gesture rule, but Chrome shows a "quieter" prompt to people who usually block, and to sites with low opt-in [17]; ask on a click anyway [16] | ✅ the OS wakes the browser, which wakes the worker [14] | Push goes via FCM. Auto-revocation of unused sites' permission spares installed apps [18]. |
| **Android, Samsung Internet** | ✅ | ✅ | 4.0 (Chromium 44, 2016) [1] | as Chrome | ✅ (Chromium; inferred) | Same FCM path as Chrome. |
| **Android, Firefox** | ✅ | ✅ (Firefox's "Add to Home screen"/install) | Firefox for Android 48 [1] | Needs a user gesture (since 79) [1] | ✅ (inferred: Firefox's push service bridges through FCM on Android [21]) | Payloads through the FCM bridge may be limited to 2744 bytes [21]: keep payloads tiny (ours: ~130 bytes). |
| **Android, Edge** | likely ✅ | likely ✅ | **unconfirmed**: MDN doesn't track Edge for Android | – | – | Chromium-based; test on a device before promising it. |
| **iPhone/iPad, Safari** | ❌ (`Notification` is undefined in a tab) [1] | ✅ Home Screen web app only | iOS/iPadOS 16.4 (Mar 2023) [4] | Must come from a tap ("in response to direct user interaction") [4] | ✅ delivered by the OS via APNs | Shows "on the Lock Screen, in Notification Center, and on a paired Apple Watch" [4]. Every push must show a notification or the subscription is removed (§2.3). |
| **iPhone/iPad, Chrome / Edge / Firefox** | ❌ | ✅ once added to the Home Screen *from that browser* | iOS 16.4 [4] (Chrome for iOS added "Add to Home Screen" in 2023; Firefox/Edge: unconfirmed) | as Safari | as Safari | "This is true no matter which browser added the website to the Home Screen" [4]: it's a WebKit web app either way. |
| **iOS 26 note** | | | | | | Any site added to the Home Screen now opens as a web app by default [9]. InkBoard already has a `display: standalone` manifest, so nothing changes for us. |
| **EU (DMA)** | | | | | | Apple briefly removed Home Screen web apps in the EU in the iOS 17.4 betas, then reversed that before release (Mar 2024) [36]. They work in the EU today. |
| **Desktop Chrome / Edge** | ✅ | ✅ | Chrome 42, Edge 17 [1] | as Android | ❌ "The only time a push won't be received is when the browser is completely closed" [14]; queued by the push service up to the TTL and delivered when it starts | Edge on Windows uses Microsoft's WNS push service [22]. |
| **Desktop Firefox** | ✅ | (no install) | Firefox 44 [1] | Needs a user gesture since Firefox 72 [13] | ❌ needs Firefox running (it holds a connection to Mozilla's push service; inferred) | |
| **macOS Safari** | ✅ (Safari 16.1+, macOS 13+) [7][11] | ✅ "Add to Dock" apps (Safari 17+) [5] | Safari 16 on macOS Ventura [1] | Must come from a click [3] | ✅ "Safari doesn't even need to be running" [3] | A Dock app is a separate subscription from Safari [5]. |

Lock screen: on iOS, notifications show on the Lock Screen [4]. On Android, web notifications are ordinary Android notifications and follow the phone's lock-screen settings (I found no primary source that says so explicitly; check on a device). Notification **actions** and **images** are not supported in Safari [1], so don't design around them. The **app badge** (`setAppBadge`) works for iOS Home Screen apps and macOS Dock apps, not on Chrome for Android [1][4].

## 2. What it takes (platform side)

### 2.1 The pieces

1. **A service worker with a `push` handler** that shows a notification, and a `notificationclick` handler that opens the poem. We already have the worker (§3.1).
2. **A subscription per device**: the page calls `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })` after `Notification.requestPermission()`, then posts the resulting `PushSubscription` to our server (§3.3–3.4).
3. **VAPID keys** (RFC 8292 [23c]): one P-256 key pair for the site. The public key goes to the browser as `applicationServerKey`, so subscriptions are bound to it. The server signs a short JWT (ES256, `exp` ≤ 24 h, `sub` = a contact `mailto:` or `https:` URI) on every push. Generate once (`npx web-push generate-vapid-keys`), keep the private key in Vercel's env as a secret. **Rotating the key invalidates every subscription**, so plan for re-subscribing (§7.2).
4. **Payload encryption** (RFC 8291 [23b], aes128gcm per RFC 8188 [23d]) with the subscription's `p256dh`/`auth` keys. Push services only see ciphertext. A push service must accept 4096 bytes of body, which is at most 3993 bytes of plaintext [23b]; I confirmed both numbers against FCM (§6).
5. **A server library** to do 3 and 4 and POST to the endpoint (§2.2).

### 2.2 Server library

**`web-push`** (github.com/web-push-libs/web-push) [25]: MPL-2.0, maintained under the web-push-libs org (npm maintainer from Mozilla), ~14 million weekly downloads. It's the reference Node implementation: VAPID, encryption, TTL/Urgency/Topic headers, and it returns the push service's status code.
- **4.0.0 came out on 2026-11-06** (the previous release, 3.6.7, was 2024-01-16). 4.0 is ESM-only (`"type": "module"`, checked with `npm view`) and needs Node ≥ 16. It uses `node:crypto`/`node:https`, so it runs in Vercel's Node functions (our only runtime) but not on the Edge runtime.
- The prototype uses **3.6.7** (CommonJS) because 4.0.0 was only 10 days old. For production, move to 4.x once it has been out a few weeks; the API is the same.
- MPL-2.0 is file-level copyleft. Using the package unmodified as a dependency puts no obligation on our code.

Alternatives if we ever needed an Edge/WebCrypto runtime [25]: `@pushforge/builder` (MIT, 2.0.5, 2026-04-23, zero dependencies) and `@block65/webcrypto-web-push` (MIT, 2.0.0, 2026-09-03). We don't need them.

### 2.3 Platform rules that shape the design

- **Every push must show a notification.**
  - Chrome only allows `userVisibleOnly: true` subscriptions [15]. If the worker doesn't show a notification, Chrome shows a generic one itself.
  - Safari removes *all* of the site's subscriptions after **3** pushes that didn't show a notification. That's `maxSilentPushCount = 3` in WebKit's `WebPushDaemonConstants.h` [12], which I checked in the source myself, and Apple's docs say the same in words [11].
  - So: no silent "sync" pushes, and the handler must call `showNotification` even if the payload is broken. The prototype falls back to "A new poem on InkBoard".
- **Ask only on a click.** Safari [3][4] and Firefox [13] refuse otherwise, and Chrome's guidance is "Never ask on page load or without user interaction" [16].
- **Chrome punishes noisy sites.**
  - Auto-revocation removes the permission from sites with "very low user engagement and a high volume of notifications"; it "does not revoke notifications for any installed web apps" [18].
  - FCM caps "disruptive domains" at **1,000 messages per minute**, answering HTTP 429 [19].
  - Low volume and relevant content (one notification per new poem, per followed author) keeps us clear.
- **Declarative Web Push** (Safari 18.4 on iOS, 18.5 on macOS) [6][7][8]. A push body of `{"web_push": 8030, "notification": {"title": …, "navigate": "/p/…"}}` is shown by Safari itself, without waking the worker. Browsers without it hand the same push to the worker's `push` handler, which can show its own notification [6].
  - It's now in the W3C Push API draft [24]. Firefox 158 supports the `navigate` option [35]; Chrome doesn't yet.
  - It's a cheap later improvement: more reliable on iOS, no worker start-up. Not needed for a first version.
- **Topic / TTL / Urgency headers** (RFC 8030 [23a]).
  - `Topic` replaces a not-yet-delivered message with the same topic. Use one per author so a phone that was off gets one notification, not eight.
  - `TTL` sets how long the push service keeps an undelivered message. Use a day: news of a poem doesn't need to arrive a week late. Apple keeps messages at most 30 days, Mozilla up to 30 days as well [11][21].
  - `Urgency: normal` (Android may delay `low` pushes on battery saver).

### 2.4 Subscription lifetime

- `expirationTime` is in the spec and supported widely [33], but every subscription in the prototype had `null`.
- **`pushsubscriptionchange`** (the worker is told about a new endpoint) is unevenly supported [1]:
  - Firefox fires it, but without `oldSubscription`/`newSubscription`.
  - Chrome 138+ fires it only after permission is granted again [34].
  - Safari on iOS: **no**.
- So the server must treat **404/410 as "delete"** (RFC 8030: "MUST return a 404… to an expired push message subscription" [23a]; Apple: 410 "The device token has expired" [11]).
- The page should also **re-send its current subscription on each visit** (cheap upsert), so the server picks up silent changes. The prototype demonstrates the 410 path (§6).

### 2.5 Tapping the notification

- `notificationclick` → `clients.openWindow(url)` or focus/navigate an open window.
- `openWindow` is only allowed with transient activation, which the real click on the notification provides [32]. I confirmed the flip side here: a *synthetic* click event is refused by Chrome ("Not allowed to focus a window", §6).
- On Android and Windows, Chrome may open the URL in the installed app's window [32].
- iOS has had bugs here, most fixed: WebKit 259212 resolved Sep 2023, 252544 fixed Aug 2024, while 279456 ("`openWindow` resolving too early") is still open [39]. **Test the tap on a real iPhone** before shipping.
- With the prototype's "save on push", the poem opens **even offline**, because the push handler stores the poem page under the offline rules before the reader taps (§6).


## 3. How it fits this codebase

### 3.1 Service worker: `push` and `notificationclick` next to the offline rules

The worker in `src/lib/offline/worker.ts` (served by `src/app/sw.js/route.ts`, scope `/`) only listens to `fetch`, `message`, `install` and `activate`. Push adds three listeners that never touch `fetch`, so the offline strategies in `rules.ts` are unchanged:

- **`push`**: parse `{ title, author, url, tag }`, call `registration.showNotification(...)` inside `event.waitUntil` (every push must show a notification; see §2.3), and, in parallel, `saveCopy(url)`, the worker's existing "save a cookie-less copy under the storage rules" function. A public poem is then readable offline when the notification is tapped; a private poem's page says `content="never"` and is dropped, exactly as for a normal visit. The prototype does this (§6).
- **`notificationclick`**: close the notification, then focus a window already on that URL, else focus an InkBoard window and `navigate()` it, else `clients.openWindow(url)`. The URL is always our own `/p/<author>/<poem>`; the worker rejects anything that doesn't start with `/p/`.
- **`pushsubscriptionchange`**: re-subscribe with the old options and tell the server (new endpoint in, old endpoint out). Only Firefox fires it in practice (§2.4); Chrome and Safari rely on the server's 404/410 cleanup instead.

Two existing rules matter:

- **The worker is production-only** (`ServiceWorkerRegistration` unregisters it under `next dev`). Push therefore can't be tried in `next dev`; test it against `next build && next start`, like the offline E2E (`playwright.offline.config.ts`). The prototype harness does the same.
- **Each deploy is a new worker** (`INKBOARD_BUILD_ID`). Push subscriptions belong to the *registration* (scope `/`), not to a worker version, so they survive deploys. They only break if the registration is unregistered or the scope changes, so **never change `/sw.js`'s URL or scope** once push ships.

### 3.2 Where sending starts

`createPoem`/`updatePoem` in `src/server/poems.ts` already return `publishedNow`: true on a poem's *first* publish only. `publishedAt` is set with `COALESCE(published_at, now())` and is never cleared, so unpublishing and republishing doesn't notify again. Both actions in `src/app/admin/(dashboard)/poems/actions.ts` funnel first publishes through `toListAfterPublish`. That is the one hook:

```ts
after(() => sendNewPoemPush(poemId)); // runs after the redirect is sent
```

Next's own docs (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md`): "`after` will be executed even if the response didn't complete successfully. Including when an error is thrown or when `notFound` or `redirect` is called", and it runs "for the platform's default or configured max duration of your route". It's the same pattern as the OTP emails (`after()` in the sign-in action).

Things the production version must decide here:

- **Delay before sending.** An editor who publishes by mistake and unpublishes within a minute shouldn't have notified everyone. Recommendation: enqueue on first publish, send 5–10 minutes later from a job (§4.3), and re-check `status = 'published'` at send time. The prototype sends at once.
- **Collections.** Publishing 8 poems of a collection in one sitting should be one notification ("Ama Owusu published 8 new poems"), not eight (§5.5).
- **Deleted accounts.** `deleteAccount` must also delete queued notifications for the editor's poems (an FK to `poems` with `ON DELETE CASCADE` does it).

### 3.3 Storing subscriptions

A subscription (`PushSubscription.toJSON()`) is:

```json
{ "endpoint": "https://fcm.googleapis.com/fcm/send/dP58-HKhsxk:APA91bEoVcly…",
  "expirationTime": null,
  "keys": { "p256dh": "<65-byte P-256 public key, base64url>", "auth": "<16-byte secret, base64url>" } }
```

The endpoint is a capability URL at the browser vendor's push service: whoever has it plus the keys can push to that device (with *our* VAPID key only, since the subscription is bound to our `applicationServerKey`). In the prototype, `expirationTime` was `null` for every subscription.

Proposed table (a real Drizzle migration; the prototype creates `push_prototype_subscriptions` at runtime instead, to stay deletable):

| column | notes |
| --- | --- |
| `id` uuid PK | |
| `endpoint` text UNIQUE | validated: `https:`, ≤ 1000 chars, host on an allowlist of known push services (§7.3) |
| `p256dh`, `auth` text | base64url, length-checked |
| `scope` | `all` or a set of followed authors (§5.2); simplest: a `push_follows (subscription_id, editor_id)` table, both FKs `ON DELETE CASCADE` |
| `created_at`, `last_success_at`, `failure_count` | for cleanup |
| `user_agent_family` (optional) | "Chrome on Android" etc., for an aggregate count only; no full UA, no IP |

Cleanup rules:
- **404 or 410 from the push service → delete the row at once.** Seen here: FCM answered 410 for a subscription the browser had unsubscribed, and the prototype deleted it (§6).
- **429 or 5xx → keep it, retry later** with backoff (respect `Retry-After`).
- **400/403/413 → a bug on our side** (bad JWT, payload too big): log and alert, don't delete.
- A daily sweep in the existing cleanup cron (`cleanupExpiredRows`) deletes rows with no success in 60 days and several failures.

`push_follows` references `editors`, so the account-deletion schema walk in `tests/account/deletion.test.ts` needs a fixture row for it (CLAUDE.md, "Your data"). The subscription itself is the *reader's* data, not the editor's, and survives an author's deletion.

### 3.4 Subscribing and unsubscribing

- A route handler, like `POST /sign-in/passkey/options`: `POST /api/push/subscriptions` and `DELETE` (Origin check, JSON body). Not a Server Action: the board is prerendered and this runs from a click on any reader page; a route handler also keeps it out of the Server Action/flash-param interplay CLAUDE.md warns about.
- `/api/*` is already "passthrough" in the worker and blocked in `robots.txt`.
- The VAPID **public** key can be inlined at build time (`NEXT_PUBLIC_VAPID_PUBLIC_KEY`) or served by `GET`; the private key stays a server-only env var (`src/env.ts`, optional, like `CRON_SECRET`).

## 4. Cost and limits

### 4.1 Push services: free

- FCM (Chrome, Samsung Internet, Chromium browsers, and Firefox on Android through its bridge) is "No-cost" [20].
- Apple's web push needs no paid developer account: "You don't need to join the Apple Developer Program" [11].
- Mozilla's autopush and Microsoft's WNS publish no price lists for web push. They are free in practice (millions of sites use them through `web-push`), but I found no page that states it as pricing.
- **No paid third party is needed.**

### 4.2 Our side: Vercel and Neon

- **Measured on this Mac:**
  - Sending 25 pushes concurrently to FCM took **0.97 s** wall time (each request about 0.9 s, all 201).
  - The real publish → push → notification path took about **1 s** end to end (§6).
  - The work is almost all waiting on the network.
- **Vercel functions:** with Fluid Compute, Hobby and Pro both default to a **300 s** maximum (Pro can raise it to 800 s) [26]. `after()` / `waitUntil` get "the same timeout as the function itself" [27][38].
  - In batches of 50 concurrent requests, a 300 s budget covers roughly **10,000 subscriptions** (extrapolated from the measurement above, on a different network). That's far beyond what InkBoard needs.
- **Neon free tier:** 1 GB storage per project, 100 CU-hours a month, 105 usable connections at 0.25 CU [30].
  - A stored subscription is **356 bytes** (endpoint 188 chars, `p256dh` 87, `auth` 22; measured with `pg_column_size`), so 10,000 devices are about 4 MB.
  - A send is one `SELECT` plus a batched `UPDATE`/`DELETE`, which costs negligible compute.
- **Cron:** Vercel Hobby cron runs at most **once a day** with ±59 min precision, and hourly schedules fail to deploy; Pro allows every minute [28].
  - So a "send 10 minutes later" delay or a digest can't be driven by cron on Hobby.
  - Options: `after()` at publish time (works on any plan), Vercel Queues (beta on all plans, the first 1,000,000 operations included on Hobby [29]), or Pro cron.
- **FCM's 1,000 messages per minute cap** applies only to sites Google rates as "disruptive" [19]. If it ever bit, the 429 carries `Retry-After`, and a queue absorbs it.

### 4.3 Sending strategy by scale

| Subscribers | How |
| --- | --- |
| up to a few thousand (InkBoard today) | `after()` from the publish action, batches of 50, per-author throttle (§5.5). No new infrastructure. (The prototype does the `after()` + batches part, not the throttle.) |
| 5,000–50,000 | A `push_jobs` table: the action inserts one job; a worker (Vercel Queues consumer, or Pro cron each minute) sends in chunks of ~2,000 per invocation and records progress. Retries 429/5xx with backoff. |
| more | Same, with several consumers. Still no third party needed. |

## 5. Product and UX

### 5.1 Who can subscribe

- **Readers, per device, with no account.** A subscription is a device + browser (+ installed app), not a person.
- Editors can subscribe too, the same way; nothing ties it to their editor account. Keep it that way: a notification about *your own* poem would be odd, and linking devices to editors adds personal data (§7.1).

### 5.2 What they subscribe to

- **Phase 1: "New poems on InkBoard"** (everything). That's simplest, and the volume on a small poetry board is low.
- **Phase 2: follow authors.**
  - "Notify me when Ama Owusu publishes" on the author page `/a/[author]` and the reading page, next to the existing `AuthorFeedLink`.
  - The board already groups by author and has per-author Atom feeds, so the mental model ("follow this author") exists.
  - Store it as `push_follows(subscription_id, editor_id)`.
  - The "everything" switch and per-author follows can coexist: everything = no rows plus a flag.

### 5.3 When to ask

- **Never on load.** Always from a button, and explain first ("Get a notification on this phone when a new poem is published").
- **Entry points:**
  - **The existing Subscribe popover** (`SubscribeButton`, board toolbar and list view). It's already "how to follow InkBoard" (feeds). Add "Notifications on this device", which adds nothing to the toolbar's two-row budget.
  - **The author page** for follows (phase 2).
  - **The install flow:** after `appinstalled`, or when running installed, the install card can offer "Get notified about new poems".
- **On iPhone, in a Safari tab**, the button can't work. Show "Add InkBoard to your Home Screen to get notifications" and reuse the install nudge's iOS steps (`src/lib/install-nudge.ts` already detects iOS and standalone mode).
- **If permission is `denied`**, say how to re-enable it in the browser settings; we can't re-prompt.

### 5.4 What the notification says

- **Title:** the poem's title. **Body:** "New poem by Ama Owusu". **Icon:** `/icons/192.png`.
- **Tag:** per author (see 5.5), so they replace each other instead of piling up.
- **Data:** `{ url: "/p/<author>/<poem>" }`.
- **Never the poem's text, for any poem.**
  - A private poem's text must not leak (N1). Its title is already public on the board, so title + author is fine.
  - A public poem's first line is tempting, but the payload limit is 4 KB, notifications get truncated, and a single rule ("never text") is easier to keep. The prototype's payload builder doesn't select `body` at all.
- **Language:** a poem in Ewe or Twi keeps its title as written. The notification uses the OS font, which on iOS and Android covers Ɛ ɔ ŋ and tone marks. Worth a glance on a device.

### 5.5 How often (not spamming)

- **First publish only** (`publishedNow`; republishing after unpublishing doesn't count, §3.2).
- **Per-author throttle:** at most one push per author per hour per subscription, using the existing `rateLimit()` with a key like `push:author:<editorId>`.
  - Later poems within the window merge on the device: the worker finds the shown notification with the same author tag via `getNotifications({ tag })` and replaces it with "Ama Owusu published 3 new poems", opening the author page.
  - The `Topic` header does the same for phones that were offline.
- **Phase 3 option:** a short delay (5–10 min) before sending, so mistaken publishes can be unpublished and collection drops arrive as one notification. Needs a job runner (§4.3).

### 5.6 Unsubscribing, settings, tapping

- **"Stop notifications"** in the same popover: `subscription.unsubscribe()` plus `DELETE` on the server.
- **Phase 2:** a small "Notifications" panel listing followed authors, with remove buttons. It's per device and stored server-side by endpoint; the page finds its endpoint with `pushManager.getSubscription()`.
- **OS-level:** revoking permission in the browser or OS settings kills the subscription; the next push gets 404/410 and we delete the row.
- **Tap:** opens the poem (in the installed app if it's open or installed, otherwise a tab). Offline: the poem was saved when the push arrived, so it opens offline too; a private poem opens its unlock form, which needs a connection.

## 6. Proof of concept (what was actually tested here)

### 6.1 What was built (throwaway)

Every file is marked `PUSH PROTOTYPE`, so `git grep -l "PUSH PROTOTYPE"` lists them all:

| File | What |
| --- | --- |
| `src/server/push-prototype.ts` | validates and stores subscriptions (table created at runtime, no migration), `sendNewPoemPush(poemId)` with `web-push` 3.6.7: title + author + URL only, TTL 1 day, `Topic`, batches of 50, deletes on 404/410, logs every status code |
| `src/app/api/push-prototype/route.ts` | `GET` public key, `POST` subscription (Origin check, shape validation), `DELETE` |
| `src/components/push-prototype/notify-button.tsx`, `src/app/push-prototype/page.tsx` | the "Notify me about new poems" / "Stop notifications" buttons on `/push-prototype` |
| `src/lib/offline/worker.ts` (block at the end) | `push` (show the notification + save the poem for offline), `notificationclick`, `pushsubscriptionchange` |
| `src/app/admin/(dashboard)/poems/actions.ts` | `after(() => sendNewPoemPush(poemId))` in `toListAfterPublish` (first publishes only) |
| `scripts/push-prototype/fixtures.ts`, `verify.ts` | the harness: fixtures, then real Chrome driven over CDP |
| `package.json` | `web-push@3.6.7`, `@types/web-push` |

VAPID keys live in `.env.local` only (`PUSH_PROTO_VAPID_*`, gitignored). Without them every prototype function is a no-op.

### 6.2 How it was run

- A production build (`NEXT_DIST_DIR=.next-push`, `next start` on port 3172) against its own database `poemhub_e2e_elm_push`. The service worker only registers in production builds.
- The **existing CSP**, unchanged.
- Placeholder Resend key: no email was sent.
- The harness starts the installed **Google Chrome** with a fresh profile and drives it over CDP.
  - It grants the notification permission via CDP, so the permission *prompt* itself wasn't exercised.
  - It clicks the button and publishes through the real editor form (signed in with a fixture session cookie).

### 6.3 Results (the final run's log, trimmed)

```
service worker active: http://localhost:3172/sw.js
button status: subscribed — Subscribed via fcm.googleapis.com.
subscription: endpoint host fcm.googleapis.com, expirationTime null, keys p256dh+auth
  (then: unsubscribed in the browser only, and subscribed again → the server holds a stale + a live subscription)
published "Night Market" → /admin?published=c0560372-…
sw console: [push-prototype] push event {"title":"Night Market","author":"Ama Owusu","url":"/p/ama-owusu/night-market","tag":"poem:c0560372-…"}
server: [push-prototype] fcm.googleapis.com → 410        ← the stale one: deleted
server: [push-prototype] fcm.googleapis.com → 201        ← the live one: accepted by Google's push service
server: [push-prototype] poem c0560372-…: 2 subscription(s) in 936 ms
server has after send [{"endpoint":"https://fcm.googleapis.com/fcm/send/dP58-HKhsxk:APA91bEoVcly…","last_status":201}]
notification shown by the service worker: {"title":"Night Market","body":"New poem by Ama Owusu","tag":"poem:c0560372-…","data":{"url":"/p/ama-owusu/night-market"}}
poem saved for offline reading by the push handler: /p/ama-owusu/night-market in inkboard-pages-push-proto-1
sw console: [push-prototype] notificationclick http://localhost:3172/p/ama-owusu/night-market
synthetic notificationclick: handler rejected: InvalidAccessError: Not allowed to focus a window.
offline: /p/ama-owusu/night-market → h1 "Night Market"
published "Locked Room" (private) → /admin?published=57848a6b-…
server: [push-prototype] fcm.googleapis.com → 201
private poem notification: {"title":"Locked Room","body":"New poem by Ama Owusu",…,"data":{"url":"/p/ama-owusu/locked-room"}}
private poem page in any cache: null
CDP deliverPushMessage → {"title":"Delivered by CDP","body":"New poem by Test","tag":"cdp",…}
```

**What this shows:**
1. **A real push through Google's push service (FCM) works end to end.**
   - The button subscribed at `fcm.googleapis.com` and the server stored it.
   - Publishing through the editor sent a push: FCM answered **201**, and Chrome received it from FCM.
   - The worker's `push` handler ran and the notification with the poem's title and author was shown (`registration.getNotifications()`), about **1 s** after the publish.
2. **Dead subscriptions are cleaned up.** A subscription the browser had dropped got **410** from FCM and was deleted.
3. **Private poems: title and author only.** The notification has no text, and the poem's page was **not** cached (the offline "never" rule still applies to pages saved from a push).
4. **Coexistence with offline reading.** The push handler saved the public poem through the offline rules, and the poem then opened **with the network off** (screenshot `3-offline-poem.png`).
5. **The CSP needs no change.** All of this ran under the existing `connect-src 'self'`.
6. CDP's `ServiceWorker.deliverPushMessage` drives the same handler without a push service. That's the right tool for a CI E2E test.

**Push services probed directly** (VAPID-signed requests to endpoints that don't exist; and payload sizes to the live FCM subscription):

```
apple    403 {"reason":"BadJwtToken"}     ← with sub = mailto:…@inkboard.invalid
         400 {"reason":"BadWebPushToken"} ← with sub = mailto:owner@example.com or https://example.com (JWT accepted; token fake)
         403 {"reason":"BadJwtToken"}     ← with sub = https://localhost
mozilla  404
google   410 push subscription has unsubscribed or expired.
microsoft 404
FCM, live subscription: 3993-byte payload → 201; 4200-byte payload → 400 "must be less than 4096 bytes"
burst of 25 to one live FCM subscription: 25 × 201; wall 969 ms
```

- **Apple rejects a VAPID subject on a reserved TLD (`.invalid`) or `localhost`**, which matches Apple's `BadJwtToken` description [11]. Production must use a real `mailto:` address or the site's `https://` URL.
- The prototype started with an `.invalid` address. FCM accepted it, but an iPhone would never have received anything. I switched it after this probe.

### 6.4 What went wrong along the way

- **Playwright's own Chrome launch never finished subscribing.** `pushManager.subscribe` hung past 30 s, both headless and headed.
  - Chrome started by hand with minimal flags subscribed in 31 s on a fresh profile (`chrome://gcm-internals`: connected, first check-in), then in ~6 s on later runs.
  - Playwright adds ~35 flags (`--disable-background-networking`, `--disable-component-update`, …). I didn't isolate whether those or my 30 s timeout were to blame.
  - The harness now launches Chrome itself and attaches over CDP. For CI, use `deliverPushMessage` instead of a real push service.
- **Clicking an OS notification can't be automated here.** CDP has no API for it, and macOS denied `screencapture` (no screen-recording permission), so there is no picture of the macOS banner.
  - A synthetic `notificationclick` ran the handler, which picked the right URL and went to focus the open InkBoard window. Chrome then refused, as the platform requires: only a real click grants window focus/open [32].
  - **The real tap is unverified.**

### 6.5 What I could not verify, and how the owner can

| Not verified | How to test it |
| --- | --- |
| A real tap on a notification (macOS, Android, iOS) | Run the prototype (below), publish, click the banner: the poem should open/focus. |
| Android phone (Chrome, Samsung Internet, Firefox) | Needs HTTPS: deploy the branch to a Vercel preview with the three `PUSH_PROTO_VAPID_*` env vars (preview protection off, or the worker can't fetch), or tunnel to `localhost:3172`. On the phone: open `/push-prototype`, Notify me, publish from a computer, lock the phone, watch the notification, tap. Also try with Chrome swiped away. |
| iPhone/iPad | Same HTTPS deploy. Safari → Share → Add to Home Screen → open from the icon → `/push-prototype` → Notify me → Allow. Publish, lock, tap. The VAPID subject must be a real mailto/https (it is now). |
| Firefox desktop, Safari macOS, Edge | Open `/push-prototype` on the HTTPS deploy in each; same steps. (`localhost` also works in Firefox and Safari.) |
| The permission prompt itself, and "denied" | Click Notify me in a fresh profile, choose Block: the page says notifications are blocked. |
| Delivery when the browser is closed, Do Not Disturb, battery saver | Device tests; expect desktop browsers to deliver on next start (up to the TTL). |
| Behaviour at thousands of subscribers | Only extrapolated (§4.2). |

**Re-running the prototype locally** (Node 22, from this worktree):

```bash
createdb poemhub_e2e_<name>
# env as in e2e-offline/server.ts (NODE_ENV=production, DATABASE_URL=…/poemhub_e2e_<name>, NEXT_DIST_DIR=.next-push,
# APP_URL=http://localhost:3172, placeholder RESEND_API_KEY and AUTH_SECRET), plus PUSH_PROTO_VAPID_* from .env.local
pnpm exec tsx --conditions=react-server scripts/push-prototype/fixtures.ts   # prints {"token": …}
pnpm exec next build && pnpm exec next start --port 3172
BASE=http://localhost:3172 TOKEN=<token> DATABASE_URL=… OUT=/tmp/push-run SERVER_LOG=<next start's log> HEADED=1 \
  pnpm exec tsx scripts/push-prototype/verify.ts
```

To remove the prototype: delete the files above, the block at the end of `worker.ts`, the two lines in `actions.ts`, the `PUSH_PROTO_*` lines in `.env.local`, `pnpm remove web-push @types/web-push`, and `DROP TABLE push_prototype_subscriptions` wherever it ran.

## 7. Privacy and security

### 7.1 Is a subscription personal data?

- **Treat it as personal data.**
  - The endpoint is a device-specific identifier that lets us reach one browser on one device: the "online identifiers provided by their devices" of GDPR Recital 30 [37].
  - The Push API spec deliberately keeps it from being a stable identifier: "The push endpoint MUST NOT expose information about the user", and a deactivated endpoint "MUST NOT be reused" [24].
  - I found no regulator guidance specifically on push endpoints.
- **What we'd store:** endpoint, two keys, created/last-success timestamps, failure count, followed author ids. **Not** IP addresses, user agents (at most a coarse "Chrome on Android" for counts), or any link to an editor or email.
- **Readers' consent:** they ask for it with a click, and the browser's prompt is the consent. Document it in a privacy note, and delete rows promptly on unsubscribe or 404/410.
- **What third parties see:** Google, Apple, Mozilla or Microsoft learn that a device receives pushes from InkBoard and when. They can't read the payload (end-to-end encrypted, RFC 8291 [23b]).
- **Lock screens:** title + author can show on a locked phone. That's acceptable because both are public on the board.

### 7.2 Secrets

- **The VAPID private key** goes in Vercel env as a sensitive variable, read only by server code (add it to `src/env.ts` as optional, like `CRON_SECRET`), never `NEXT_PUBLIC_*`, and never in the repo (the prototype keeps it in `.env.local`).
  - With the private key *and* the subscription table, someone could push to all our readers. Each alone is not enough.
- **Rotation** invalidates every subscription. The page should compare `subscription.options.applicationServerKey` with the current key on each visit and re-subscribe when they differ (no prompt is needed while permission stands).
- **The `auth` secret** in each subscription is what lets us encrypt to that device. Keep the table out of exports and logs.

### 7.3 Abuse

- **Flooding the subscribe endpoint.** Rate-limit `POST` by `ipBucket` (`push:subscribe:ip:<bucket>`, e.g. 20/hour) with the existing `rateLimit()`. Endpoints are UNIQUE, so repeats are upserts.
- **Our server as a request cannon (SSRF/amplification).** Without a check, anyone could register `https://victim.example/…` as an "endpoint" and our server would POST to it on every publish.
  - **Allowlist push-service hosts** (`fcm.googleapis.com`, `*.push.services.mozilla.com`, `*.push.apple.com`, `*.notify.windows.com`) and refuse anything else. The prototype only checks `https:` and sizes; the production version must add the allowlist.
  - Cap total rows per IP bucket per day.
- **Deleting someone else's subscription** requires knowing their endpoint, which is a capability URL [23a]. Acceptable.
- **Nobody else can push to our readers:** pushes need our VAPID private key.

### 7.4 CSP

**No change.** Verified in §6: subscribing, receiving and showing ran under the current `connect-src 'self'`.
- The browser talks to its push service itself; that traffic isn't subject to the page's CSP.
- The page only fetches our own `/api/…`, and the notification icon is our own `/icons/192.png`.
- `Permissions-Policy` in `next.config.ts` doesn't restrict notifications.

A third-party SDK (OneSignal, Firebase JS) *would* need CSP changes (§8).

## 8. Alternatives

| Option | Verdict |
| --- | --- |
| **Email** | Ruled out earlier for cost, and readers have no accounts or addresses. Push needs neither. |
| **Atom feeds** (exist: `/feed.xml`, `/a/[author]/feed.xml`) | Keep: free, private, no permission. But they need a feed reader, and most phones won't show a lock-screen alert. They complement push; they don't replace it. |
| **Firebase Cloud Messaging SDK** | Unnecessary. Chrome's standard Web Push *already* goes through FCM at no cost [20]; the Firebase JS SDK only adds a Google project, third-party scripts (CSP change) and its own worker conventions, and FCM topics don't reach Safari or Firefox. |
| **OneSignal and similar** | Free for unlimited web push subscribers (10,000 per send), $0.004 per subscriber on paid plans [31]. But it needs their script from `cdn.onesignal.com` and their service worker file [31]. That conflicts with our own-origin CSP and our hand-written `/sw.js` (one worker per scope; we'd have to merge theirs into ours). It also hands reader device data to another processor. It gives us dashboards and segmentation we don't need. |
| **Native apps** | Far more cost (stores, two codebases) for the same notification. |

## 9. Recommendation and phased plan

**Build it ourselves on standard Web Push with `web-push`, in our existing worker, with no third party.** Start with "all new poems", per device, and design the table for author follows from day one.

| Phase | Scope | Effort |
| --- | --- | --- |
| **A. New poems on this device** | Migration (`push_subscriptions`, later `push_follows`); `src/server/push.ts` (framework-free like `otp.ts`: validate with the host allowlist, upsert, delete, `sendNewPoemPush` with batching, 404/410 cleanup, 429/5xx backoff, per-author throttle); route handler with Origin check and IP rate limit; VAPID env in `src/env.ts`; the worker's `push`/`notificationclick`/`pushsubscriptionchange` handlers (from the prototype, plus tag merging); "Notifications on this device" in the Subscribe popover, with the iOS "add to Home Screen first" path and the denied state; `after()` hook in `toListAfterPublish`; cleanup cron sweep; deploy docs (keys per environment, never rotate casually). **Tests:** unit (payload builder never includes text; validation), integration (store/upsert/cleanup with a mocked `web-push`, throttle, private poems), production E2E via `deliverPushMessage` (`e2e-offline` style) for show + click routing + offline save, axe on the new UI. **Then device tests** on iPhone (Home Screen) and Android before announcing. | 5–7 days |
| **B. Follow authors** | `push_follows`, "Notify me when X publishes" on author and reading pages, a per-device settings list, fixture row in the deletion schema walk. | 2–3 days |
| **C. Polish** | Declarative Web Push payload (Safari 18.4+); delay/digest via Vercel Queues or a jobs table if mistaken publishes or collection drops become a problem; an install-card prompt "Get notified" after installing; a privacy note. | 2–4 days |
| **D. Scale (only if needed)** | Jobs table + queue consumer when subscribers pass a few thousand (§4.3). | 2 days |

### 9.1 Risks

- **iPhone reach** depends on readers installing the app, and many won't. Pair push with the install nudge, and keep feeds.
- **iOS tap routing** has had bugs [39]; test it on a device.
- **Platform policy drift:** Chrome's anti-spam rules tighten yearly [18][19]. Stay low-volume.
- **Key rotation and scope changes** silently break all subscriptions (§3.1, §7.2).
- **A mistaken publish notifies at once** until phase C adds a delay.

### 9.2 Open questions for the owner

1. Everything new, or straight to per-author follows? (I'd ship everything first; the board is small.)
2. Should editors be able to opt a poem *out* of notifying ("publish quietly"), e.g. for corrections or backfilling old poems? Cheap to add in phase A.
3. Is a short delay before sending (to allow undoing a publish) worth needing a job runner, or a Pro plan for minute crons?
4. Which contact goes in the VAPID `sub`: a real mailbox (`mailto:`) or the site URL? Apple rejects placeholders.
5. Do we want a privacy-page section on notifications before launch (recommended)?

## Sources

All accessed 2026-11-16. Dates are publication or last-updated dates. "Undated" pages are living docs read on that day.

1. MDN browser-compat-data, `api/PushManager.json`, `api/Notification.json`, `api/ServiceWorkerGlobalScope.json` (release 8.1.9, 2026-11-12). https://github.com/mdn/browser-compat-data
2. MDN, "Push API" overview (undated living doc). https://developer.mozilla.org/en-US/docs/Web/API/Push_API
3. WebKit blog, "Meet Web Push", 2022-06-07. https://webkit.org/blog/12945/meet-web-push/
4. WebKit blog, "Web Push for Web Apps on iOS and iPadOS", 2023-02-16. https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
5. WebKit blog, "WebKit Features in Safari 17.0", 2023-09-18. https://webkit.org/blog/14445/webkit-features-in-safari-17-0/
6. WebKit blog, "Meet Declarative Web Push", 2025-03-27. https://webkit.org/blog/16535/meet-declarative-web-push/
7. WebKit blog, "WebKit Features in Safari 18.4", 2025-03-31. https://webkit.org/blog/16574/webkit-features-in-safari-18-4/
8. WebKit blog, "WebKit Features in Safari 18.5", 2025-05-12. https://webkit.org/blog/16923/webkit-features-in-safari-18-5/
9. WebKit blog, "WebKit Features in Safari 26.0", 2025-09-15. https://webkit.org/blog/17333/webkit-features-in-safari-26-0/
10. WebKit blog, Safari 27.0 features, 2026-09-17 (no new push features). https://webkit.org/blog/18325/
11. Apple Developer, "Sending web push notifications in web apps and browsers" (undated). https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers
12. WebKit source, `Source/WebKit/Shared/WebPushDaemonConstants.h` (`maxSilentPushCount = 3`) and `Source/WebKit/webpushd/PushService.mm`, `main` branch, read 2026-11-16. https://github.com/WebKit/WebKit
13. MDN, "Firefox 72 for developers" (Firefox 72 released 2020-01-07). https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/72
14. web.dev, "Push notifications FAQ" (old but current guidance on delivery when the browser is closed). https://web.dev/articles/push-notifications-faq
15. web.dev, "Subscribing a user" (2016-06-30). https://web.dev/articles/push-notifications-subscribing-a-user
16. web.dev, "Permissions best practices for the web", 2024-06-17. https://web.dev/articles/permissions-best-practices
17. Chromium Blog, "Introducing quieter permission UI for notifications", 2020-01-07. https://blog.chromium.org/2020/01/introducing-quieter-permission-ui-for.html
18. Chromium Blog, "Reducing notification overload for a quieter browsing experience in Chrome", 2025-10-10. https://blog.chromium.org/2025/10/automatic-notification-permission.html
19. Google Blog, "The multi-layered defenses that harden Chrome against abusive notifications", 2026-08-11. https://blog.google/security/the-multi-layered-defenses-that-harden-chrome-against-abusive-notifications/
20. Firebase pricing (undated): "Cloud Messaging (FCM): No-cost". https://firebase.google.com/pricing
21. Mozilla autopush-rs documentation (undated): TTL range, 413/429, 2744-byte bridge limit. https://mozilla-services.github.io/autopush-rs/
22. Microsoft Edge policy "ForceBuiltInPushMessagingClient", updated 2026-11-03. https://learn.microsoft.com/en-us/deployedge/microsoft-edge-browser-policies/forcebuiltinpushmessagingclient
23. IETF RFCs: (a) RFC 8030 "Generic Event Delivery Using HTTP Push", Dec 2016, https://www.rfc-editor.org/rfc/rfc8030; (b) RFC 8291 "Message Encryption for Web Push", Nov 2017, https://www.rfc-editor.org/rfc/rfc8291; (c) RFC 8292 "VAPID", Nov 2017, https://www.rfc-editor.org/rfc/rfc8292; (d) RFC 8188 "Encrypted Content-Encoding for HTTP", Jun 2017, https://www.rfc-editor.org/rfc/rfc8188
24. W3C, Push API, Working Draft 2026-11-12. https://www.w3.org/TR/push-api/
25. npm registry: `web-push` (4.0.0 2026-11-06, 3.6.7 2024-01-16, MPL-2.0; checked with `npm view`), `@pushforge/builder`, `@block65/webcrypto-web-push`. https://www.npmjs.com/package/web-push
26. Vercel docs, "Configuring Maximum Duration for Vercel Functions", updated 2026-08-24. https://vercel.com/docs/functions/configuring-functions/duration
27. Vercel docs, "@vercel/functions" API reference (`waitUntil`), updated 2026-09-03. https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package
28. Vercel docs, "Cron jobs: usage and pricing", updated 2026-07-15. https://vercel.com/docs/cron-jobs/usage-and-pricing
29. Vercel docs, Queues (beta) pricing, updated 2026-08-12. https://vercel.com/docs/queues
30. Neon docs, "Neon plans", modified 2026-11-12, https://neon.com/docs/introduction/plans; "Connection pooling", modified 2026-11-14, https://neon.com/docs/connect/connection-pooling
31. OneSignal pricing (read 2026-11-16), https://onesignal.com/pricing; OneSignal Web SDK setup docs (undated), https://documentation.onesignal.com/docs/web-sdk-setup
32. MDN, `Clients.openWindow()`, modified 2026-09-12. https://developer.mozilla.org/en-US/docs/Web/API/Clients/openWindow
33. MDN, `PushSubscription.expirationTime`, modified 2024-04-22. https://developer.mozilla.org/en-US/docs/Web/API/PushSubscription/expirationTime
34. Chrome 138 `pushsubscriptionchange` on re-grant: blink-dev "Intent to Ship", 2025-04-17; Chrome 138 release notes. https://chromestatus.com/
35. MDN, "Firefox 158 release notes for developers", 2026-10-13. https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/158
36. Apple, "Update on apps distributed in the European Union" / DMA FAQ (reversal for Home Screen web apps, early Mar 2024; Wayback snapshot), and TechCrunch, "Apple reverses decision about blocking web apps on iPhones in the EU", 2024-03-01. https://techcrunch.com/2024/03/01/apple-reverses-decision-about-blocking-web-apps-on-iphones-in-the-eu/
37. GDPR, Regulation (EU) 2016/679, Art. 4(1) and Recital 30, 2016-04-27. https://eur-lex.europa.eu/eli/reg/2016/679/oj
38. Next.js 16.4.6 docs, `after` (in this repo: `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md`).
39. WebKit Bugzilla: 259212 (resolved Sep 2023), 252544 (fixed Aug 2024), 279456 (open, Oct 2024). https://bugs.webkit.org/
40. Chromium source, `components/push_messaging/push_messaging_constants.cc` (FCM endpoint prefixes, forced-notification tag), `main`. https://source.chromium.org/
41. Own measurements in this repo (§6): run log and probe output, 2026-11-16.
