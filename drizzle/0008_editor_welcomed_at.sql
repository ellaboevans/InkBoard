ALTER TABLE "editors" ADD COLUMN "welcomed_at" timestamp with time zone;--> statement-breakpoint
-- Editors who onboarded before welcome emails existed never get one.
UPDATE "editors" SET "welcomed_at" = now() WHERE "pen_name" IS NOT NULL;
