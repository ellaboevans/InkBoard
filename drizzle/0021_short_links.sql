CREATE TABLE "retired_short_codes" (
	"code" text PRIMARY KEY NOT NULL,
	"retired_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "short_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"poem_id" uuid NOT NULL,
	"code" text NOT NULL,
	"visits" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "short_links" ADD CONSTRAINT "short_links_poem_id_poems_id_fk" FOREIGN KEY ("poem_id") REFERENCES "public"."poems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "short_links_poem_key" ON "short_links" USING btree ("poem_id");--> statement-breakpoint
CREATE UNIQUE INDEX "short_links_code_key" ON "short_links" USING btree ("code");