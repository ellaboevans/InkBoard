"use client";

import { useOnceToast } from "@/hooks/use-once-toast";

/** One-off success toast for a redirect flash param (e.g. `?deleted=1`). */
export function FlashToast({
  param,
  title,
  description,
}: {
  param: string;
  title: string;
  description?: string;
}) {
  useOnceToast(title, param, description);
  return null;
}
