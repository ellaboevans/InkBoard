/** Emails "sent" during a test (see setup.ts). */
export const outbox: { to: string; code: string }[] = [];

export function lastCodeFor(email: string): string {
  const mail = outbox.findLast((m) => m.to === email);
  if (!mail) throw new Error(`No email sent to ${email}`);
  return mail.code;
}

/** Security notices "sent" during a test. */
export const alerts: { to: string; device: string; ip: string; penName: string | null }[] = [];
