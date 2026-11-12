/**
 * Populate the board with demo authors and poems.
 *
 *   pnpm db:seed           # (re)create the demo content
 *   pnpm db:seed --clear   # remove it
 *
 * Only touches editors with an @seed.poemhub.test email (a reserved .test
 * domain), so real editors and their poems are never modified. Refuses to
 * run with NODE_ENV=production.
 *
 * Runs under `--conditions=react-server` so `server-only` imports resolve.
 */
import { config } from "dotenv";
import { like, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { editors, poems } from "@/db/schema";
import { firstFreeSlug, slugify } from "@/lib/slug";
import { hashPassword } from "@/server/passwords";
import { SEED_AUTHORS, SEED_PASSWORD, SEED_SHARED_PASSWORD } from "./seed-data";

config({ path: [".env.local", ".env"], quiet: true });

const SEED_DOMAIN = "seed.poemhub.test";

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to seed with NODE_ENV=production");
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (see .env.example)");
  const clearOnly = process.argv.includes("--clear");

  const pool = new pg.Pool({ connectionString: url });
  const db = drizzle(pool);
  console.log(`Target: ${new URL(url).host}${new URL(url).pathname}`);

  try {
    await db.transaction(async (tx) => {
      // Poems and sessions cascade.
      const removed = await tx
        .delete(editors)
        .where(like(editors.email, `%@${SEED_DOMAIN}`))
        .returning({ id: editors.id });
      if (removed.length) console.log(`Removed ${removed.length} demo authors.`);
      if (clearOnly) return;

      const taken = (await tx.select({ slug: editors.slug }).from(editors)).map((r) => r.slug);
      const passwordHash = await hashPassword(SEED_PASSWORD);
      const sharedHash = await hashPassword(SEED_SHARED_PASSWORD);
      let published = 0;
      let privateCount = 0;
      let drafts = 0;

      for (const [i, author] of SEED_AUTHORS.entries()) {
        const slug = firstFreeSlug(slugify(author.penName, "author"), taken);
        taken.push(slug);
        const [editor] = await tx
          .insert(editors)
          .values({
            email: `author-${i + 1}@${SEED_DOMAIN}`,
            penName: author.penName,
            slug,
            bio: author.bio ?? null,
            ...(author.sharedPassword && {
              passwordMode: "shared" as const,
              sharedPasswordHash: sharedHash,
            }),
          })
          .returning({ id: editors.id });

        const usedSlugs: string[] = [];
        await tx.insert(poems).values(
          author.poems.map((p) => {
            const poemSlug = firstFreeSlug(slugify(p.title), usedSlugs);
            usedSlugs.push(poemSlug);
            if (p.draft) drafts++;
            else published++;
            if (p.private) privateCount++;
            const at = sql`now() - make_interval(days => ${p.daysAgo ?? 0})`;
            return {
              editorId: editor.id,
              title: p.title,
              slug: poemSlug,
              body: p.body,
              visibility: p.private ? ("private" as const) : ("public" as const),
              // Shared-mode authors' poems have no password of their own.
              passwordHash: p.private && !author.sharedPassword ? passwordHash : null,
              status: p.draft ? ("draft" as const) : ("published" as const),
              publishedAt: p.draft ? null : at,
              createdAt: at,
              updatedAt: at,
            };
          }),
        );
      }

      console.log(
        `Seeded ${SEED_AUTHORS.length} authors: ${published} published poems ` +
          `(${privateCount} private), ${drafts} drafts (not on the board).`,
      );
      const sharedNames = SEED_AUTHORS.filter((a) => a.sharedPassword).map((a) => a.penName);
      console.log(`Private demo poems: password "${SEED_PASSWORD}" (one per poem).`);
      if (sharedNames.length) {
        console.log(`  ${sharedNames.join(", ")}: one shared password "${SEED_SHARED_PASSWORD}" for all.`);
      }
    });
  } finally {
    await pool.end();
  }
  console.log("If `pnpm dev` is running, restart it to see the changes (the board is cached).");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
