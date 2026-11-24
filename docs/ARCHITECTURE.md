# InkBoard Technical Architecture

## System Overview

InkBoard is a collaborative literary canvas built with Next.js 16 (App Router), TypeScript, Tailwind CSS v4, and Neon PostgreSQL managed via Drizzle ORM.

### Key Subsystems

1. **Board Canvas & Reader Streaming**
   - Reader routes (`/a/[author]`, `/p/[author]/[poem]`, `/a/[author]/n/[novel]/[chapter]`) utilize streaming rendering.
   - Reader path resolution occurs via `proxy.ts` middleware and static 404 rewrite endpoints (`/missing/*`).
   - High-performance tag revalidation via Next.js cache tags (`BOARD_TAG`, `editorTag`).

2. **Authentication & Session Isolation**
   - Passwordless email OTP verification via Resend.
   - Optional Passkey / WebAuthn hardware credentials support.
   - Data Access Layer (DAL) enforces `editorId` scoping across every database query.

3. **Database Concurrency & Locking Protocol**
   - Consistent database lock order across transactions:
     `Editor` row (`FOR NO KEY UPDATE`) -> `Novels` / `Collections` rows -> `Poems` rows.
   - Prevents deadlock scenarios during concurrent writes or password mode migrations.

4. **Media and Offline Architecture**
   - Profile photos and book covers support Cloudflare R2 object storage with local filesystem fallback (`.storage/`).
   - Service worker implementation with IndexedDB client-side cache for offline reading mode.
