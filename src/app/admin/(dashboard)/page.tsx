import { PenLineIcon, PlusIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { requireOnboardedSession } from "@/server/auth/dal";
import { shouldOfferPasskey } from "@/server/auth/passkeys";
import { getProfile } from "@/server/auth/profile";
import { getRecoveryCodeStatus } from "@/server/auth/recovery-codes";
import { getEditorStats } from "@/server/editor-stats";
import { StatCards } from "@/components/admin/stat-cards";
import { listEditorPoems } from "@/server/poems";
import { shareVisitsForEditor } from "@/server/short-links";
import { PoemsTable, type DashboardPoem } from "./poems-table";
import { FlashToast } from "@/components/flash-toast";
import { FirstPublishFlash } from "@/components/install/install-nudge";
import { RecoveryNotice } from "./recovery-notice";
import { HiddenNotice } from "@/components/admin/hidden-by-inkboard";
import { hiddenStateFor } from "@/server/takedown";
import { PasskeyOffer } from "./passkey-offer";
import { ChecklistAllSet, WelcomeChecklist } from "./welcome-checklist";
import { getWelcomeChecklist } from "@/server/welcome-checklist";
import { doneCount } from "@/lib/welcome-checklist";
import { RECOVERY_CODES_LOW } from "@/lib/recovery-code-format";
import { absoluteUrl, siteUrl } from "@/lib/site";

export const metadata: Metadata = { title: "Your poems" };

export default function AdminHomePage(props: PageProps<"/admin">) {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <Dashboard {...props} />
    </Suspense>
  );
}

async function Dashboard({ searchParams }: PageProps<"/admin">) {
  const { editor, sessionId } = await requireOnboardedSession();
  const [poems, stats, profile, recovery, offerPasskey, checklist, flash, visits, hidden] = await Promise.all([
    listEditorPoems(editor.id),
    getEditorStats(editor.id),
    getProfile(editor.id),
    getRecoveryCodeStatus(editor.id),
    shouldOfferPasskey(editor.id, sessionId),
    getWelcomeChecklist(editor.id),
    searchParams,
    shareVisitsForEditor(editor.id),
    hiddenStateFor(editor.id),
  ]);
  const lowCodes = recovery.total > 0 && recovery.unused <= RECOVERY_CODES_LOW;
  const rows: DashboardPoem[] = poems.map((p) => ({
    id: p.id,
    title: p.title,
    slug: p.slug,
    status: p.status,
    visibility: p.visibility,
    updatedLabel: dateFormat.format(p.updatedAt),
    // Visits through the short link printed on its pictures (Phase 21 round 3): the writer's eyes only.
    shareVisits: visits.get(p.id) ?? 0,
    // Hidden by InkBoard's owner (Phase 32 round 2): itself, or with the whole account.
    hidden: p.hidden || hidden.account,
    featured: p.featured && !hidden.account,
  }));
  // Just published (from the editor, `?published=<id>`): only one of this editor's own rows.
  const justPublished = typeof flash.published === "string" ? rows.find((r) => r.id === flash.published) : undefined;

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-8">
      {flash.deleted === "1" && <FlashToast param="deleted" title="Poem deleted" />}
      {justPublished && (
        // Keyed by the poem: this page stays mounted in <Activity> between visits, and
        // useOnceToast's guard would otherwise swallow the toast for the next poem.
        <FlashToast
          key={justPublished.id}
          param="published"
          title="Poem published"
          description={`“${justPublished.title}” is on the board now.`}
        />
      )}
      {/* The writer's install card after a first-ever publish (Phase 15): consumed once, then stripped. */}
      <FirstPublishFlash active={flash["first-publish"] === "1"} />
      {flash["signed-in"] === "1" && (
        <FlashToast param="signed-in" title="Signed in" description={`Welcome back, ${editor.penName}.`} />
      )}
      {flash.welcome === "1" && (
        <FlashToast
          param="welcome"
          title="You're all set"
          description={`Your poems will appear on the board under “${editor.penName}”.`}
        />
      )}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl">Your poems</h1>
          <p className="mt-1 text-muted-foreground">
            {poems.length === 0
              ? <>They&apos;ll appear on the board under &ldquo;{editor.penName}&rdquo;.</>
              : <>{stats.published} of {stats.total} published under &ldquo;{editor.penName}&rdquo;.</>}
          </p>
        </div>
        {poems.length > 0 && <NewPoemButton />}
      </div>

      {/* Calm order, never a pile (Phase 20): the rare, session-bound passkey offer
          first, then the checklist (folded whenever another notice is up, so it's
          one line plus its progress), then the low-codes reminder. While the
          checklist is up it replaces the recovery-code setup prompt. */}
      {/* Phase 32 round 2: first, above every other card, while anything of theirs is hidden from readers. */}
      <HiddenNotice account={hidden.account} poems={hidden.poems} novels={hidden.novels} />
      {offerPasskey && <PasskeyOffer />}
      {checklist?.kind === "steps" && (
        <WelcomeChecklist
          steps={checklist.steps}
          authorUrl={absoluteUrl(`/a/${editor.slug}`)}
          penName={editor.penName}
          // Open only at the very start (no poem yet, so nothing to push down);
          // folded to one line of progress once there are poems or another notice.
          defaultOpen={poems.length === 0 && doneCount(checklist.steps) <= 2 && !offerPasskey && !lowCodes}
        />
      )}
      {checklist?.kind === "all-set" && <ChecklistAllSet />}
      <RecoveryNotice status={recovery} setupPrompt={checklist?.kind !== "steps"} />

      <StatCards stats={stats} />

      {poems.length === 0 ? (
        <EmptyState />
      ) : (
        <PoemsTable
          poems={rows}
          authorSlug={editor.slug}
          pinnedPoemId={profile?.pinnedPoemId ?? null}
          justPublishedId={justPublished?.id ?? null}
          // Share as image (Phase 21 round 2): the same public sheet readers get.
          share={{ origin: siteUrl().origin, penName: editor.penName }}
        />
      )}
    </div>
  );
}

function NewPoemButton() {
  return (
    <Button asChild size="lg">
      <Link href="/admin/poems/new">
        <PlusIcon />
        New poem
      </Link>
    </Button>
  );
}

const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium" });

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed bg-card py-16 text-center">
      <PenLineIcon className="size-8 text-muted-foreground" aria-hidden />
      <p className="font-serif text-xl">No poems yet</p>
      <p className="max-w-sm text-sm text-muted-foreground">
        Write your first poem. You can keep it as a draft, publish it for everyone,
        or protect it with a password.
      </p>
      <Button asChild size="lg" className="mt-2">
        <Link href="/admin/poems/new">
          <PlusIcon />
          Write a poem
        </Link>
      </Button>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="grid animate-pulse gap-8" aria-busy>
      <div className="h-9 w-64 rounded-md bg-muted" />
      <div className="h-64 rounded-xl bg-muted" />
    </div>
  );
}
