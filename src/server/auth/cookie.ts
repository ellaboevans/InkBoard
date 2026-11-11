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
