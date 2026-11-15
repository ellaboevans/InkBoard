import { browserSupportsWebAuthn, WebAuthnError } from "@simplewebauthn/browser";
import { useSyncExternalStore } from "react";

/*
 * Browser-side helpers for passkeys (docs/PLAN.md, Phase 16 round 2).
 * Client components only.
 */

const noSubscribe = () => () => {};

/**
 * Whether this browser can use WebAuthn at all. False on the server and in
 * the first client render (so hydration matches), then the real answer.
 * Passkey buttons render only when it's true.
 */
export function useWebAuthnSupport(): boolean {
  return useSyncExternalStore(noSubscribe, browserSupportsWebAuthn, () => false);
}

/**
 * The person closed or cancelled the browser's passkey prompt (or we aborted
 * it to start another one, e.g. the autofill request when the button is
 * pressed). Not an error: the UI just goes back to how it was.
 */
export function isCancelled(err: unknown): boolean {
  const names = ["NotAllowedError", "AbortError"];
  if (err instanceof WebAuthnError) {
    if (err.code === "ERROR_CEREMONY_ABORTED") return true;
    const cause = err.cause as { name?: string } | undefined;
    return names.includes(err.name) || (cause?.name !== undefined && names.includes(cause.name));
  }
  return err instanceof Error && names.includes(err.name);
}

/** This authenticator already holds one of the editor's passkeys (excludeCredentials matched). */
export function isAlreadyRegistered(err: unknown): boolean {
  return (
    (err instanceof WebAuthnError && err.code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED") ||
    (err instanceof Error && err.name === "InvalidStateError")
  );
}
