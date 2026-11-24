# Local Development Guide

## Environment Configuration

1. Copy `.env.example` to `.env.local`:
   ```bash
   cp .env.example .env.local
   ```

2. Required settings:
   - `DATABASE_URL`: Connection URL to local or Neon Postgres database.
   - `AUTH_SECRET`: Random string of 32+ characters for signing authentication tokens.
   - `RESEND_API_KEY`: API key for sending sign-in verification emails.
   - `EMAIL_FROM`: Verified sender address in Resend.

## Database Preparation

Initialize local databases for development, unit testing, and E2E testing:
```bash
createdb poemhub_dev
createdb poemhub_test
createdb poemhub_e2e
```

Run schema migrations:
```bash
pnpm db:migrate
```

## Running Verification Commands

- Development server: `pnpm dev`
- Type checking: `pnpm exec next typegen && pnpm typecheck`
- Linting: `pnpm lint`
- Unit and integration tests: `pnpm test`
- End-to-end tests: `pnpm exec playwright test`
