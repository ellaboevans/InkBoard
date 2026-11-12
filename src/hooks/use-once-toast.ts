"use client";

import { useEffect, useRef } from "react";
import { notify } from "@/lib/notify";

/**
 * Show a success toast once for a "flash" query param (e.g. `?created=1`)
 * set by a redirecting Server Action, then strip the param from the URL.
 *
 * The ref guard matters: effects run twice under StrictMode and re-run when
 * Next re-shows a route preserved in <Activity>, but refs survive both.
 */
export function useOnceToast(message: string | null, param: string, description?: string) {
  const shown = useRef(false);
  useEffect(() => {
    if (!message || shown.current) return;
    shown.current = true;
    notify.success(message, description);
    const url = new URL(window.location.href);
    url.searchParams.delete(param);
    window.history.replaceState(window.history.state, "", url);
  }, [message, param, description]);
}
