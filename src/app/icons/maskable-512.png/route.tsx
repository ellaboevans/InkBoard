import { appIconResponse } from "@/components/brand/app-icon";

/** Manifest icon, 512×512, purpose "maskable" (prerendered; see src/components/brand/app-icon.tsx). */
export function GET() {
  return appIconResponse(512, "maskable");
}
