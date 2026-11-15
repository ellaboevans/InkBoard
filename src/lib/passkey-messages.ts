/** Passkey wording shared by the profile panel and the dashboard offer. */

/** Why a "This isn't my device" session can't add a passkey (passkeyGate in passkeys.ts). */
export const PUBLIC_DEVICE_PASSKEY =
  "You signed in with “This isn't my device”, so a passkey can't be added here: it would stay on this computer, and anyone who uses it after you could sign in as you.";

/** The one calm message for a failed passkey sign-in (unknown, removed, wrong site, bad signature…). */
export const PASSKEY_SIGN_IN_FAILED = "That passkey didn't work here. Try again, or sign in with your email.";
