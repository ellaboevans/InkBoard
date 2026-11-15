CREATE TABLE "retired_slugs" (
	"slug" text PRIMARY KEY NOT NULL,
	"retired_at" timestamp with time zone DEFAULT now() NOT NULL
);
