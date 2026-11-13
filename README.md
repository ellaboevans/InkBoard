# PoemHub

A public canvas board of poems, catalogued by author. Editors sign in with a one-time email code and decide, poem by poem, whether it is public or password-protected.

See [`docs/PLAN.md`](docs/PLAN.md) for requirements, architecture and the phase roadmap.

## Stack

Next.js 16 (App Router, Cache Components) · TypeScript · Tailwind v4 · shadcn/ui · Neon Postgres + Drizzle ORM · Resend · Vitest · Playwright

## Getting started

```bash
pnpm install
cp .env.example .env.local        # then set AUTH_SECRET (openssl rand -base64 48)
createdb poemhub_dev              # or point DATABASE_URL at a Neon branch
pnpm db:migrate
pnpm dev
```

Open http://localhost:3000/sign-in. Sign-in codes are sent as real emails, so `.env.local` needs `RESEND_API_KEY` and an `EMAIL_FROM` on a domain verified in Resend (docs/DEPLOY.md §3).

### Deploying

See [`docs/DEPLOY.md`](docs/DEPLOY.md): Neon (with a database branch per preview), Vercel (migrations on every build, daily cleanup cron), and Resend.

### Using Neon

Create a project at https://console.neon.tech, copy the **pooled** connection string into `DATABASE_URL`, and run `pnpm db:migrate`. The app switches to Neon's serverless driver automatically for `*.neon.tech` hosts.

## Tests

```bash
createdb poemhub_test && createdb poemhub_e2e   # once
pnpm test                       # unit + Postgres integration tests
pnpm exec playwright test       # end-to-end (uses local Chrome)
```
