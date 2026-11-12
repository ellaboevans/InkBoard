"use client";

import { Toaster as SileoToaster } from "sileo";

/**
 * App-wide toasts (Sileo), top-centre on every screen size. Call them via
 * `notify` from src/lib/notify.ts rather than importing sileo directly.
 */
export function Toaster() {
  return (
    <SileoToaster
      position="top-center"
      offset={{ top: "max(0.5rem, env(safe-area-inset-top))" }}
      options={{ duration: 5000 }}
    />
  );
}
