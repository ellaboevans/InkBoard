ALTER TABLE "novels" ADD COLUMN "featured_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "novels" ADD COLUMN "featured_notice_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "poems" ADD COLUMN "featured_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "poems" ADD COLUMN "featured_notice_at" timestamp with time zone;