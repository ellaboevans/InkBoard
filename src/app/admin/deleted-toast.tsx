"use client";

import { useOnceToast } from "@/hooks/use-once-toast";

/** One-off toast after a delete redirect (`/admin?deleted=1`). */
export function DeletedToast() {
  useOnceToast("Poem deleted", "deleted");
  return null;
}
