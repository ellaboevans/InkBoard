import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
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
    lastSignInAt: timestamp("last_sign_in_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("editors_email_key").on(t.email),
    uniqueIndex("editors_slug_key").on(t.slug),
  ],
);

/** One-time sign-in codes. Only an HMAC of the code is stored. */
export const emailOtps = pgTable(
  "email_otps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    codeHash: text("code_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    requestedIp: text("requested_ip"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("email_otps_email_created_idx").on(t.email, t.createdAt)],
);

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
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("sessions_token_hash_key").on(t.tokenHash),
    index("sessions_editor_idx").on(t.editorId),
  ],
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
    /** scrypt hash; required when visibility = 'private'. */
    passwordHash: text("password_hash"),
    /** Bumped on every password change so outstanding unlock cookies stop working. */
    passwordVersion: integer("password_version").notNull().default(0),
    status: poemStatus("status").notNull().default("draft"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("poems_editor_slug_key").on(t.editorId, t.slug),
    index("poems_editor_idx").on(t.editorId),
    index("poems_status_published_idx").on(t.status, t.publishedAt),
    check(
      "poems_private_requires_password",
      sql`${t.visibility} = 'public' OR ${t.passwordHash} IS NOT NULL`,
    ),
  ],
);

/** Fixed-window rate limit counters (see src/server/rate-limit.ts). */
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  count: integer("count").notNull(),
});

export type Editor = typeof editors.$inferSelect;
export type Poem = typeof poems.$inferSelect;
