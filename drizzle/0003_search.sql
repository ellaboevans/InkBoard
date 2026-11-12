-- Full-text search over author pen names and poem titles (R10).
-- Poem bodies are deliberately NOT indexed or searched (N1).
--   * tsvector ('simple' config: names/titles, no stemming) for word and
--     prefix matches ("ros" -> "Rose")
--   * pg_trgm for typo tolerance ("dickenson" -> "Dickinson")
--   * unaccent so "jose" finds "José"; wrapped in an IMMUTABLE function
--     because unaccent() itself isn't, and index expressions require it.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS unaccent;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION search_normalize(text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
AS $$ SELECT lower(public.unaccent('public.unaccent'::regdictionary, $1)) $$;
--> statement-breakpoint
CREATE INDEX editors_pen_name_fts_idx ON editors
  USING gin (to_tsvector('simple', search_normalize(coalesce(pen_name, ''))));
--> statement-breakpoint
CREATE INDEX editors_pen_name_trgm_idx ON editors
  USING gin (search_normalize(coalesce(pen_name, '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX poems_title_fts_idx ON poems
  USING gin (to_tsvector('simple', search_normalize(title)));
--> statement-breakpoint
CREATE INDEX poems_title_trgm_idx ON poems
  USING gin (search_normalize(title) gin_trgm_ops);
