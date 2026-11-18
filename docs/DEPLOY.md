# Deploying InkBoard (Neon + Vercel + Resend + Cloudflare R2)

A one-time setup, about 20 minutes. After it, every push to `main` deploys to production, and every pull request gets a preview deployment with its **own database branch**, so previews never touch production data.

## 1. Neon (database)

1. Create a project at <https://console.neon.tech>. Pick the region closest to your Vercel region.
2. Nothing else is needed in Neon. The migrations create everything, including the `pg_trgm` and `unaccent` extensions that search needs (both are supported on Neon).

## 2. Vercel (hosting)

1. Import the Git repository at <https://vercel.com/new>. The framework is detected as Next.js. `vercel.json` sets the build command to `pnpm db:migrate && pnpm build`, so you don't need to change anything there.
2. Add the **Neon integration**: Project → Storage → *Connect Database* → Neon, then pick the project from step 1.
   - Turn on **"Create a database branch for each preview deployment"**.
   - The integration sets `DATABASE_URL` (pooled, used by the app) and `DATABASE_URL_UNPOOLED` (direct, used for migrations) for each environment.
3. Add the remaining **Environment Variables** (Project → Settings → Environment Variables):

| Variable | Production | Preview | Notes |
| --- | --- | --- | --- |
| `AUTH_SECRET` | ✅ | ✅ (a different value) | `openssl rand -base64 48`. Rotating it signs everyone out and invalidates reader unlocks. |
| `RESEND_API_KEY` | ✅ | ✅ | Required everywhere (local development too); see section 3. |
| `EMAIL_FROM` | ✅ | ✅ | e.g. `InkBoard <login@yourdomain.com>`, on your verified domain. |
| `APP_URL` | ✅ `https://yourdomain.com` | optional | Used in sign-in emails. |
| `CRON_SECRET` | ✅ | optional | `openssl rand -base64 32`. Vercel Cron sends it to `/api/cron/cleanup`. |
| `TRUSTED_PROXY_HOPS` | `1` | `1` | Correct for Vercel. It's how the client IP is found for rate limits. |
| `EDITOR_ALLOWLIST` | empty | optional | Leave empty: anyone who verifies their email can be an editor. |

4. Deploy. The first build runs the migrations, then prerenders the (empty) board.
5. **Custom domain:** Project → Settings → Domains. The app sends `Strict-Transport-Security`, so serve it over HTTPS only.

### Cron
`vercel.json` schedules `/api/cron/cleanup` daily at 04:17 UTC. It deletes expired sign-in codes, expired sessions and stale rate-limit rows. It returns 503 until `CRON_SECRET` is set, and 401 for any other caller. Run history is under Project → Cron Jobs.

### Web Analytics
`<Analytics />` (`src/components/analytics.tsx`, in the root layout) records cookieless page views in production builds only. Turn it on under Project → Analytics → Enable; until then `/_vercel/insights/script.js` returns 404 and nothing is recorded. The script and its beacons use our own origin, so the CSP needs no change. URLs are reduced to their path before sending (no query, no fragment), so sign-in link tokens never reach Vercel.

## 3. Resend (sign-in codes and security emails)

1. Create an API key at <https://resend.com/api-keys> (permission: *Sending access*), and set it as `RESEND_API_KEY`.
2. **Verify a sending domain**: Domains → Add domain, then add the DNS records it shows (SPF and DKIM). Until it's verified, Resend only delivers to your own address.
3. **Add a DMARC record** too (not optional for us): a TXT record at `_dmarc.<your domain>`, e.g. `v=DMARC1; p=quarantine; rua=mailto:dmarc@<your domain>`. Start with `p=none` for a week if you want to watch reports first.
4. Set `EMAIL_FROM` to an address on that domain, e.g. `InkBoard <signin@<your domain>>`. Keep it the same over time: mail clients build trust in a sender gradually.

**Why step 3 matters:** Gmail's "Copy code" button, Apple Mail's code AutoFill and Outlook's code highlighting only appear for senders that pass SPF, DKIM and DMARC and have a good sending history. The emails are built to be easy to detect (see `src/server/email-templates.ts`), but detection is the mail client's decision, so it may not appear for a new domain at first. Check a delivered email's "Show original" in Gmail: SPF, DKIM and DMARC should all say PASS.

There is no fallback, locally or in production: without `RESEND_API_KEY` the app refuses to start, and codes are never written to logs.

## 4. Cloudflare R2 (profile photos)

Writers' profile photos (docs/PLAN.md, Phase 22) and novel covers (Phase 25) are stored in an R2 bucket (under `photos/` and `covers/`). Browsers never talk to R2: the app reads them server-side and serves them from its own origin (`/photos/<key>/<size>.webp`, `/covers/<key>/<width>.webp`), so there is **no public bucket, no custom domain and no CORS** to set up. Until these four variables are set, everything else works and uploads fail with "Your photo couldn't be stored just now" (the log says which variables are missing).

1. **Create the bucket.** Cloudflare dashboard → R2 Object Storage → Create bucket. Name it e.g. `inkboard-photos`; location *Automatic*; storage class *Standard*. Leave **Public access off** (no r2.dev subdomain, no custom domain).
2. **Create an API token with the narrowest permissions.** R2 → Manage R2 API Tokens (*API* on the R2 overview) → Create API token:
   - Permissions: **Object Read & Write** (not Admin: it can't create or delete buckets).
   - Specify bucket(s): **Apply to specific buckets only** → `inkboard-photos`.
   - TTL: *Forever* (or a date you'll remember to rotate by).
   - Client IP filtering: none (Vercel's outbound IPs change).
   Create it, then copy the **Access Key ID** and the **Secret Access Key** (shown once). Ignore the token value and the endpoint URL; the app builds the endpoint from the account ID.
3. **Find the account ID:** the 32-character hex string on the R2 overview page (also in the endpoint `https://<account id>.r2.cloudflarestorage.com`).
4. **Set the variables**, in `.env.local` for development against the real bucket (optional) and in Vercel → Settings → Environment Variables for Production (and Preview, if previews should accept uploads; consider a second bucket for them):

   | Variable | Value |
   | --- | --- |
   | `R2_ACCOUNT_ID` | the account ID |
   | `R2_ACCESS_KEY_ID` | the token's Access Key ID |
   | `R2_SECRET_ACCESS_KEY` | the token's Secret Access Key (mark it *Sensitive* in Vercel) |
   | `R2_BUCKET` | `inkboard-photos` |

   All four or none: a partial set is reported by name. `R2_PUBLIC_URL` is **not** used (photos aren't served from R2).
5. **Check it:** `pnpm storage:check` (reads `.env.local`). It puts a small test object, reads it back, lists it (the daily cleanup needs listing), deletes it and prints `PASS`, or `FAIL (<reason>)` with what to fix: wrong key or secret, a bucket that doesn't exist, or a token without Object Read & Write on that bucket. It never prints a secret. To check Vercel's values: `vercel env pull .env.check --environment=production`, then `DOTENV_CONFIG_PATH=.env.check pnpm storage:check`, then delete `.env.check`.
6. **Redeploy** (Vercel reads new variables on the next deploy), then upload a photo on your profile and open your author page.

Nothing else is needed in Cloudflare: no lifecycle rules (removed photos are deleted by the app at once, and files a failed save left behind by the daily cron), no CORS, no cache rules. Removed photos may still show from a browser's cache for up to an hour.

**Taking a photo down** (abuse): `APP_URL=https://<your domain> CRON_SECRET=<the production value> pnpm photo:remove <author-slug>` (the slug is the part after `/a/` in their author page's address). It deletes the photo's files, shows the avatar everywhere and refreshes every cached page and picture at once; the writer keeps their account and can upload another photo.

## 5. After the first deploy

- [ ] Sign in with your email, complete onboarding, and publish a test poem. Check that it appears on the board.
- [ ] Make one poem private and open it in a private window. The text should stay hidden until the password is entered.
- [ ] Search for the poem title with ⌘K.
- [ ] Response headers on `/` include `Content-Security-Policy` and `Strict-Transport-Security`.
- [ ] Trigger the cron once from the Cron Jobs page. It returns `{"ok":true,…}` (`orphanPhotos` is a number once R2 is set, `null` before).
- [ ] With R2 set: `pnpm storage:check` passes; upload a profile photo, check it on the board, your author page and a poem's share image, then remove it.
- [ ] Open a few pages, then check Project → Analytics: the visits appear within a minute or two.
- [ ] (Optional) Demo content: **don't** seed production. To try it on a preview branch, run `DATABASE_URL=<preview branch URL> pnpm db:seed` locally.

## Operations

- **Migrations** run automatically on every deploy, in production and on each preview branch. Review files in `drizzle/` like code. To roll back, add a new migration; don't edit an applied one.
- **Backups:** Neon keeps point-in-time history (the window depends on your plan). Restore by creating a branch from a timestamp.
- **Sign everyone out:** delete all rows in `sessions`, or rotate `AUTH_SECRET`.
- **Board cache:** admin edits refresh it immediately. Changes made directly in the database appear within an hour, or on the next deploy.
