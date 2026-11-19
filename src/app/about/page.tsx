import { ArrowLeftIcon, FeatherIcon, PenLineIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { WalkthroughVideo } from "@/components/about/walkthrough-video";
import { OfflineIndicator } from "@/components/offline/offline-indicator";
import { OfflineMarker } from "@/components/offline/offline-marker";
import { SaveForOffline } from "@/components/offline/save-for-offline";
import { JsonLd } from "@/components/seo/json-ld";
import { Button } from "@/components/ui/button";
import { absoluteUrl, BASE_OPEN_GRAPH, SITE_NAME, SITE_OPERATOR, WALKTHROUGH_VIDEO } from "@/lib/site";

/*
 * What InkBoard is, in one link the owner can send anyone (docs/PLAN.md,
 * Phase 19). Fully static: prerendered, saved for offline reading like the
 * other reader pages. Only claim what the app really does: no user numbers,
 * no "first" or "only".
 */

const title = "About InkBoard";
const description =
  "InkBoard is a home for poetry in Ghanaian languages and English: free to read without an account, and a quiet place for writers to publish.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/about" },
  openGraph: { ...BASE_OPEN_GRAPH, type: "website", url: "/about", title, description },
  twitter: { card: "summary_large_image", title, description },
};

function Section({ id, heading, children }: { id: string; heading: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="grid gap-4">
      <h2 id={id} className="font-serif text-2xl sm:text-3xl">
        {heading}
      </h2>
      {children}
    </section>
  );
}

function Points({ items }: { items: { lead: string; text: React.ReactNode }[] }) {
  return (
    <ul className="grid gap-3">
      {items.map(({ lead, text }) => (
        <li key={lead} className="leading-relaxed">
          <strong className="font-medium">{lead}</strong> {text}
        </li>
      ))}
    </ul>
  );
}

export default function AboutPage() {
  return (
    <main className="flex-1 bg-background">
      <OfflineMarker save kind="page" title={title} />
      <SaveForOffline path="/about" />
      <OfflineIndicator className="pointer-events-none fixed inset-x-4 bottom-4 z-30" />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "AboutPage",
          name: title,
          description,
          url: absoluteUrl("/about"),
          isPartOf: { "@type": "WebSite", name: SITE_NAME, url: absoluteUrl("/") },
        }}
      />
      <div className="mx-auto grid max-w-2xl gap-12 px-6 py-10 sm:py-16">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-2 mb-8">
            <Link href="/">
              <ArrowLeftIcon />
              Back to the board
            </Link>
          </Button>
          <h1 className="font-serif text-4xl leading-tight sm:text-5xl">About InkBoard</h1>
          <p className="mt-4 font-serif text-xl leading-relaxed text-muted-foreground">
            A home for poetry in Ghanaian languages and English. Poems in Ewe, Twi, Fante, Ga and Nzema sit on the board
            beside poems in English, each written with its own letters and tone marks.
          </p>
        </div>

        <WalkthroughVideo video={WALKTHROUGH_VIDEO} />

        <Section id="why" heading="What it’s for">
          <Points
            items={[
              {
                lead: "Free to read.",
                text: "Anyone can read the board without an account. Nothing asks readers for a name or an email address.",
              },
              {
                lead: "A quiet place to write.",
                text: "There are no likes, comments, follower counts or ads. Writers publish poems, readers read them, and that’s all.",
              },
              {
                lead: "Your own letters.",
                text: (
                  <>
                    Ɛ ɛ, Ɔ ɔ, Ŋ ŋ, Ɖ ɖ, Ƒ ƒ, Ɣ ɣ, Ʋ ʋ and tone marks show properly everywhere on the site, in links
                    and in search. Linguists can write in IPA too.
                  </>
                ),
              },
            ]}
          />
        </Section>

        <Section id="readers" heading="How it works for readers">
          <Points
            items={[
              {
                lead: "Wander the board.",
                text: "Each writer has a section of their own. Drag to move around, pinch or scroll to zoom, or switch to the list view. Search finds writers and poem titles, and you can show only the poems in one language.",
              },
              {
                lead: "Read novels, chapter by chapter.",
                text: (
                  <>
                    Some writers publish serial novels. The{" "}
                    <Link href="/novels" className="underline underline-offset-4">
                      Novels
                    </Link>{" "}
                    page lists the ones still being written, most recently updated first, and remembers on this device
                    where you stopped.
                  </>
                ),
              },
              {
                lead: "Some poems are private.",
                text: "You’ll see their title and author; the writer shares a password with the people they’d like to read them.",
              },
              {
                lead: "Keep up with new poems.",
                text: "Every writer has a page and a feed for feed readers. You can also turn on notifications on your phone or computer, for every new poem or only for the writers you follow.",
              },
              {
                lead: "Take it with you.",
                text: "InkBoard can be installed like an app, and the public poems you’ve opened recently stay readable when you’re offline.",
              },
            ]}
          />
        </Section>

        <Section id="writers" heading="How it works for writers">
          <Points
            items={[
              {
                lead: "Sign in with your email.",
                text: "We send you a one-time code; your account is made the first time you use one. There’s no password to remember, and you can add a passkey or keep recovery codes for days when your email isn’t to hand.",
              },
              {
                lead: "Choose a pen name.",
                text: "It labels your section of the board and your author page.",
              },
              {
                lead: "Write, then publish.",
                text: "Drafts stay with you until you publish them. Line breaks and indentation are kept as you type them, with italics and bold if you want them. Earlier versions of each poem are saved, and you can gather poems into collections to be read in order.",
              },
              {
                lead: "Public or private.",
                text: "Each poem is open to everyone or protected by a password you choose.",
              },
              {
                lead: "Your work stays yours.",
                text: "Download everything you’ve written whenever you like, or delete your account and everything in it.",
              },
            ]}
          />
        </Section>

        <section aria-labelledby="start" className="grid gap-5 rounded-2xl border bg-card p-6 sm:p-8">
          <h2 id="start" className="font-serif text-2xl sm:text-3xl">
            Come and read, come and write
          </h2>
          <p className="leading-relaxed">
            The board is open. Wander it and read something new, and if you write poems, in any of these languages, add
            your own.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button asChild>
              <Link href="/">
                <FeatherIcon />
                Read the board
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/sign-in">
                <PenLineIcon />
                Start writing
              </Link>
            </Button>
          </div>
        </section>

        <footer className="border-t pt-6">
          <p className="text-sm text-muted-foreground">
            InkBoard is run by {SITE_OPERATOR}. What it stores, and why, is on the{" "}
            <Link href="/privacy" className="text-foreground underline underline-offset-4">
              privacy page
            </Link>
            .
          </p>
        </footer>
      </div>
    </main>
  );
}
