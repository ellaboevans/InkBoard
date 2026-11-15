import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/**
 * How an editor's private poems are protected:
 * - per_poem: each private poem has its own password (poems.password_hash).
 * - shared:   one password (editors.shared_password_hash) opens all of them.
 */
export const passwordMode = pgEnum("password_mode", ["per_poem", "shared"]);

/** People who write and manage poems. Created on first verified OTP. */
export const editors = pgTable(
  "editors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Always stored lower-cased and trimmed. */
    email: text("email").notNull(),
    /** Public author name; the label of the editor's section on the board. */
    penName: text("pen_name"),
    /** URL-safe handle derived from pen name, used in /p/[author]/[poem]. */
    slug: text("slug"),
    bio: text("bio"),
    /** One-line tagline shown with the pen name (≤ 80 chars). */
    tagline: text("tagline"),
    /** Chosen avatar id from src/lib/avatars.ts; null = default derived from id. */
    avatar: text("avatar"),
    /** Up to 4 https links (website, socials), validated in profile.ts. */
    links: jsonb("links").$type<string[]>().notNull().default([]),
    /** A published poem of this editor's to feature. Ownership is checked in profile.ts. */
    pinnedPoemId: uuid("pinned_poem_id").references((): AnyPgColumn => poems.id, {
      onDelete: "set null",
    }),
    passwordMode: passwordMode("password_mode").notNull().default("per_poem"),
    /** scrypt hash of the shared password; required when password_mode = 'shared'. */
    sharedPasswordHash: text("shared_password_hash"),
    /** Bumped whenever the shared password (or mode) changes, revoking reader unlocks. */
    sharedPasswordVersion: integer("shared_password_version").notNull().default(0),
    lastSignInAt: timestamp("last_sign_in_at", { withTimezone: true }),
    /** When the welcome email was claimed (sent at most once, after onboarding). */
    welcomedAt: timestamp("welcomed_at", { withTimezone: true }),
    /**
     * When the editor answered "Not now" to the dashboard's recovery-code setup
     * prompt (docs/PLAN.md, Phase 16). Server-side, so it holds on every device.
     */
    recoveryPromptDismissedAt: timestamp("recovery_prompt_dismissed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("editors_email_key").on(t.email),
    uniqueIndex("editors_slug_key").on(t.slug),
    check(
      "editors_shared_mode_requires_password",
      sql`${t.passwordMode} = 'per_poem' OR ${t.sharedPasswordHash} IS NOT NULL`,
    ),
  ],
);

/** One-time sign-in codes and links. Only HMACs of the code and link token are stored. */
export const emailOtps = pgTable(
  "email_otps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    codeHash: text("code_hash").notNull(),
    /** HMAC of the sign-in link token sent with the code; null for decoy rows. */
    linkTokenHash: text("link_token_hash"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    requestedIp: text("requested_ip"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("email_otps_email_created_idx").on(t.email, t.createdAt),
    uniqueIndex("email_otps_link_token_hash_key").on(t.linkTokenHash),
  ],
);

/** How a session was started: an email code or link, or a recovery code (Phase 16). */
export const signInMethod = pgEnum("sign_in_method", ["email", "recovery"]);

/** Server-side sessions. The cookie holds a random token; we store its SHA-256. */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    editorId: uuid("editor_id")
      .notNull()
      .references(() => editors.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    userAgent: text("user_agent"),
    ip: text("ip"),
    /**
     * "This isn't my device" at sign-in: a 12-hour session with a browser-session
     * cookie and no device cookie (src/server/auth/dal.ts).
     */
    publicDevice: boolean("public_device").notNull().default(false),
    method: signInMethod("sign_in_method").notNull().default("email"),
    /**
     * When this session last proved access to the editor's inbox: set at an
     * email sign-in, and again by a step-up code (src/server/auth/step-up.ts).
     * Null for a recovery-code sign-in. Replacing recovery codes needs this to
     * be recent, so a stolen long-lived session can't quietly do it.
     */
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("sessions_token_hash_key").on(t.tokenHash),
    index("sessions_editor_idx").on(t.editorId),
  ],
);

/**
 * Recovery codes (docs/PLAN.md, Phase 16): ten single-use codes per editor
 * for signing in without email. Only an HMAC of each code is stored
 * (src/server/auth/recovery-codes.ts). A new set deletes the old one; used
 * codes stay until then, so "n of 10 left" can be shown.
 */
export const recoveryCodes = pgTable(
  "recovery_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    editorId: uuid("editor_id")
      .notNull()
      .references(() => editors.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("recovery_codes_editor_idx").on(t.editorId),
    uniqueIndex("recovery_codes_code_hash_key").on(t.codeHash),
  ],
);

/**
 * Step-up codes: a 6-digit code emailed to a signed-in editor to confirm it's
 * them before a sensitive change (replacing recovery codes). Bound to the
 * session that asked for it; only an HMAC is stored.
 */
export const stepUpCodes = pgTable(
  "step_up_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("step_up_codes_session_idx").on(t.sessionId, t.createdAt)],
);

/**
 * Networks an editor has signed in from, to spot sign-ins from a new one.
 * Only a keyed hash (HMAC) of the IP bucket is stored, never the IP itself.
 */
export const signInLocations = pgTable(
  "sign_in_locations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    editorId: uuid("editor_id")
      .notNull()
      .references(() => editors.id, { onDelete: "cascade" }),
    ipKey: text("ip_key").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("sign_in_locations_editor_ip_key").on(t.editorId, t.ipKey)],
);

/**
 * Browsers an editor has signed in from: an HMAC of the random id in the
 * long-lived device cookie (DEVICE_COOKIE), never the id itself. A sign-in
 * from a browser without a known id triggers a new-device alert.
 */
export const signInDevices = pgTable(
  "sign_in_devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    editorId: uuid("editor_id")
      .notNull()
      .references(() => editors.id, { onDelete: "cascade" }),
    deviceKey: text("device_key").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("sign_in_devices_editor_device_key").on(t.editorId, t.deviceKey)],
);

/**
 * An editor's named, ordered group of their own poems (docs/PLAN.md, Phase 14).
 * The slug is unique per editor and fixed once created (it goes into URLs).
 */
export const collections = pgTable(
  "collections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    editorId: uuid("editor_id")
      .notNull()
      .references(() => editors.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    intro: text("intro"),
    ...timestamps,
  },
  (t) => [uniqueIndex("collections_editor_slug_key").on(t.editorId, t.slug)],
);

export const poemVisibility = pgEnum("poem_visibility", ["public", "private"]);
export const poemStatus = pgEnum("poem_status", ["draft", "published"]);

export const poems = pgTable(
  "poems",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    editorId: uuid("editor_id")
      .notNull()
      .references(() => editors.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    /** Plain text; whitespace and line breaks are significant. */
    body: text("body").notNull(),
    visibility: poemVisibility("visibility").notNull().default("public"),
    /** BCP 47 tag from src/lib/poem-languages.ts; null = not set. Rendered as `lang`. */
    language: text("language"),
    /**
     * scrypt hash. Required for private poems whose author is in per_poem mode;
     * null (unused) in shared mode. Enforced by triggers, see
     * drizzle/0002_password_mode_triggers.sql (a CHECK can't see the editor).
     */
    passwordHash: text("password_hash"),
    /** Bumped on every password change so outstanding unlock cookies stop working. */
    passwordVersion: integer("password_version").notNull().default(0),
    status: poemStatus("status").notNull().default("draft"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    /**
     * At most one collection (the same editor's; src/server/collections.ts),
     * with a 1-based position that stays contiguous over all its poems,
     * drafts included. Both are set and cleared together by the app.
     * SET NULL is only a safety net: deleting a collection clears positions first.
     */
    collectionId: uuid("collection_id").references(() => collections.id, { onDelete: "set null" }),
    collectionPosition: integer("collection_position"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("poems_editor_slug_key").on(t.editorId, t.slug),
    // Two poems can't share a position (NULL collections never clash).
    uniqueIndex("poems_collection_position_key").on(t.collectionId, t.collectionPosition),
    index("poems_editor_idx").on(t.editorId),
    index("poems_status_published_idx").on(t.status, t.publishedAt),
  ],
);

/**
 * Revision history (docs/PLAN.md, Phase 13): a snapshot of a poem's title,
 * text and language each time a save changes one of them, newest 20 per poem
 * (pruned in the saving transaction, src/server/poem-history.ts). The newest
 * row matches the poem itself. Editor-only: scoped through `poems.editor_id`,
 * never read for readers. Deliberately no password or visibility columns.
 */
export const poemRevisions = pgTable(
  "poem_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    poemId: uuid("poem_id")
      .notNull()
      .references(() => poems.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    body: text("body").notNull(),
    language: text("language"),
    /**
     * clock_timestamp(), not now(): saves of one editor queue on the editor
     * row lock, and now() (transaction start) could order them backwards.
     */
    savedAt: timestamp("saved_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (t) => [index("poem_revisions_poem_saved_idx").on(t.poemId, t.savedAt.desc())],
);

/** Fixed-window rate limit counters (see src/server/rate-limit.ts). */
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  count: integer("count").notNull(),
});

export type Editor = typeof editors.$inferSelect;
export type Poem = typeof poems.$inferSelect;
