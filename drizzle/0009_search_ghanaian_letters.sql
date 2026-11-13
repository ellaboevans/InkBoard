-- Search folds the letters of Ewe, Twi/Akan, Nzema and Ga, and common IPA
-- vowels, to plain Latin (docs/PLAN.md, Phase 11), so "odo" finds "ɔdɔ"
-- while "ɔdɔ" still finds itself. unaccent already folds Ɛ Ɖ Ƒ Ŋ Ʋ and
-- strips combining tone marks; translate() covers the rest, in both cases,
-- before lower() (which only lower-cases ASCII under a C locale). The two
-- strings must match SEARCH_FOLD in src/lib/letters.ts (a test checks).
CREATE OR REPLACE FUNCTION search_normalize(text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
AS $$ SELECT lower(translate(
  public.unaccent('public.unaccent'::regdictionary, $1),
  'ƐɛƆɔƉɖƑƒƔɣŊŋƲʋƷʒƖɩƱʊəɪ',
  'eeooddffggnnvvzziiuuei'
)) $$;
--> statement-breakpoint
-- The function is IMMUTABLE and used in these index expressions, so their
-- stored keys must be rebuilt with the new definition.
REINDEX INDEX editors_pen_name_fts_idx;
--> statement-breakpoint
REINDEX INDEX editors_pen_name_trgm_idx;
--> statement-breakpoint
REINDEX INDEX poems_title_fts_idx;
--> statement-breakpoint
REINDEX INDEX poems_title_trgm_idx;
