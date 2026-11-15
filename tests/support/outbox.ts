/** Emails "sent" during a test (see setup.ts). */
export const outbox: { to: string; code: string; linkToken: string }[] = [];

export function lastCodeFor(email: string): string {
  const mail = outbox.findLast((m) => m.to === email);
  if (!mail) throw new Error(`No email sent to ${email}`);
  return mail.code;
}

export function lastLinkTokenFor(email: string): string {
  const mail = outbox.findLast((m) => m.to === email);
  if (!mail) throw new Error(`No email sent to ${email}`);
  return mail.linkToken;
}

/** Security notices "sent" during a test. */
export const alerts: { to: string; device: string; ip: string; penName: string | null; reason: string }[] = [];

/** Welcome emails "sent" during a test. */
export const welcomes: { to: string; penName: string; slug: string }[] = [];

/** "A recovery code was used" and "recovery codes changed" notices "sent" during a test. */
export const recoveryNotices: (
  | { to: string; kind: "used"; device: string; remaining: number; at: Date; penName: string | null }
  | { to: string; kind: "changed"; device: string; firstSet: boolean; at: Date; penName: string | null }
)[] = [];

/** Step-up confirmation codes "sent" during a test. */
export const stepUpCodes: { to: string; code: string }[] = [];

export function lastStepUpCodeFor(email: string): string {
  const mail = stepUpCodes.findLast((m) => m.to === email);
  if (!mail) throw new Error(`No step-up email sent to ${email}`);
  return mail.code;
}

/** "Passkey added" / "passkey removed" notices "sent" during a test. */
export const passkeyNotices: (
  | { to: string; kind: "added"; passkeyName: string; device: string; afterRecovery: boolean; at: Date; penName: string | null }
  | { to: string; kind: "removed"; passkeyName: string; device: string; at: Date; penName: string | null }
)[] = [];

/** "Your account was deleted" notices "sent" during a test. */
export const deletionNotices: { to: string; penName: string | null; device: string; at: Date }[] = [];
