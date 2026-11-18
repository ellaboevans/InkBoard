import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
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
    /**
     * Profile photo (docs/PLAN.md, Phase 22): the random key of its processed
     * copies in photo storage (photos/<key>/…); null = show the avatar. A new
     * photo always gets a new key, never the email, id or slug.
     */
    photoKey: text("photo_key").unique("editors_photo_key_unique"),
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
    /**
     * The WebAuthn user handle (base64url of 32 random bytes) given to this
     * editor's passkeys, made at their first passkey (Phase 16, round 2).
     * Opaque on purpose: authenticators may show or sync it, so never the email or id.
     */
    webauthnUserId: text("webauthn_user_id"),
    /**
     * The dashboard's welcome checklist (docs/PLAN.md, Phase 20). Every step is
     * derived from real data; only these two are stored, on the editor so they
     * hold on every device. `author_page_shared_at`: the first time the editor
     * shared their author page from the checklist. `checklist_hidden_at`: the
     * checklist is gone for good, either "Hide checklist" or the one render
     * that found all six steps done and showed "You're all set" (claimed with a
     * conditional UPDATE, so that message shows exactly once).
     */
    authorPageSharedAt: timestamp("author_page_shared_at", { withTimezone: true }),
    checklistHiddenAt: timestamp("checklist_hidden_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("editors_email_key").on(t.email),
    uniqueIndex("editors_slug_key").on(t.slug),
    uniqueIndex("editors_webauthn_user_id_key").on(t.webauthnUserId),
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

/** How a session was started: an email code or link, a recovery code, or a passkey (Phase 16). */
export const signInMethod = pgEnum("sign_in_method", ["email", "recovery", "passkey"]);

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
    /**
     * When this session last proved possession of one of the editor's
     * passkeys with user verification: a passkey sign-in, or a passkey
     * confirmation on the profile (round 2). Counts for step-up like
     * email_verified_at.
     */
    passkeyVerifiedAt: timestamp("passkey_verified_at", { withTimezone: true }),
    /** "Not now" on the add-a-passkey offer shown after a recovery-code sign-in. */
    passkeyOfferDismissedAt: timestamp("passkey_offer_dismissed_at", { withTimezone: true }),
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
 * Passkeys (docs/PLAN.md, Phase 16 round 2): WebAuthn credentials an editor
 * registered for signing in without email. Only public data is stored: the
 * credential id, the COSE public key, the signature counter, transports and
 * the backup flags. Every query is scoped by the DAL-resolved editor id.
 */
export const passkeys = pgTable(
  "passkeys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    editorId: uuid("editor_id")
      .notNull()
      .references(() => editors.id, { onDelete: "cascade" }),
    /** base64url credential id, as the browser reports it. */
    credentialId: text("credential_id").notNull(),
    /** base64url of the COSE-encoded public key. */
    publicKey: text("public_key").notNull(),
    /** Signature counter (uint32); 0 for authenticators that don't count (synced passkeys). */
    counter: bigint("counter", { mode: "number" }).notNull().default(0),
    transports: jsonb("transports").$type<string[]>().notNull().default([]),
    /** singleDevice | multiDevice */
    deviceType: text("device_type").notNull(),
    /** Synced to the editor's account (iCloud Keychain, Google Password Manager…). */
    backedUp: boolean("backed_up").notNull().default(false),
    /** Editor-chosen label; defaults to the device it was added on. */
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("passkeys_credential_id_key").on(t.credentialId),
    index("passkeys_editor_idx").on(t.editorId),
  ],
);

export const webauthnPurpose = pgEnum("webauthn_purpose", ["registration", "authentication", "step-up"]);

/**
 * WebAuthn challenges: random, single use (deleted when used), about 5
 * minutes long, and tied to the browser that asked through a short-lived
 * httpOnly cookie whose token is stored only as a SHA-256. Registration and
 * step-up challenges are also tied to the editor and the session.
 */
export const webauthnChallenges = pgTable(
  "webauthn_challenges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull(),
    purpose: webauthnPurpose("purpose").notNull(),
    /** base64url, as sent in the options. */
    challenge: text("challenge").notNull(),
    editorId: uuid("editor_id").references(() => editors.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").references(() => sessions.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("webauthn_challenges_token_hash_key").on(t.tokenHash)],
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
     * When the poem was announced to notification subscribers (docs/PLAN.md,
     * Phase 18): set once, in the save that first publishes it as a public
     * poem, and never cleared, so a poem is announced at most once ever.
     * Poems published before Phase 18 were back-filled with published_at.
     */
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
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

/**
 * Author slugs of deleted accounts (docs/PLAN.md, Phase 17). A retired slug is
 * never given to another editor, so old /a/<slug> and /p/<slug>/… links can't
 * come to point at someone else's poems. Only the slug and when: nothing
 * personal. A trigger (drizzle/0016_retired_slugs_guard.sql) refuses to put a
 * retired slug on an editor.
 */
/*
 * Novels (docs/PLAN.md, Phase 23; docs/research/novels.md): an editor's
 * books, each with ordered chapters published one at a time. Their own
 * tables, not poems in a collection; src/server/novels.ts scopes every query
 * by the DAL editor id (chapters through their novel). Private novels
 * (visibility, password) and uploaded covers since Phase 25.
 */
export const novelStatus = pgEnum("novel_status", ["ongoing", "complete"]);

export const novels = pgTable(
  "novels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    editorId: uuid("editor_id")
      .notNull()
      .references(() => editors.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    /** Unique per editor; follows the title until any chapter has been published, then fixed. */
    slug: text("slug").notNull(),
    /** Plain text, ≤ BLURB_MAX; null = none. */
    blurb: text("blurb"),
    /** BCP 47 tag from src/lib/poem-languages.ts, like poems; chapters inherit it. */
    language: text("language"),
    status: novelStatus("status").notNull().default("ongoing"),
    /**
     * The whole book is public or private, behind one password (Phase 25):
     * readers always see the title, cover, blurb and chapter list; chapter
     * text only after unlocking (src/server/unlock.ts).
     */
    visibility: poemVisibility("visibility").notNull().default("public"),
    /**
     * scrypt hash, like poems': required for a private novel whose author is
     * in per_poem mode, null in shared mode (the author's one password).
     * Enforced by triggers (drizzle/0029_novel_password_triggers.sql).
     */
    passwordHash: text("password_hash"),
    /**
     * In reader unlock grants (n:<novelId>:<version>): bumped by every
     * password change or removal, making the novel public, and unpublishing
     * its last published chapter, so earlier unlocks stop working.
     */
    passwordVersion: integer("password_version").notNull().default(0),
    /**
     * The uploaded cover's random storage key (Phase 25; src/server/novel-covers.ts,
     * files under covers/<key>/), or null: the drawn cover. A new key for every
     * upload, never the novel's id, slug or title. Public even for a private
     * novel, like its title and blurb.
     */
    coverKey: text("cover_key").unique(),
    ...timestamps,
  },
  (t) => [uniqueIndex("novels_editor_slug_key").on(t.editorId, t.slug)],
);

export const chapters = pgTable(
  "chapters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    novelId: uuid("novel_id")
      .notNull()
      .references(() => novels.id, { onDelete: "cascade" }),
    /** May be empty: readers then see "Chapter n". */
    title: text("title").notNull().default(""),
    /** Unique per novel; follows the title until first published, then fixed. */
    slug: text("slug").notNull(),
    /** Prose (src/lib/prose.ts), NFC, ≤ CHAPTER_BODY_MAX. May be empty while a draft. */
    body: text("body").notNull().default(""),
    /** 1..n over all the novel's chapters, drafts included, contiguous (src/server/positions.ts). */
    position: integer("position").notNull(),
    status: poemStatus("status").notNull().default("draft"),
    /** First publish; kept when unpublished, so "ever published" fixes the slugs. */
    publishedAt: timestamp("published_at", { withTimezone: true }),
    wordCount: integer("word_count").notNull().default(0),
    /**
     * Set once, in the transaction of the chapter's first publish, when its
     * "new chapter" notification is claimed (Phase 24); never cleared, so
     * unpublishing and publishing again never announces it twice.
     */
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("chapters_novel_slug_key").on(t.novelId, t.slug),
    uniqueIndex("chapters_novel_position_key").on(t.novelId, t.position),
    index("chapters_status_published_idx").on(t.status, t.publishedAt),
  ],
);

/**
 * A chapter's saved versions (title and text), newest CHAPTER_REVISIONS_KEPT
 * kept, recorded in the save transaction only when one of them changed
 * (src/server/revisions.ts). Editor-only: only novels.ts reads it.
 */
export const chapterRevisions = pgTable(
  "chapter_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chapterId: uuid("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    body: text("body").notNull(),
    savedAt: timestamp("saved_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (t) => [index("chapter_revisions_chapter_saved_idx").on(t.chapterId, t.savedAt.desc())],
);

export const retiredSlugs = pgTable("retired_slugs", {
  slug: text("slug").primaryKey(),
  retiredAt: timestamp("retired_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Short links for shared images (docs/PLAN.md, Phase 21 round 3): one random
 * code per poem, printed on its pictures as /s/<code>, made the first time a
 * picture of the poem is drawn (src/server/short-links.ts). `visits` counts
 * visits through the link: one number per poem, shown only to its writer;
 * nothing about who visited is stored. Goes with the poem (and so with the
 * account); a trigger (drizzle/0022) moves the code to retired_short_codes
 * on delete, so it's never given to another poem.
 */
export const shortLinks = pgTable(
  "short_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    poemId: uuid("poem_id")
      .notNull()
      .references(() => poems.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    visits: integer("visits").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("short_links_poem_key").on(t.poemId), uniqueIndex("short_links_code_key").on(t.code)],
);

/**
 * Codes of deleted poems' short links: never given to another poem, so a
 * printed /s/<code> can't come to point at someone else's poem. Only the code
 * and when: nothing personal, no link to anyone.
 */
export const retiredShortCodes = pgTable("retired_short_codes", {
  code: text("code").primaryKey(),
  retiredAt: timestamp("retired_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Push subscriptions for new-poem notifications (docs/PLAN.md, Phase 18), one
 * per device/browser. No link to any person or account: only what the push
 * service needs to reach the device (src/server/push.ts). The endpoint is a
 * capability URL on an allowlisted push service.
 */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Last 2xx from the push service; the cleanup cron drops rows unused for 90 days. */
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    /**
     * Phase 18 round 2: "all" new poems, or only poems by the authors this
     * device follows (push_follows). Changed only by the browser that owns
     * the subscription (it proves it with the auth secret).
     */
    mode: text("mode").notNull().default("all"),
  },
  (t) => [
    uniqueIndex("push_subscriptions_endpoint_key").on(t.endpoint),
    check("push_subscriptions_mode_check", sql`${t.mode} IN ('all', 'followed')`),
  ],
);

/**
 * Authors a device follows (Phase 18 round 2). Goes with the subscription and
 * with the author (both cascade). Only author ids: nothing about the reader.
 */
export const pushFollows = pgTable(
  "push_follows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => pushSubscriptions.id, { onDelete: "cascade" }),
    editorId: uuid("editor_id")
      .notNull()
      .references(() => editors.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("push_follows_subscription_editor_key").on(t.subscriptionId, t.editorId),
    index("push_follows_editor_idx").on(t.editorId),
  ],
);

/**
 * One row per notification claimed for a device: what the limits count (one
 * per author per device in 12 hours, three per device in 24 hours). Claimed
 * under the subscription row's lock before sending (src/server/push.ts);
 * pruned after two days by the cleanup cron.
 */
export const pushDeliveries = pgTable(
  "push_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => pushSubscriptions.id, { onDelete: "cascade" }),
    editorId: uuid("editor_id")
      .notNull()
      .references(() => editors.id, { onDelete: "cascade" }),
    /** The poem announced, or (Phase 24) the chapter: exactly one is set. */
    poemId: uuid("poem_id").references(() => poems.id, { onDelete: "cascade" }),
    chapterId: uuid("chapter_id").references(() => chapters.id, { onDelete: "cascade" }),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * "alert": the first notification for this author in the 12-hour window
     * (counts toward the device's 3 a day). "update": a later poem in the same
     * window, which quietly replaces that notification ("3 new poems by …";
     * capped separately, Phase 18 round 2).
     */
    kind: text("kind").notNull().default("alert"),
  },
  (t) => [
    check("push_deliveries_kind_check", sql`${t.kind} IN ('alert', 'update')`),
    check("push_deliveries_one_target_check", sql`(${t.poemId} IS NULL) <> (${t.chapterId} IS NULL)`),
    index("push_deliveries_chapter_idx").on(t.chapterId),
    index("push_deliveries_subscription_sent_idx").on(t.subscriptionId, t.sentAt),
    index("push_deliveries_editor_idx").on(t.editorId),
    index("push_deliveries_poem_idx").on(t.poemId),
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
