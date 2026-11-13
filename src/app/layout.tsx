import type { Metadata } from "next";
import { Geist, Geist_Mono, Newsreader } from "next/font/google";
import { Toaster } from "@/components/toaster";
import "./globals.css";

const sans = Geist({ variable: "--font-sans", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
// Literary serif for poem titles and bodies.
const serif = Newsreader({
  variable: "--font-serif",
  subsets: ["latin"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: { default: "InkBoard", template: "%s · InkBoard" },
  description: "A living board of poems, catalogued by author.",
};

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
