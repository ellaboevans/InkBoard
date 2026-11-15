import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Newsreader } from "next/font/google";
import localFont from "next/font/local";
import { Analytics } from "@/components/analytics";
import { InstallNudgeHost } from "@/components/install/install-nudge";
import { Toaster } from "@/components/toaster";
import { BASE_OPEN_GRAPH, BRAND, SITE_DESCRIPTION, SITE_NAME, siteUrl } from "@/lib/site";
import "./globals.css";

/*
 * Fonts. Only the Latin subsets are preloaded (listing a subset preloads it);
 * next/font still declares the others with a unicode-range, so a browser
 * fetches them only for a page that has such a letter.
 *
 * Newsreader and Geist have no Ɛ ɛ Ɔ ɔ Ɖ ɖ Ƒ Ɣ ɣ Ʋ ʋ Ʒ ʒ or most IPA, so
 * Ghanaian-language poems (Ewe, Twi/Akan, Nzema, Ga) and IPA borrowed
 * whatever font the system had, mid-word. SIL's Gentium Book Plus (serif) and
 * Andika (sans) were made for exactly these alphabets, so they follow in the
 * stacks and supply only the missing letters (docs/PLAN.md, Phase 11).
 *
 * They're self-hosted (src/assets/fonts/web): Google Fonts' copies drop the
 * IPA Extensions block, which is where the lowercase ɛ ɔ ɖ ɣ ʋ ʒ live. The
 * files are subsets of SIL's full fonts without plain Latin (the main fonts
 * have it), with a matching unicode-range and no preload, so most visitors
 * never download them.
 */
// Both extension fonts: unicode-range below = these ranges (next/font needs literal options).
// U+0100-02FF, U+0300-036F, U+0370-03FF, U+1D00-1DFF, U+1E00-1EFF, U+2C60-2C7F, U+A720-A7FF
const sans = Geist({ subsets: ["latin"] });
const sansExt = localFont({
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "unicode-range", value: "U+0100-02FF, U+0300-036F, U+0370-03FF, U+1D00-1DFF, U+1E00-1EFF, U+2C60-2C7F, U+A720-A7FF" },
  ],
  src: [
    { path: "../assets/fonts/web/Andika-Regular.woff2", weight: "400", style: "normal" },
    { path: "../assets/fonts/web/Andika-Bold.woff2", weight: "700", style: "normal" },
  ],
});
const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
// Literary serif for poem titles and bodies.
const serif = Newsreader({ subsets: ["latin"], style: ["normal", "italic"] });
const serifExt = localFont({
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "unicode-range", value: "U+0100-02FF, U+0300-036F, U+0370-03FF, U+1D00-1DFF, U+1E00-1EFF, U+2C60-2C7F, U+A720-A7FF" },
  ],
  src: [
    { path: "../assets/fonts/web/GentiumBookPlus-Regular.woff2", weight: "400", style: "normal" },
    { path: "../assets/fonts/web/GentiumBookPlus-Italic.woff2", weight: "400", style: "italic" },
    { path: "../assets/fonts/web/GentiumBookPlus-Bold.woff2", weight: "700", style: "normal" },
    { path: "../assets/fonts/web/GentiumBookPlus-BoldItalic.woff2", weight: "700", style: "italic" },
  ],
});
/*
 * Ƒ ƒ (U+0191-0192) come from the SIL fonts even though Newsreader and Geist
 * have them: they draw ƒ as the slanted florin currency sign, so Ewe words
 * like "ƒe" looked italic mid-line (found in the Phase 11b preview). Same
 * files as above, so nothing extra is downloaded; listed first in the stacks.
 */
const sansF = localFont({
  preload: false,
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+0191-0192" }],
  src: [
    { path: "../assets/fonts/web/Andika-Regular.woff2", weight: "400", style: "normal" },
    { path: "../assets/fonts/web/Andika-Bold.woff2", weight: "700", style: "normal" },
  ],
});
const serifF = localFont({
  preload: false,
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+0191-0192" }],
  src: [
    { path: "../assets/fonts/web/GentiumBookPlus-Regular.woff2", weight: "400", style: "normal" },
    { path: "../assets/fonts/web/GentiumBookPlus-Italic.woff2", weight: "400", style: "italic" },
    { path: "../assets/fonts/web/GentiumBookPlus-Bold.woff2", weight: "700", style: "normal" },
    { path: "../assets/fonts/web/GentiumBookPlus-BoldItalic.woff2", weight: "700", style: "italic" },
  ],
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

/**
 * `ƒ override, main, ext, main's fallback`. next/font follows each font
 * with a metric-matched local fallback (e.g. Times New Roman), which keeps
 * text from jumping while the web font loads. Left in place it would also
 * answer for Ɛ/Ɔ/… before Gentium or Andika (measured in Chrome), so the
 * extension font goes between the main font and those fallbacks.
 */
type LoadedFont = { style: { fontFamily: string } };
const family = (f: LoadedFont) => f.style.fontFamily.split(/,\s*/)[0];
function fontStack(override: LoadedFont, main: LoadedFont, ext: LoadedFont) {
  const [mainFamily, ...mainFallbacks] = main.style.fontFamily.split(/,\s*/);
  return [family(override), mainFamily, family(ext), ...mainFallbacks].join(", ");
}
const fontStacks = {
  "--font-sans-stack": fontStack(sansF, sans, sansExt),
  "--font-serif-stack": fontStack(serifF, serif, serifExt),
} as React.CSSProperties;

export const viewport: Viewport = { themeColor: BRAND.paper, colorScheme: "light" };

export default function RootLayout({ children, modal }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${mono.variable} h-full antialiased`}
      style={fontStacks}
    >
      <body className="flex min-h-full flex-col">
        {/* Catches `beforeinstallprompt` (install nudge, docs/PLAN.md Phase 15). An async
            src script is a React resource: hoisted into <head> on the server and run before
            the page's load event (Chrome fires the event after it), and never re-created as
            a raw <script> on the client, which React warns about. An inline script, or
            next/script's beforeInteractive, renders one. Static: prerendering is unaffected. */}
        <script async src="/install-capture.js" />
        {children}
        {/* Poem overlay over the board (src/app/@modal). */}
        {modal}
        {/* Client-only: renders nothing until the browser says a card is due. */}
        <InstallNudgeHost />
        <Toaster />
        <Analytics />
      </body>
    </html>
  );
}
