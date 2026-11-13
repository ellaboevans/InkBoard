import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Newsreader } from "next/font/google";
import { Toaster } from "@/components/toaster";
import { BASE_OPEN_GRAPH, BRAND, SITE_DESCRIPTION, SITE_NAME, siteUrl } from "@/lib/site";
import "./globals.css";

const sans = Geist({ variable: "--font-sans", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
// Literary serif for poem titles and bodies.
const serif = Newsreader({
  variable: "--font-serif",
  subsets: ["latin"],
  style: ["normal", "italic"],
});

// Icons, the manifest and the default share image come from file conventions
// in this folder (icon.svg, favicon.ico, apple-icon.tsx, manifest.ts,
// opengraph-image.tsx); child segments inherit openGraph/twitter below.
export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: { default: `${SITE_NAME}: a living board of poems`, template: `%s · ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: ["poems", "poetry", "poets", "poetry board", "read poetry online", SITE_NAME],
  // No relative canonical/og:url here: on dynamic routes (the intercepted poem
  // overlay) Next would resolve it against the request path, which blocks
  // prerendering. Pages set their own canonical instead.
  openGraph: { ...BASE_OPEN_GRAPH, type: "website" },
  twitter: { card: "summary_large_image" },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large" } },
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport: Viewport = { themeColor: BRAND.paper, colorScheme: "light" };

export default function RootLayout({ children, modal }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${mono.variable} ${serif.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        {children}
        {/* Poem overlay over the board (src/app/@modal). */}
        {modal}
        <Toaster />
      </body>
    </html>
  );
}
