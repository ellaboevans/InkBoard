import { ArrowLeftIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { OfflineIndicator } from "@/components/offline/offline-indicator";
import { OfflineMarker } from "@/components/offline/offline-marker";
import { SaveForOffline } from "@/components/offline/save-for-offline";
import { SiteLinks } from "@/components/site-links";
import { Button } from "@/components/ui/button";
import { PRIVACY_FACTS as F, PRIVACY_UPDATED } from "@/lib/privacy-facts";
import { BASE_OPEN_GRAPH, PRIVACY_CONTACT_EMAIL, SITE_NAME, SITE_OPERATOR, WALKTHROUGH_VIDEO } from "@/lib/site";

/*
 * The Privacy page (docs/PLAN.md, Phase 19), written from the code: the
 * schema, src/server, src/lib, the cookies, the service worker and the
 * analytics component. Every period and number comes from PRIVACY_FACTS
 * (src/lib/privacy-facts.ts), which a test ties to the constants in the code;
 * this file writes none of its own. Whenever what InkBoard stores changes,
 * this page changes with it, and so does PRIVACY_UPDATED.
 *
 * No legal claims: no laws cited, no rights promised. Just what happens.
 */

const title = "Privacy";
const description = `What ${SITE_NAME} stores, why, and for how long, for readers, writers and their devices.`;

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/privacy" },
  openGraph: { ...BASE_OPEN_GRAPH, type: "website", url: "/privacy", title: `${title} · ${SITE_NAME}`, description },
  twitter: { card: "summary_large_image", title: `${title} · ${SITE_NAME}`, description },
};

const updated = new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "UTC" }).format(new Date(PRIVACY_UPDATED));

function Mail() {
  return (
    <a href={`mailto:${PRIVACY_CONTACT_EMAIL}`} className="text-foreground underline underline-offset-4">
      {PRIVACY_CONTACT_EMAIL}
    </a>
  );
}

function Section({ id, heading, children }: { id: string; heading: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="grid scroll-mt-8 gap-4">
      <h2 id={`${id}-heading`} className="font-serif text-2xl sm:text-3xl">
        {heading}
      </h2>
      {children}
    </section>
  );
}

function Sub({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2">
      <h3 className="font-medium">{heading}</h3>
      {children}
    </div>
  );
}

const list = "grid list-disc gap-2 pl-5 marker:text-muted-foreground";
const code = "rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]";

export default function PrivacyPage() {
  return (
    <main className="flex-1 bg-background">
      <OfflineMarker save kind="page" title="Privacy" />
      <SaveForOffline path="/privacy" />
      <OfflineIndicator className="pointer-events-none fixed inset-x-4 bottom-4 z-30" />
      <article className="mx-auto grid max-w-2xl gap-12 px-6 py-10 leading-relaxed sm:py-16">
        <header>
          <Button asChild variant="ghost" size="sm" className="-ml-2 mb-8">
            <Link href="/">
              <ArrowLeftIcon />
              Back to the board
            </Link>
          </Button>
          <h1 className="font-serif text-4xl leading-tight sm:text-5xl">Privacy</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Updated <time dateTime={PRIVACY_UPDATED}>{updated}</time>
          </p>
          <p className="mt-6">
            {SITE_NAME} is run by {SITE_OPERATOR}. This page says what {SITE_NAME} stores, why, and for how long. It’s
            written from how the site actually works, and it changes whenever that does. For questions or requests about
            your data, write to <Mail />.
          </p>
        </header>

        <Section id="short" heading="In short">
          <ul className={list}>
            <li>Reading needs no account, and nothing asks readers who they are.</li>
            <li>No ads. We don’t sell or share anyone’s data, and we don’t track you across other sites.</li>
            <li>We keep only what the site needs to work, delete what it no longer needs on a schedule, and say below how long each thing lasts.</li>
            <li>Writers can download everything they’ve written, and delete their account, whenever they like.</li>
          </ul>
        </Section>

        <Section id="reading" heading="When you read">
          <Sub heading="Visiting the site">
            <p>
              Like any website, each request reaches our host, Vercel, with your IP address and the kind of browser you
              use, which it needs to send you the page.
            </p>
          </Sub>
          <Sub heading="Page counts">
            <p>
              We count page views with Vercel Web Analytics. It uses no cookies. Before a page view leaves your browser we
              cut it down to the page’s path, removing anything after a <code className={code}>?</code> or{" "}
              <code className={code}>#</code>. Vercel uses the request to report numbers such as visits per page, and
              rough details like country, browser and kind of device.
            </p>
          </Sub>
          <Sub heading="Search">
            <p>What you type into search is used to find matching writers and titles, and isn’t stored.</p>
          </Sub>
          <Sub heading="Private poems and novels">
            <p>
              When you enter a poem’s or a novel’s password correctly, your browser keeps a cookie for {F.unlockLife} that
              lists which poems and novels (or which writer’s) you’ve unlocked and until when. It’s signed so it can’t be
              forged, and it never contains the password. If the writer changes the password, it stops working sooner.
            </p>
          </Sub>
          <Sub heading="Notifications about new poems">
            <p>
              Notifications are off until you turn them on. Then your browser gives us a delivery address for this
              device, issued by its push service (Google, Apple, Mozilla or Microsoft), and we store that address, the
              keys that encrypt messages to it, when we last sent to it, whether you want every new poem or only those by
              writers you follow, and which writers you follow. New chapters of novels are sent only to the writers’
              followers. We don’t store your name, email or location, and the address isn’t linked to an account.
            </p>
            <p>
              To keep to our limits on how often we notify you, we note which notifications went to each address, and a
              daily clean-up deletes those notes after {F.pushDeliveryCleanup}. Each notification carries only a poem’s
              title (or a novel’s title and the chapter’s number), its writer’s name and a link, never a private poem, a
              chapter of a private novel or any of a chapter’s text, and it’s encrypted on its way through the push
              service.
            </p>
            <p>
              Turning notifications off deletes the address and the writers it follows. So does the push service telling
              us the address no longer works, and the daily clean-up deletes addresses we haven’t been able to use for{" "}
              {F.unusedSubscription}.
            </p>
          </Sub>
          <Sub heading="Short links on shared pictures">
            <p>
              A picture of a public poem carries a short address (like /s/k3x9qm) that leads to the poem. We count
              visits through it: one number per poem, which only the poem’s writer sees, on their dashboard. To count
              each network once {F.shareVisitRepeat} per poem, we use the same kind of counter as below, named after the
              poem and the IP address (for IPv6, only its network part). Nothing else about who visited is kept, and no
              cookie is set. Link previews (such as WhatsApp drawing a preview) and browsers fetching ahead aren’t
              counted.
            </p>
          </Sub>
          <Sub heading="Limits on repeated attempts">
            <p>
              To stop abuse, such as guessing passwords or sign-in codes, or making pictures of chosen lines over and over,
              we count recent attempts. The counters are named after an IP address (for IPv6, only its network part),
              a hash of an email address, or an account, session or poem id, and the daily clean-up deletes them{" "}
              {F.rateLimitCleanup} after they start.
            </p>
          </Sub>
        </Section>

        <Section id="device" heading="On your device">
          <p>These stay in your browser. We can’t see them, and clearing this site’s data in your browser removes them.</p>
          <ul className={list}>
            <li>
              <strong className="font-medium">Copies for reading offline.</strong> {SITE_NAME}’s service worker keeps
              copies of the public pages you open (the board, public poems, writers’, collection and novel pages, the
              chapters you read, the About page and this one) so they work without a connection, and drops the oldest as
              you open more. “Save this novel for offline” asks it to keep a novel’s chapters the same way. It fetches them
              fresh, without your cookies, so a copy never holds a private poem or a private novel’s chapter, even one you
              unlocked, or anything about an account.
            </li>
            <li>
              <strong className="font-medium">Local storage.</strong> <code className={code}>inkboard-install</code>{" "}
              counts your visits and remembers which poems you’ve opened and whether you dismissed the suggestion to
              install {SITE_NAME}, to decide when to suggest it.{" "}
              <code className={code}>inkboard-push-offer</code> remembers that you answered the offer to turn on
              notifications. <code className={code}>inkboard:special-letters-tab</code> remembers the writer’s last tab of
              special letters. <code className={code}>inkboard-chapter-draft:…</code>, one per chapter, keeps the title
              and text of a chapter a writer is editing on that device until it’s saved to {SITE_NAME} (or the writer
              discards it), so a dropped connection or a closed tab doesn’t lose their work. It never leaves the browser.{" "}
              <code className={code}>inkboard-reading</code> remembers, for each novel you read, which chapter you opened
              last and when, so the novel’s page can offer to continue where you stopped. It keeps the{" "}
              {F.readingPlacesKept} novels you opened most recently and forgets older ones. It’s never sent to{" "}
              {SITE_NAME}, and no cookie carries it.
            </li>
            <li>
              <strong className="font-medium">For notifications.</strong> If they’re on, your browser also keeps your
              choice and the writers you follow (so they come back if the browser replaces its delivery address), and,
              for one visit at a time, the delivery address itself, so {SITE_NAME} checks it with us once per visit.
            </li>
          </ul>
        </Section>

        <Section id="writing" heading="When you write">
          <Sub heading="Your account">
            <p>
              Your email address, to sign you in and to send you the emails listed below. It’s never shown to readers, and
              it’s not in feeds, share cards or your downloads. Your pen name, author address, tagline, bio, picture (from{" "}
              {SITE_NAME}’s own set), links and pinned poem, which readers see on your author page. When you joined
              and last signed in. And, for the getting-started checklist on your dashboard, whether you’ve hidden or
              finished it and when you first shared your author page from it (not where or with whom). All of this
              stays until you delete your account.
            </p>
          </Sub>
          <Sub heading="Your profile photo">
            <p>
              If you upload a photo, we keep only copies we make from it: cropped to the square you chose, a few small
              sizes, with everything else in the file removed (the camera’s details, the date, where it was taken, any
              other metadata). The file you uploaded itself isn’t kept. The copies are stored with Cloudflare R2 under a
              random name that has nothing to do with your email, name or account, and served from {SITE_NAME} itself.
              Readers see it next to your pen name, and it’s in your JSON download.
            </p>
            <p>
              Remove photo, on your profile, deletes the copies from storage at once, and so does deleting your account.
              A browser that showed it may keep its copy for up to {F.photoCacheLife}; after that it shows your avatar.
              If a save is interrupted, its unused copies are deleted by the daily clean-up once they’re{" "}
              {F.photoOrphanCleanup} old. We may also remove a photo that breaks the rules of the site; your avatar
              shows instead.
            </p>
          </Sub>
          <Sub heading="Your poems">
            <p>
              Each poem’s title, text, language, whether it’s public or private, whether it’s a draft or published and
              when, and its collection; and, once a picture of it has been shared, its short address and the number of
              visits through it. Passwords for private poems (or your one shared password) are stored only as
              scrypt hashes, never as written. We keep the {F.revisionsKept} most recent earlier versions of each poem,
              which only you can see, and your collections’ titles, introductions and order. They stay until you delete
              them or your account.
            </p>
          </Sub>
          <Sub heading="Your novels">
            <p>
              Each novel’s title, blurb, language, whether it’s ongoing or complete, and whether it’s public or private
              (a private novel’s password, unless it uses your one shared password, is stored only as an scrypt hash, never
              as written), and each of its chapters: its
              title, text, place in the book, word count, and whether it’s a draft or published and when. We keep the{" "}
              {F.chapterVersionsKept} most recent versions of each chapter, which only you can see. Readers see a novel once
              one of its chapters is published, and then only its published chapters: drafts, their titles and their number
              stay with you. For a private novel they see its title, blurb and chapter list, and its chapters’ text only
              with the password. Everything stays until you
              delete it or your account. While you write a chapter, your browser also keeps a copy of it on your device
              (see “On your device”).
            </p>
          </Sub>
          <Sub heading="Signing in">
            <ul className={list}>
              <li>
                <strong className="font-medium">Sign-in codes and links.</strong> When you ask to sign in we store your
                email address, a keyed hash of the code and of the link (never the code itself), the IP address the
                request came from, and when it expires: after {F.signInCodeLife}. The daily clean-up deletes it{" "}
                {F.usedCodeCleanup} after it’s used or expires.
              </li>
              <li>
                <strong className="font-medium">Signed-in devices.</strong> Signing in puts a random token in a cookie;
                we store only a hash of it, with your browser’s description (shown to you as, say, “Chrome on macOS”),
                your IP address, and when and how you signed in. You can see these under Signed-in devices on your
                profile. A sign-in lasts {F.sessionLife}. Signing out deletes it at once, and the daily clean-up deletes
                expired ones {F.expiredSessionCleanup} after they end.
              </li>
              <li>
                <strong className="font-medium">“This isn’t my device”.</strong> Tick it when you sign in on someone
                else’s computer: the sign-in lasts {F.publicSessionLife}, its cookie goes when the browser closes, and
                nothing about that browser is remembered.
              </li>
              <li>
                <strong className="font-medium">Confirmation codes.</strong> Before some changes, like adding a passkey
                or deleting your account, we may email you a code to confirm it’s you. It’s kept the same way as a
                sign-in code, tied to that sign-in, and expires after {F.stepUpCodeLife}.
              </li>
              <li>
                <strong className="font-medium">New sign-in alerts.</strong> So we can tell you when your account is
                signed in to from a device or network we haven’t seen you use, your browser keeps a random id in a
                cookie for {F.deviceCookieLife}, renewed whenever you sign in there. We store keyed hashes of that id and
                of your network, never the id or IP address itself, and forget each one when it hasn’t been used for{" "}
                {F.signInMemory}. The alert email itself shows the device and IP address of that sign-in.
              </li>
              <li>
                <strong className="font-medium">Recovery codes.</strong> You get {F.recoveryCodesPerSet} at a time and
                see them once. We store only keyed hashes of them and when each was used; making a new set deletes the
                old one.
              </li>
              <li>
                <strong className="font-medium">Passkeys.</strong> We store only the public part: the passkey’s id and
                public key, a counter, what kind of passkey it is and whether it’s synced, how your device reaches it,
                the name you give it, and when it was added and last used. Your fingerprint, face or device PIN never
                leave your device. While you sign in or add one, a one-time challenge and a cookie last{" "}
                {F.passkeyChallengeLife}.
              </li>
            </ul>
          </Sub>
          <Sub heading="Emails we send">
            <p>
              Sign-in codes and links, confirmation codes, one welcome, new sign-in alerts, notices when a recovery code
              is used, when you make new recovery codes and when a passkey is added or removed, and a notice when your
              account is deleted. No newsletters, no marketing.
            </p>
          </Sub>
          <Sub heading="Deleting your account">
            <p>
              Delete account, in Settings, removes all of this at once: your profile, poems with their earlier versions,
              collections, novels with their chapters and their earlier versions, signed-in devices, passkeys, recovery codes, sign-in alert records, sign-in codes sent to your
              email, attempt counters that name you or your poems, your poems’ visit counts, your profile photo’s files,
              and readers’ follows of you.
              We keep only your old author address and your poems’ short addresses on a list, so they’re never given to
              someone else.
            </p>
            <p>
              Some copies are outside our database: emails we’ve already sent stay in your inbox, readers’ offline copies
              of your poems stay in their browsers until those are refreshed, and our database provider’s short restore
              history lets deleted data age out rather than vanish at that moment.
            </p>
          </Sub>
        </Section>

        <Section id="cookies" heading="Cookies">
          <p>
            {SITE_NAME} sets only its own cookies, and only these. Scripts can’t read them, and they’re sent only to{" "}
            {SITE_NAME}. On the live site their names start with <code className={code}>__Host-</code>.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b text-muted-foreground">
                <tr>
                  <th scope="col" className="py-2 pr-4 font-medium">Cookie</th>
                  <th scope="col" className="py-2 pr-4 font-medium">What it’s for</th>
                  <th scope="col" className="py-2 font-medium">How long</th>
                </tr>
              </thead>
              <tbody className="divide-y align-top">
                <tr>
                  <td className="py-2 pr-4"><code className={code}>poemhub_session</code></td>
                  <td className="py-2 pr-4">Keeps a writer signed in</td>
                  <td className="py-2">{F.sessionLife}, or until the browser closes with “This isn’t my device”</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4"><code className={code}>poemhub_device</code></td>
                  <td className="py-2 pr-4">New sign-in alerts</td>
                  <td className="py-2">{F.deviceCookieLife}</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4"><code className={code}>poemhub_unlock</code></td>
                  <td className="py-2 pr-4">Private poems you’ve unlocked</td>
                  <td className="py-2">{F.unlockLife}</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4"><code className={code}>poemhub_webauthn_…</code></td>
                  <td className="py-2 pr-4">While you sign in with or add a passkey</td>
                  <td className="py-2">{F.passkeyChallengeLife}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Section>

        <Section id="services" heading="Services we use">
          <ul className={list}>
            <li>
              <strong className="font-medium">Vercel</strong> hosts the site and counts page views. It receives every
              request (your IP address, your browser, the page) and keeps its own logs of them for a limited time.
            </li>
            <li>
              <strong className="font-medium">Neon</strong> is our database: everything above that we keep is stored
              there.
            </li>
            <li>
              <strong className="font-medium">Cloudflare R2</strong> stores writers’ profile photos (the processed copies
              described above). Readers’ browsers never contact it: photos are served through {SITE_NAME}.
            </li>
            <li>
              <strong className="font-medium">Resend</strong> sends our emails, so it receives your email address and
              each email’s contents.
            </li>
            <li>
              <strong className="font-medium">Your browser’s push service</strong> (Google, Apple, Mozilla or
              Microsoft, depending on your browser) delivers notifications if you turn them on. It issues the delivery
              address and passes on each notification, which is encrypted so it can’t read it.
            </li>
            {WALKTHROUGH_VIDEO && (
              <li>
                <strong className="font-medium">ImageKit</strong> hosts the walkthrough video on the About page and
                streams it from ik.imagekit.io once you press play; nothing is loaded from ImageKit before that. Like
                any website, it then receives your IP address, your browser and the video’s address.
              </li>
            )}
          </ul>
          <p>
            Our fonts, images and scripts are served from {SITE_NAME} itself; no other service receives anything from your
            visit{WALKTHROUGH_VIDEO ? ", unless you play the walkthrough video" : ""}.
          </p>
        </Section>

        <Section id="choices" heading="What you can do">
          <Sub heading="Anyone">
            <ul className={list}>
              <li>Turn notifications off in the Subscribe menu on the board, or in your browser’s settings for this site.</li>
              <li>Clear this site’s data in your browser to remove offline copies, unlocked poems and remembered choices.</li>
            </ul>
          </Sub>
          <Sub heading="Writers">
            <ul className={list}>
              <li>Edit or delete your poems and profile whenever you like, and remove your profile photo.</li>
              <li>Download everything you’ve written, as Markdown or JSON, under Settings, then Download your poems.</li>
              <li>Delete your account, under Settings.</li>
              <li>Sign out other devices, remove passkeys and replace recovery codes, on your profile.</li>
            </ul>
          </Sub>
          <Sub heading="Write to us">
            <p>
              Email <Mail /> for anything else about your data: a copy of what we hold about you that the download leaves
              out (such as your signed-in devices), something you can’t correct yourself, deleting an account you can’t
              sign in to, or any question. We may ask you to confirm the request from the email address on the account.
            </p>
          </Sub>
        </Section>

        <Section id="changes" heading="Changes to this page">
          <p>
            This page changes whenever what {SITE_NAME} stores changes, and the date at the top shows the last update.
          </p>
        </Section>

        <footer className="border-t pt-6">
          <SiteLinks />
        </footer>
      </article>
    </main>
  );
}
