import { transliterate } from "./letters";

/** URL-safe slug: accents stripped, lower-case, dashes, max 48 chars. */
export function slugify(value: string, fallback = "untitled"): string {
  return (
    transliterate(value)
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "") // strip accents
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48)
      .replace(/-+$/g, "") || fallback
  );
}

/** First free slug among `base`, `base-2`, `base-3`, … given the taken ones. */
export function firstFreeSlug(base: string, taken: Iterable<string | null>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
  }
}

/** Postgres unique_violation, as surfaced by either driver (pg / Neon). */
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}

/** Postgres check_violation (CHECK constraints and our password triggers). */
export function isCheckViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23514" || e?.cause?.code === "23514";
}
