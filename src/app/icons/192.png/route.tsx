import { appIconResponse } from "@/components/brand/app-icon";

/** Manifest icon, 192×192, purpose "any" (prerendered; see src/components/brand/app-icon.tsx). */
export function GET() {
  return appIconResponse(192, "any");
}
