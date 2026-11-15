"use client";

import { useEffect, useRef } from "react";
import { notify } from "@/lib/notify";

const PARAM = "account-deleted";

/**
 * "Your account was deleted" on the board, after the full page load that ends
 * a deletion (`/?account-deleted=1`, Phase 17). The board page is prerendered,
 * so the flag is read in the browser instead of through searchParams (which
 * would make the page dynamic). Once only (ref guard, as in useOnceToast),
 * then the param is stripped.
 */
export function AccountDeletedFlash() {
  const shown = useRef(false);
  useEffect(() => {
    if (shown.current) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get(PARAM) !== "1") return;
    shown.current = true;
    notify.success("Your account was deleted", "Your poems are no longer on InkBoard. Thank you for writing here.");
    url.searchParams.delete(PARAM);
    window.history.replaceState(window.history.state, "", url);
  }, []);
  return null;
}
