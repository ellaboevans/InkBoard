import "server-only";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { after } from "next/server";
import { getDb } from "@/db";
import { editors } from "@/db/schema";
import { sendWelcomeEmail } from "@/server/email";

/**
 * Send the welcome email once per editor, after onboarding (their first
 * sign-in, once they've chosen a pen name). `welcomed_at` is claimed in one
 * conditional UPDATE before sending, so a resubmitted or concurrent
 * onboarding form can't send it twice. If delivery then fails it is logged,
 * not retried: a missed welcome is better than a duplicate. Returns whether
 * this call claimed (and queued) the email.
 */
export async function sendWelcomeOnce(editorId: string): Promise<boolean> {
  const [claimed] = await getDb()
    .update(editors)
    .set({ welcomedAt: new Date() })
    .where(and(eq(editors.id, editorId), isNull(editors.welcomedAt), isNotNull(editors.penName)))
    .returning({ email: editors.email, penName: editors.penName, slug: editors.slug });
  if (!claimed?.penName || !claimed.slug) return false;

  const { email, penName, slug } = claimed;
  after(async () => {
    try {
      await sendWelcomeEmail(email, { penName, slug });
    } catch (err) {
      console.error("Failed to send welcome email", err);
    }
  });
  return true;
}
