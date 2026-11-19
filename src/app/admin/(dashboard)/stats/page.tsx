import { LockIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { pluralCount } from "@/lib/plural";
import { PRIVACY_FACTS } from "@/lib/privacy-facts";
import { FOLLOWER_THRESHOLD, type WriterStats } from "@/lib/writer-stats";
import { requireOnboardedEditor } from "@/server/auth/dal";
import { getWriterStats } from "@/server/writer-stats";

export const metadata: Metadata = { title: "Stats" };

/*
 * Stats for writers (docs/PLAN.md, Phase 27): one screen, phones first, of
 * numbers InkBoard already keeps (src/server/writer-stats.ts), each explained
 * in plain words so it isn't misread. The writer's own only: the editor comes
 * from the DAL. Nothing here counts page views or reading: InkBoard doesn't
 * keep those.
 */
export default function StatsPage() {
  return (
    <div className="mx-auto grid w-full max-w-2xl gap-10">
      <div>
        <h1 className="font-serif text-3xl">Stats</h1>
        <p className="mt-1 text-muted-foreground">
          How your poems and novels are doing, from what InkBoard already keeps. Only you see these. InkBoard doesn&apos;t
          count page views or how far anyone reads.
        </p>
      </div>
      <Suspense fallback={<div className="h-96 animate-pulse rounded-xl bg-muted" />}>
        <Stats />
      </Suspense>
    </div>
  );
}

async function Stats() {
  const editor = await requireOnboardedEditor();
  const stats = await getWriterStats(editor.id);
  return (
    <>
      <Followers followers={stats.followers} />
      <SharedLinks links={stats.links} />
      <Novels novels={stats.novels} />
    </>
  );
}

const section = "grid gap-3";
const card = "rounded-xl border bg-card p-4 sm:p-5";
const explain = "text-sm text-muted-foreground";

function Followers({ followers }: { followers: WriterStats["followers"] }) {
  return (
    <section aria-labelledby="followers-heading" className={section}>
      <h2 id="followers-heading" className="font-serif text-2xl">
        Followers
      </h2>
      <div className={card}>
        <p data-stat="followers" className="font-serif text-4xl tabular-nums">
          {followers.kind === "count" ? followers.devices.toLocaleString("en") : `Fewer than ${FOLLOWER_THRESHOLD}`}
        </p>
        <p className="mt-1 font-medium">
          {followers.kind === "count" && followers.devices === 1 ? "device follows you" : "devices follow you"}
        </p>
        <p className={`mt-2 ${explain}`}>
          Phones and computers where someone turned on notifications for your new work. It counts devices, not people:
          one reader with a phone and a laptop counts twice. Below {FOLLOWER_THRESHOLD} it says &ldquo;fewer than{" "}
          {FOLLOWER_THRESHOLD}&rdquo;, so a small number can&apos;t point to anyone. InkBoard knows nothing else about
          these devices.
        </p>
      </div>
    </section>
  );
}

function SharedLinks({ links }: { links: WriterStats["links"] }) {
  const total = links.reduce((n, l) => n + l.visits, 0);
  return (
    <section aria-labelledby="links-heading" className={section}>
      <h2 id="links-heading" className="font-serif text-2xl">
        Shared links
      </h2>
      <p className={explain}>
        Every picture you or a reader shares prints a short link (like <span className="font-mono">/s/abcdef</span>). A
        visit is someone opening it. Each network counts once per work in {PRIVACY_FACTS.shareVisitRepeat}, and link
        previews (WhatsApp, Slack and others fetching it to draw a card) don&apos;t count. Most visited first.
      </p>
      {links.length === 0 ? (
        <p className={`${card} ${explain}`}>
          No shared links yet. A link is made the first time someone opens &ldquo;Share as image&rdquo; for one of your
          public poems or &ldquo;Share a passage&rdquo; for a chapter.
        </p>
      ) : (
        <div className={card}>
          <p className="mb-3 text-sm">
            <span data-stat="link-visits" className="font-medium tabular-nums">
              {pluralCount(total, "visit")}
            </span>{" "}
            through {pluralCount(links.length, "link")}
          </p>
          <ol className="grid grid-cols-[minmax(0,1fr)] divide-y" aria-label="Shared links, most visited first">
            {links.map((l, i) => (
              <li key={i} data-link-row className="flex min-h-11 items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-serif text-base">{l.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {l.kind === "poem" ? "Poem" : l.detail}
                    {!l.live && " · not on InkBoard now"}
                  </p>
                </div>
                <p className="shrink-0 text-right text-sm tabular-nums">{pluralCount(l.visits, "visit")}</p>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

function Novels({ novels }: { novels: WriterStats["novels"] }) {
  return (
    <section aria-labelledby="novels-heading" className={section}>
      <h2 id="novels-heading" className="font-serif text-2xl">
        Novels
      </h2>
      <p className={explain}>
        Words and reading time count published chapters only: the same numbers readers see on the novel&apos;s page.
        Scheduled chapters count once their time comes; drafts are chapters waiting to be published. Link visits add up
        every chapter&apos;s shared link.
      </p>
      {novels.length === 0 ? (
        <p className={`${card} ${explain}`}>
          No novels yet.{" "}
          <Link href="/admin/novels" className="text-foreground underline underline-offset-4">
            Start one
          </Link>
          .
        </p>
      ) : (
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-3">
          {novels.map((n) => (
            <li key={n.id} data-novel-stats className={card}>
              <h3 className="flex min-w-0 items-center gap-2 font-serif text-xl">
                <Link href={`/admin/novels/${n.id}`} className="truncate underline-offset-4 hover:underline">
                  {n.title}
                </Link>
                {n.isPrivate && (
                  <span className="inline-flex shrink-0 items-center gap-1 font-sans text-xs text-muted-foreground">
                    <LockIcon className="size-3.5" aria-hidden />
                    Password protected
                  </span>
                )}
              </h3>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
                <Stat label="Published chapters" value={n.publishedChapters.toLocaleString("en")} />
                {n.scheduledChapters > 0 && <Stat label="Scheduled" value={n.scheduledChapters.toLocaleString("en")} />}
                <Stat label="Drafts" value={n.draftChapters.toLocaleString("en")} />
                <Stat label="Words" value={n.words.toLocaleString("en")} />
                <Stat label="Reading time" value={n.readingMinutes ? `about ${pluralCount(n.readingMinutes, "minute")}` : "—"} />
                <Stat label="Link visits" value={n.visits.toLocaleString("en")} />
              </dl>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}
