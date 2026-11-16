/**
 * Session cookie name. `__Host-` pins the cookie to this exact origin
 * (Secure, Path=/, no Domain) in production. Plain HTTP dev servers can't
 * set Secure cookies reliably, so a plain name is used there.
 *
 * Kept free of server-only imports so `proxy.ts` can share it.
 */
export const SESSION_COOKIE =
  process.env.NODE_ENV === "production"
    ? "__Host-poemhub_session"
    : "poemhub_session";

/**
 * Long-lived random id for this browser, used only to tell an editor when
 * their account is signed in to from a device it hasn't seen (sign-in-alerts.ts).
 * Not tied to a session: it survives sign-out, so signing back in on the same
 * browser stays quiet. Same `__Host-` rule as the session cookie.
 */
export const DEVICE_COOKIE =
  process.env.NODE_ENV === "production"
    ? "__Host-poemhub_device"
    : "poemhub_device";

/** The device cookie's lifetime (two years), refreshed at every sign-in on that browser. */
export const DEVICE_COOKIE_MAX_AGE = 2 * 365 * 24 * 60 * 60;
