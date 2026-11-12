CREATE TYPE "public"."password_mode" AS ENUM('per_poem', 'shared');--> statement-breakpoint
ALTER TABLE "poems" DROP CONSTRAINT "poems_private_requires_password";--> statement-breakpoint
ALTER TABLE "editors" ADD COLUMN "password_mode" "password_mode" DEFAULT 'per_poem' NOT NULL;--> statement-breakpoint
ALTER TABLE "editors" ADD COLUMN "shared_password_hash" text;--> statement-breakpoint
ALTER TABLE "editors" ADD COLUMN "shared_password_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "editors" ADD CONSTRAINT "editors_shared_mode_requires_password" CHECK ("editors"."password_mode" = 'per_poem' OR "editors"."shared_password_hash" IS NOT NULL);