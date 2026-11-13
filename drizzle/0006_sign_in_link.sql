ALTER TABLE "email_otps" ADD COLUMN "link_token_hash" text;--> statement-breakpoint
CREATE UNIQUE INDEX "email_otps_link_token_hash_key" ON "email_otps" USING btree ("link_token_hash");