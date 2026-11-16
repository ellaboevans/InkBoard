import { appIconResponse } from "@/components/brand/app-icon";

/** Notification badge, 96×96, white on transparency (Phase 18; Android's status bar uses its alpha only). */
export function GET() {
  return appIconResponse(96, "badge");
}
