CREATE TYPE "public"."webauthn_purpose" AS ENUM('registration', 'authentication', 'step-up');--> statement-breakpoint
ALTER TYPE "public"."sign_in_method" ADD VALUE 'passkey';--> statement-breakpoint
CREATE TABLE "passkeys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"editor_id" uuid NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" text NOT NULL,
	"counter" bigint DEFAULT 0 NOT NULL,
	"transports" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean DEFAULT false NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "webauthn_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"purpose" "webauthn_purpose" NOT NULL,
	"challenge" text NOT NULL,
	"editor_id" uuid,
	"session_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "editors" ADD COLUMN "webauthn_user_id" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "passkey_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "passkey_offer_dismissed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "passkeys" ADD CONSTRAINT "passkeys_editor_id_editors_id_fk" FOREIGN KEY ("editor_id") REFERENCES "public"."editors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webauthn_challenges" ADD CONSTRAINT "webauthn_challenges_editor_id_editors_id_fk" FOREIGN KEY ("editor_id") REFERENCES "public"."editors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webauthn_challenges" ADD CONSTRAINT "webauthn_challenges_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "passkeys_credential_id_key" ON "passkeys" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "passkeys_editor_idx" ON "passkeys" USING btree ("editor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "webauthn_challenges_token_hash_key" ON "webauthn_challenges" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "editors_webauthn_user_id_key" ON "editors" USING btree ("webauthn_user_id");