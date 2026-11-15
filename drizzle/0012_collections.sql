CREATE TABLE "collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"editor_id" uuid NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"intro" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "poems" ADD COLUMN "collection_id" uuid;--> statement-breakpoint
ALTER TABLE "poems" ADD COLUMN "collection_position" integer;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_editor_id_editors_id_fk" FOREIGN KEY ("editor_id") REFERENCES "public"."editors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "collections_editor_slug_key" ON "collections" USING btree ("editor_id","slug");--> statement-breakpoint
ALTER TABLE "poems" ADD CONSTRAINT "poems_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "poems_collection_position_key" ON "poems" USING btree ("collection_id","collection_position");