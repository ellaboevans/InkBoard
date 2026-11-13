# Deploying PoemHub (Neon + Vercel + Resend)

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
| `EMAIL_FROM` | ✅ | ✅ | e.g. `PoemHub <login@yourdomain.com>`, on your verified domain. |
| `APP_URL` | ✅ `https://yourdomain.com` | optional | Used in sign-in emails. |
| `CRON_SECRET` | ✅ | optional | `openssl rand -base64 32`. Vercel Cron sends it to `/api/cron/cleanup`. |
| `TRUSTED_PROXY_HOPS` | `1` | `1` | Correct for Vercel. It's how the client IP is found for rate limits. |
| `EDITOR_ALLOWLIST` | empty | optional | Leave empty: anyone who verifies their email can be an editor. |

4. Deploy. The first build runs the migrations, then prerenders the (empty) board.
5. **Custom domain:** Project → Settings → Domains. The app sends `Strict-Transport-Security`, so serve it over HTTPS only.

### Cron
`vercel.json` schedules `/api/cron/cleanup` daily at 04:17 UTC. It deletes expired sign-in codes, expired sessions and stale rate-limit rows. It returns 503 until `CRON_SECRET` is set, and 401 for any other caller. Run history is under Project → Cron Jobs.

## 3. Resend (sign-in codes and security emails)

1. Create an API key at <https://resend.com/api-keys> (permission: *Sending access*), and set it as `RESEND_API_KEY`.
2. **Verify a sending domain**: Domains → Add domain, then add the DNS records it shows (SPF and DKIM). Until it's verified, Resend only delivers to your own address.
3. **Add a DMARC record** too (not optional for us): a TXT record at `_dmarc.<your domain>`, e.g. `v=DMARC1; p=quarantine; rua=mailto:dmarc@<your domain>`. Start with `p=none` for a week if you want to watch reports first.
4. Set `EMAIL_FROM` to an address on that domain, e.g. `PoemHub <signin@<your domain>>`. Keep it the same over time: mail clients build trust in a sender gradually.

**Why step 3 matters:** Gmail's "Copy code" button, Apple Mail's code AutoFill and Outlook's code highlighting only appear for senders that pass SPF, DKIM and DMARC and have a good sending history. The emails are built to be easy to detect (see `src/server/email-templates.ts`), but detection is the mail client's decision, so it may not appear for a new domain at first. Check a delivered email's "Show original" in Gmail: SPF, DKIM and DMARC should all say PASS.

There is no fallback, locally or in production: without `RESEND_API_KEY` the app refuses to start, and codes are never written to logs.

## 4. After the first deploy

- [ ] Sign in with your email, complete onboarding, and publish a test poem. Check that it appears on the board.
- [ ] Make one poem private and open it in a private window. The text should stay hidden until the password is entered.
- [ ] Search for the poem title with ⌘K.
- [ ] Response headers on `/` include `Content-Security-Policy` and `Strict-Transport-Security`.
- [ ] Trigger the cron once from the Cron Jobs page. It returns `{"ok":true,…}`.
- [ ] (Optional) Demo content: **don't** seed production. To try it on a preview branch, run `DATABASE_URL=<preview branch URL> pnpm db:seed` locally.

## Operations

- **Migrations** run automatically on every deploy, in production and on each preview branch. Review files in `drizzle/` like code. To roll back, add a new migration; don't edit an applied one.
- **Backups:** Neon keeps point-in-time history (the window depends on your plan). Restore by creating a branch from a timestamp.
- **Sign everyone out:** delete all rows in `sessions`, or rotate `AUTH_SECRET`.
- **Board cache:** admin edits refresh it immediately. Changes made directly in the database appear within an hour, or on the next deploy.
