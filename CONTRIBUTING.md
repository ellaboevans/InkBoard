# Contributing to InkBoard

Thank you for your interest in contributing to InkBoard! InkBoard is an open-source platform for cataloguing and publishing poems and novels on a canvas board.

This guide outlines our development workflow and contribution process.

---

## Getting Started

### Prerequisites

- **Node.js**: v22.x or later (see `.nvmrc`)
- **Package Manager**: `pnpm` v10.x
- **Database**: PostgreSQL 15+ (local instance or Neon serverless Postgres)

### Local Repository Setup

1. Fork and clone the repository:
   ```bash
   git clone https://github.com/<your-username>/inkboard.git
   cd inkboard
   ```

2. Install dependencies:
   ```bash
   pnpm install
   ```

3. Configure environment variables:
   ```bash
   cp .env.example .env.local
   ```
   Set at minimum:
   - `AUTH_SECRET`: Generate using `openssl rand -base64 48`
   - `DATABASE_URL`: Connection string to your local PostgreSQL instance or Neon branch

4. Setup local databases:
   ```bash
   createdb poemhub_dev
   createdb poemhub_test
   createdb poemhub_e2e
   ```

5. Run database migrations:
   ```bash
   pnpm db:migrate
   ```

6. Start the development server:
   ```bash
   pnpm dev
   ```
   Open `http://localhost:3000` in your browser.

---

## Development Workflow

### Scripts Overview

- `pnpm dev`: Runs migration verification followed by the Next.js development server.
- `pnpm build`: Performs a production build and verifies Cache Components constraints.
- `pnpm lint`: Runs ESLint across all source files.
- `pnpm typecheck`: Runs route type generation and TypeScript static analysis (`next typegen && tsc --noEmit`).
- `pnpm test`: Executes the Vitest unit and database integration test suite.
- `pnpm exec playwright test`: Runs Playwright end-to-end browser tests.
- `pnpm db:generate`: Generates a new SQL migration from changes in `src/db/schema.ts`.
- `pnpm db:migrate`: Applies pending migrations to `DATABASE_URL`.
- `pnpm db:seed`: Seeds sample authors and content for local testing.

---

## Architectural Guidelines

When writing code for InkBoard, adhere to the following principles:

1. **Next.js 16 Cache Components**:
   - Dynamic headers or cookies access (`cookies()`, `headers()`) must always be wrapped within a `<Suspense>` boundary.
   - Do not call dynamic session lookups inside cached functions (`use cache`).

2. **Database Concurrency and Locking**:
   - Observe strict database row lock ordering to prevent deadlocks:
     `Editor` (`FOR NO KEY UPDATE`) -> `Novels` / `Collections` -> `Poems`.
   - Never query or mutate user data without scoping queries by `editorId`.

3. **User Interface Standards**:
   - InkBoard uses Tailwind CSS v4 and Radix UI / shadcn primitives.
   - Ensure interactive elements are accessible (`aria-disabled`, keyboard navigation).

---

## Submitting Pull Requests

1. Create a descriptive feature branch:
   ```bash
   git checkout -b feat/your-feature-name
   ```
2. Commit your changes using conventional commit messages (`feat: ...`, `fix: ...`, `docs: ...`).
3. Ensure all automated checks pass locally:
   ```bash
   pnpm lint
   pnpm typecheck
   pnpm test
   ```
4. Open a pull request against the `main` branch with a summary of changes and testing performed.
