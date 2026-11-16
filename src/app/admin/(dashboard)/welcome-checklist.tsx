"use client";

import { CheckIcon, ChevronDownIcon, CircleIcon, Share2Icon, SparklesIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { notify, UNEXPECTED_ERROR } from "@/lib/notify";
import { doneCount, nextStep, type ChecklistStep } from "@/lib/welcome-checklist";
import { dismissRecoveryPromptAction, hideChecklistAction, markAuthorPageSharedAction } from "./actions";

/*
 * The welcome checklist on the dashboard (docs/PLAN.md, Phase 20). Steps and
 * their state come from the server; this only lays them out. Compact while
 * folded: the progress and the next step. Unfolded: every step.
 */

export function WelcomeChecklist({
  steps,
  authorUrl,
  penName,
  defaultOpen,
}: {
  steps: ChecklistStep[];
  /** Absolute, resolved on the server (the client has no APP_URL). */
  authorUrl: string;
  penName: string;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [hiding, startHiding] = useTransition();
  const ids = { title: useId(), list: useId() };
  const done = doneCount(steps);
  const next = nextStep(steps);

  const hide = () =>
    startHiding(async () => {
      try {
        await hideChecklistAction();
        notify.success("Checklist hidden", "Everything it pointed to is in your profile.");
      } catch {
        notify.error(UNEXPECTED_ERROR.title, UNEXPECTED_ERROR.description);
      }
    });

  return (
    <section aria-labelledby={ids.title} data-welcome-checklist className="grid gap-4 rounded-xl border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="grid min-w-0 gap-0.5">
          <h2 id={ids.title} className="font-serif text-xl">
            Getting started
          </h2>
          <p className="text-sm text-muted-foreground">A few steps to make InkBoard yours.</p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={open}
            aria-controls={ids.list}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? "Show fewer" : "Show all steps"}
            <ChevronDownIcon aria-hidden className={open ? "rotate-180 transition-transform" : "transition-transform"} />
          </Button>
          <Button variant="ghost" size="sm" onClick={hide} disabled={hiding}>
            Hide checklist
          </Button>
        </div>
      </div>

      <div className="grid gap-1.5">
        <p className="text-sm font-medium" id={`${ids.title}-progress`}>
          {done} of {steps.length} done
        </p>
        <div
          role="progressbar"
          aria-labelledby={`${ids.title}-progress`}
          aria-valuemin={0}
          aria-valuemax={steps.length}
          aria-valuenow={done}
          aria-valuetext={`${done} of ${steps.length} done`}
          className="h-1.5 overflow-hidden rounded-full bg-secondary"
        >
          <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${(done / steps.length) * 100}%` }} />
        </div>
      </div>

      {open ? (
        <ol id={ids.list} className="grid gap-1">
          {steps.map((s) => (
            <StepRow key={s.id} step={s} authorUrl={authorUrl} penName={penName} />
          ))}
        </ol>
      ) : (
        next && (
          <div id={ids.list} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm">
            <p className="min-w-0">
              <span className="text-muted-foreground">Next: </span>
              <span className="font-medium">{next.title}</span>
            </p>
            <StepAction step={next} authorUrl={authorUrl} penName={penName} />
          </div>
        )
      )}
    </section>
  );
}

function StepRow({ step, authorUrl, penName }: { step: ChecklistStep; authorUrl: string; penName: string }) {
  const status = step.done ? "Done" : step.skipped ? "Skipped for now" : step.waiting ? "Not yet" : null;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg px-2 py-2 sm:flex-nowrap" data-step={step.id} data-done={step.done}>
      <span
        aria-hidden
        className={
          step.done
            ? "flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
            : "flex size-6 shrink-0 items-center justify-center rounded-full border text-muted-foreground"
        }
      >
        {step.done ? <CheckIcon className="size-3.5" /> : <CircleIcon className="size-2 fill-current" />}
      </span>
      <div className="grid min-w-0 flex-1 basis-48 gap-0.5">
        <p className={step.done ? "text-muted-foreground" : "font-medium"}>
          {step.title}
          {status && <span className="ml-2 text-xs font-normal text-muted-foreground">({status})</span>}
        </p>
        {!step.done && <p className="text-sm text-muted-foreground">{step.line}</p>}
      </div>
      {!step.done && !step.waiting && (
        <div className="ml-9 flex flex-wrap items-center gap-1 sm:ml-0">
          <StepAction step={step} authorUrl={authorUrl} penName={penName} />
          {step.id === "way-in" && !step.skipped && <NotNow />}
        </div>
      )}
    </li>
  );
}

/** Short visible labels; the hidden rest makes each name read on its own ("Choose an avatar"). */
const ACTION_LABELS: Record<string, [string, string]> = {
  "pen-name": ["Profile", ""],
  avatar: ["Choose", " an avatar"],
  about: ["Add", " a tagline or bio"],
  // Not "Write a poem": that's the empty state's button just below.
  publish: ["Write", " your first poem"],
  "way-in": ["Set up", " recovery codes or a passkey"],
};

function StepAction({ step, authorUrl, penName }: { step: ChecklistStep; authorUrl: string; penName: string }) {
  if (step.id === "share") return <ShareButton url={authorUrl} penName={penName} />;
  return (
    <Button asChild variant="outline" size="sm">
      <Link href={step.href!}>
        {ACTION_LABELS[step.id][0]}
        {ACTION_LABELS[step.id][1] && <span className="sr-only">{ACTION_LABELS[step.id][1]}</span>}
      </Link>
    </Button>
  );
}

/** "Not now" for recovery codes: skips that step's nudge (the old setup prompt's choice), not the checklist. */
function NotNow() {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          try {
            await dismissRecoveryPromptAction();
          } catch {
            notify.error(UNEXPECTED_ERROR.title, UNEXPECTED_ERROR.description);
          }
        })
      }
    >
      Not now<span className="sr-only"> for recovery codes</span>
    </Button>
  );
}

/** Web Share where the browser has it (phones); otherwise copy the link. Either way the server notes it. */
function ShareButton({ url, penName }: { url: string; penName: string }) {
  const [pending, start] = useTransition();
  const share = () =>
    start(async () => {
      try {
        if (typeof navigator.share === "function") {
          try {
            await navigator.share({ title: `${penName} on InkBoard`, url });
          } catch (e) {
            // Closing the share sheet isn't sharing.
            if (e instanceof DOMException && e.name === "AbortError") return;
            throw e;
          }
        } else {
          await navigator.clipboard.writeText(url);
          notify.success("Link copied", url);
        }
        await markAuthorPageSharedAction();
      } catch {
        notify.error("Couldn't share the link", `Your author page is ${url}`);
      }
    });
  return (
    <Button variant="outline" size="sm" onClick={share} disabled={pending}>
      <Share2Icon aria-hidden />
      Share<span className="sr-only"> your author page</span>
    </Button>
  );
}

/** Shown on exactly one render: the one that found all six steps done (the server closes the checklist then). */
export function ChecklistAllSet() {
  const [shown, setShown] = useState(true);
  if (!shown) return null;
  return (
    <section
      aria-labelledby="checklist-all-set"
      data-checklist-all-set
      className="flex items-start gap-3 rounded-xl border bg-card p-4 sm:items-center sm:p-5"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-primary">
        <SparklesIcon className="size-4" aria-hidden />
      </span>
      <div className="grid min-w-0 flex-1 gap-0.5">
        <h2 id="checklist-all-set" className="font-serif text-xl">
          You’re all set
        </h2>
        <p className="text-sm text-muted-foreground">Your page is ready and your poems are on the board. Happy writing.</p>
      </div>
      <Button variant="ghost" size="icon-sm" onClick={() => setShown(false)}>
        <XIcon />
        <span className="sr-only">Close</span>
      </Button>
    </section>
  );
}
