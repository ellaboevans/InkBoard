/**
 * A chapter row for a direct insert in a test: a published one is released
 * when it was published (Phase 28: `release_at` is set exactly while the status
 * is 'published', a check), unless the test gives its own `releaseAt`.
 */
type Row = { status?: "draft" | "published" | null; publishedAt?: Date | null; releaseAt?: Date | null };
export function withRelease<T extends Row>(row: T): T & { releaseAt: Date | null };
export function withRelease<T extends Row>(rows: T[]): (T & { releaseAt: Date | null })[];
export function withRelease<T extends Row>(rows: T | T[]) {
  const one = (r: T) => ({ ...r, releaseAt: r.status === "published" ? (r.releaseAt ?? r.publishedAt ?? new Date()) : null });
  return Array.isArray(rows) ? rows.map(one) : one(rows);
}
