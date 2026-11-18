-- Novel titles in board search (docs/PLAN.md, Phase 24), like poem titles in
-- 0003_search.sql: the same search_normalize() expression (0009's version,
-- with Ghanaian letters), so src/server/search.ts's queries hit these
-- indexes. Only titles: chapter text, chapter titles and blurbs are never
-- indexed or searched.
CREATE INDEX novels_title_fts_idx ON novels
  USING gin (to_tsvector('simple', search_normalize(title)));
--> statement-breakpoint
CREATE INDEX novels_title_trgm_idx ON novels
  USING gin (search_normalize(title) gin_trgm_ops);
