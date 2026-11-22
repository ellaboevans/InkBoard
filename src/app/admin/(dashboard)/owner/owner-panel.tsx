"use client";

import { CheckIcon, EyeIcon, EyeOffIcon, Loader2Icon } from "lucide-react";
import { useId, useState, useTransition } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { notify, UNEXPECTED_ERROR } from "@/lib/notify";
import { pluralCount } from "@/lib/plural";
import type { ReportKind } from "@/lib/report";
import { StepUpCard } from "../profile/step-up-card";
import { ownerMarkReviewedAction, ownerTakedownAction, type OwnerActionResult } from "./actions";

/*
 * The owner's page, in the browser (docs/PLAN.md, Phase 32 round 3). Every
 * change is the server's decision: the actions re-check the owner and the
 * step-up inside their transaction; `fresh` is only a hint for whether to ask
 * first. Hide and Restore confirm in an AlertDialog naming what will happen.
 * Readers' details are rendered as text (React escapes them), never HTML.
 */

export type GroupView = {
  key: string;
  kind: ReportKind;
  targetId: string;
  title: string;
  penName: string;
  path: string;
  url: string;
  hidden: boolean;
  novelTitle: string | null;
  reports: { id: string; reason: string; details: string | null; atLabel: string; reviewedLabel: string | null }[];
};

export type HiddenView = {
  key: string;
  kind: "poem" | "novel" | "author";
  title: string;
  penName: string;
  path: string;
  url: string;
  hiddenLabel: string;
};

type TakedownOp = {
  type: "takedown";
  link: string;
  action: "hide" | "restore";
  /** What the dialog names. */
  kind: ReportKind;
  title: string;
  penName: string;
  novelTitle: string | null;
};
type ReviewOp = { type: "review"; kind: ReportKind; id: string; title: string };
type Op = TakedownOp | ReviewOp;

const KIND_LABEL: Record<ReportKind, string> = { poem: "Poem", novel: "Novel", chapter: "Chapter", author: "Author" };

/** The confirm dialog's words for each case: a chapter's group acts on the whole novel. */
function describe(op: TakedownOp): { title: string; body: string; button: string } {
  const hide = op.action === "hide";
  if (op.kind === "author") {
    return hide
      ? {
          title: `Hide everything by ${op.penName}?`,
          body: `Their author page, every poem and every novel will be missing to readers: not on the board, in search or in feeds, and their pages will say “not found”. Nothing is deleted, and you can restore it. ${op.penName} will be emailed.`,
          button: "Hide author",
        }
      : {
          title: `Restore everything by ${op.penName}?`,
          body: `Readers will see their author page, poems and novels again, exactly as they were. ${op.penName} will be emailed.`,
          button: "Restore author",
        };
  }
  if (op.kind === "chapter" || op.kind === "novel") {
    const novel = op.kind === "chapter" ? (op.novelTitle ?? op.title) : op.title;
    const chapterNote = op.kind === "chapter" ? "A chapter can't be hidden on its own: this acts on the whole novel. " : "";
    return hide
      ? {
          title: `Hide the whole novel “${novel}”?`,
          body: `${chapterNote}The novel and every chapter will be missing to readers: not on the board, in search or in feeds, and its pages will say “not found”. Nothing is deleted, and you can restore it. ${op.penName} will be emailed.`,
          button: "Hide novel",
        }
      : {
          title: `Restore the novel “${novel}”?`,
          body: `${chapterNote}Readers will see the novel and its chapters again, exactly as they were. ${op.penName} will be emailed.`,
          button: "Restore novel",
        };
  }
  return hide
    ? {
        title: `Hide “${op.title}”?`,
        body: `The poem will be missing to readers: not on the board, in search or in feeds, and its page will say “not found”. Nothing is deleted, and you can restore it. ${op.penName} will be emailed.`,
        button: "Hide poem",
      }
    : {
        title: `Restore “${op.title}”?`,
        body: `Readers will see the poem again, exactly as it was. ${op.penName} will be emailed.`,
        button: "Restore poem",
      };
}

export function OwnerPanel({
  open,
  reviewed,
  hidden,
  reviewedDays,
  fresh: freshHint,
  email,
  hasPasskeys,
}: {
  open: GroupView[];
  reviewed: GroupView[];
  hidden: HiddenView[];
  reviewedDays: number;
  /** Recently verified (a hint: the server decides). */
  fresh: boolean;
  email: string;
  hasPasskeys: boolean;
}) {
  const [confirmedHere, setConfirmedHere] = useState(false);
  const [staleSeen, setStaleSeen] = useState(false);
  const fresh = confirmedHere || (freshHint && !staleSeen);
  const [stepUpFor, setStepUpFor] = useState<Op | null>(null);
  const [confirm, setConfirm] = useState<TakedownOp | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (op: Op) =>
    startTransition(async () => {
      let res: OwnerActionResult;
      try {
        res = op.type === "takedown" ? await ownerTakedownAction(op.link, op.action) : await ownerMarkReviewedAction(op.kind, op.id);
      } catch {
        notify.error(UNEXPECTED_ERROR.title, "Nothing was changed. Please try again.");
        return;
      }
      setConfirm(null);
      if (res.ok) notify.success(res.title, res.description);
      else if (res.reason === "step_up") {
        // The window ran out: confirm it's you, then carry on with the same change.
        setStaleSeen(true);
        setConfirmedHere(false);
        setStepUpFor(op);
      } else notify.error(res.title, res.description);
    });

  /** Ask for a step-up first when needed; Hide and Restore then confirm. */
  const request = (op: Op) => {
    if (!fresh) setStepUpFor(op);
    else if (op.type === "takedown") setConfirm(op);
    else run(op);
  };

  const takedown = (g: { kind: ReportKind; path: string; title: string; penName: string; novelTitle: string | null }, hiddenNow: boolean) =>
    request({ type: "takedown", link: g.path, action: hiddenNow ? "restore" : "hide", kind: g.kind, title: g.title, penName: g.penName, novelTitle: g.novelTitle });

  const words = confirm ? describe(confirm) : null;

  return (
    <div className="grid gap-6">
      {stepUpFor && (
        <StepUpCard
          // The address shown is the signed-in account's own email, as on Settings (never read from the environment).
          email={email}
          hasPasskeys={hasPasskeys}
          what={stepUpFor.type === "review" ? "Marking reports as reviewed" : stepUpFor.action === "hide" ? "Hiding work" : "Restoring work"}
          onConfirmed={() => {
            const op = stepUpFor;
            setStepUpFor(null);
            setConfirmedHere(true);
            setStaleSeen(false);
            if (op.type === "takedown") setConfirm(op);
            else run(op);
          }}
          onCancel={() => setStepUpFor(null)}
        />
      )}

      <Tabs defaultValue="open" className="gap-5">
        <TabsList className="h-auto w-full flex-wrap justify-start sm:w-fit">
          <TabsTrigger value="open" className="min-h-10 px-3">
            Open <span className="tabular-nums text-muted-foreground">{open.length}</span>
          </TabsTrigger>
          <TabsTrigger value="reviewed" className="min-h-10 px-3">
            Reviewed <span className="tabular-nums text-muted-foreground">{reviewed.length}</span>
          </TabsTrigger>
          <TabsTrigger value="hidden" className="min-h-10 px-3">
            Hidden now <span className="tabular-nums text-muted-foreground">{hidden.length}</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="open" className="grid gap-4">
          {open.length === 0 ? (
            <Empty>No open reports.</Empty>
          ) : (
            <ul className="grid grid-cols-[minmax(0,1fr)] gap-4" aria-label="Open reports, by page">
              {open.map((g) => (
                <Group
                  key={g.key}
                  group={g}
                  pending={pending}
                  onTakedown={() => takedown(g, g.hidden)}
                  onReviewed={() => request({ type: "review", kind: g.kind, id: g.targetId, title: g.title })}
                />
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="reviewed" className="grid gap-4">
          <p className="text-sm text-muted-foreground">Reports marked reviewed in the last {reviewedDays} days.</p>
          {reviewed.length === 0 ? (
            <Empty>Nothing reviewed lately.</Empty>
          ) : (
            <ul className="grid grid-cols-[minmax(0,1fr)] gap-4" aria-label="Reviewed reports, by page">
              {reviewed.map((g) => (
                <Group key={g.key} group={g} pending={pending} onTakedown={() => takedown(g, g.hidden)} />
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="hidden" className="grid gap-4">
          {hidden.length === 0 ? (
            <Empty>Nothing is hidden.</Empty>
          ) : (
            <ul className="grid grid-cols-[minmax(0,1fr)] gap-3" aria-label="Hidden now">
              {hidden.map((h) => (
                <li key={h.key} className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-center" data-hidden-item={h.key}>
                  <div className="grid min-w-0 flex-1 gap-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{KIND_LABEL[h.kind]}</Badge>
                      <span className="font-serif text-lg break-words">{h.kind === "author" ? h.penName : h.title}</span>
                    </p>
                    {h.kind !== "author" && <p className="text-sm text-muted-foreground">by {h.penName}</p>}
                    <p className="text-sm text-muted-foreground">Hidden {h.hiddenLabel}</p>
                    <a href={h.url} className="text-sm break-all underline underline-offset-4 hover:text-primary">
                      {h.url}
                    </a>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11 shrink-0 self-start sm:self-center"
                    disabled={pending}
                    onClick={() => takedown({ ...h, novelTitle: null }, true)}
                  >
                    <EyeIcon />
                    Restore<span className="sr-only"> {h.kind === "author" ? h.penName : `“${h.title}”`}</span>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>

      <AlertDialog open={confirm !== null} onOpenChange={(next) => !next && !pending && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{words?.title}</AlertDialogTitle>
            <AlertDialogDescription>{words?.body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <Button
              type="button"
              variant={confirm?.action === "hide" ? "destructive" : "default"}
              disabled={pending}
              onClick={() => confirm && run(confirm)}
            >
              {pending ? <Loader2Icon className="animate-spin" /> : confirm?.action === "hide" ? <EyeOffIcon /> : <EyeIcon />}
              {words?.button}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-dashed bg-card px-4 py-10 text-center text-muted-foreground">{children}</p>;
}

function Group({
  group: g,
  pending,
  onTakedown,
  onReviewed,
}: {
  group: GroupView;
  pending: boolean;
  onTakedown: () => void;
  /** Only on the "Open" tab. */
  onReviewed?: () => void;
}) {
  const titleId = useId();
  const reviewedTab = !onReviewed;
  const actsOnNovel = g.kind === "chapter" || g.kind === "novel";
  const verb = g.hidden ? "Restore" : "Hide";
  const noun = g.kind === "author" ? "author" : actsOnNovel ? "novel" : "poem";
  return (
    <li>
      <article aria-labelledby={titleId} className="grid gap-4 rounded-xl border bg-card p-4 sm:p-5" data-report-group={g.key}>
        <div className="grid gap-1.5">
          <p className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{KIND_LABEL[g.kind]}</Badge>
            {g.hidden && (
              <Badge variant="destructive">
                <EyeOffIcon aria-hidden />
                Hidden now
              </Badge>
            )}
            <span className="text-sm text-muted-foreground">
              {pluralCount(g.reports.length, reviewedTab ? "reviewed report" : "open report")}
            </span>
          </p>
          <h2 id={titleId} className="font-serif text-xl break-words">
            {g.title}
          </h2>
          {g.kind !== "author" && <p className="text-sm text-muted-foreground">by {g.penName}</p>}
          <a href={g.url} className="text-sm break-all underline underline-offset-4 hover:text-primary">
            {g.url}
          </a>
        </div>
        <ul className="grid gap-3 border-t pt-3" aria-label={`Reports of ${g.title}`}>
          {g.reports.map((r) => (
            <li key={r.id} className="grid gap-1">
              <p className="font-medium">{r.reason}</p>
              <p className="text-xs text-muted-foreground">
                {r.atLabel}
                {r.reviewedLabel && <> · reviewed {r.reviewedLabel}</>}
              </p>
              {r.details ? (
                // Text, never HTML: React escapes whatever the reader typed.
                <p className="text-sm break-words whitespace-pre-wrap">{r.details}</p>
              ) : (
                <p className="text-sm text-muted-foreground">No details given.</p>
              )}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant={g.hidden ? "outline" : "destructive"}
            className="min-h-11"
            disabled={pending}
            onClick={onTakedown}
          >
            {g.hidden ? <EyeIcon /> : <EyeOffIcon />}
            {verb} {noun}
            <span className="sr-only"> “{actsOnNovel && g.novelTitle ? g.novelTitle : g.title}”</span>
          </Button>
          {onReviewed && (
            <Button type="button" variant="outline" className="min-h-11" disabled={pending} onClick={onReviewed}>
              <CheckIcon />
              Mark as reviewed<span className="sr-only"> “{g.title}”</span>
            </Button>
          )}
        </div>
      </article>
    </li>
  );
}
