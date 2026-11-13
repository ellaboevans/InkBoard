import { ImageResponse } from "next/og";
import { LogoMark } from "@/components/brand/og-card";
import { BRAND } from "@/lib/site";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** iOS home-screen icon: the logo mark, full-bleed (iOS rounds the corners itself). */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: BRAND.primary }}>
        <LogoMark size={180} />
      </div>
    ),
    size,
  );
}
