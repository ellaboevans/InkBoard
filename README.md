# InkBoard

InkBoard is an open-source public canvas board of poems and novels catalogued by author. Authors and editors sign in using a passwordless one-time email code and can configure content to be public, private, or password-protected.

---

## Features

- **Dynamic Canvas Board**: Pan-and-zoom board organizing poems and novels by author.
- **Author Workspaces**: Dedicated editorial dashboards (`/admin`) for drafting and publishing poems, collections, and multi-chapter novels.
- **Privacy & Password Controls**: Per-item or shared author passwords with automatic lock triggers.
- **Passwordless Authentication**: Secure email OTP authentication and optional WebAuthn passkeys.
- **Media Support**: Audio and video readings, cover art, and author profile photos.
- **PWA & Offline Mode**: Offline reading powered by service workers and local caching.
- **Web Push Notifications**: Reader subscriptions for new poem and novel chapter releases.
- **Content Reporting & Moderation**: Built-in reporting system and owner takedown controls.

---

## Technology Stack

- **Framework**: Next.js 16 (App Router, Turbopack, Cache Components)
- **Runtime & Language**: Node.js 22+, TypeScript
- **Styling**: Tailwind CSS v4, shadcn/ui, Radix UI primitives
- **Database & ORM**: PostgreSQL (Neon serverless or local) with Drizzle ORM
- **Testing**: Vitest (unit & integration), Playwright (E2E), axe-core (accessibility)

---

## Quick Start

### 1. Prerequisites
- Node.js >= 22 (see `.nvmrc`)
- `pnpm` >= 10
- PostgreSQL database

### 2. Setup

```bash
# Clone the repository
git clone https://github.com/ellaboevans/inkboard.git
cd inkboard

# Install dependencies
pnpm install

# Configure environment variables
cp .env.example .env.local

# Run migrations
pnpm db:migrate

# Start development server
pnpm dev
```

Visit `http://localhost:3000` to browse the canvas or `/sign-in` to access the editor workspace.

---

## Documentation

- [Contributing Guidelines](CONTRIBUTING.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [System Architecture](docs/ARCHITECTURE.md)
- [Local Development Guide](docs/LOCAL_DEVELOPMENT.md)
- [Deployment Guide](docs/DEPLOY.md)
- [Security Policy](SECURITY.md)
- [Support](SUPPORT.md)

---

## Testing

```bash
# Typecheck
pnpm typecheck

# Linting
pnpm lint

# Unit & integration tests
pnpm test

# End-to-end tests
pnpm exec playwright test
```

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
