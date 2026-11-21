"use client";

import { FlagIcon } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { cn } from "cn";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { ReportTarget } from "@/lib/report";

/* The form (and its action) load only when the dialog first opens. */
const ReportForm = lazy(() => import("./report-form"));
const preload = () => void import("./report-form");

const KIND_WORD = { poem: "poem", novel: "novel", chapter: "chapter", author: "writer" } as const;

/**
 * "Report" at the foot of a poem, novel, chapter or author page (docs/PLAN.md,
 * Phase 32). English UI (no `lang`). The target is the page's own slugs,
 * passed from the server render; the server checks it again.
 */
export function ReportLink({ target, className }: { target: ReportTarget; className?: string }) {
  const [open, setOpen] = useState(false);
  const word = KIND_WORD[target.kind];
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        data-report-link
        onPointerEnter={preload}
        onFocus={preload}
        onTouchStart={preload}
        className={cn(
          "inline-flex min-h-11 min-w-11 items-center gap-1.5 rounded-sm text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
          className,
        )}
      >
        <FlagIcon className="size-3.5" aria-hidden />
        Report<span className="sr-only"> this {word}</span>
      </DialogTrigger>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Report this {word}</DialogTitle>
            <DialogDescription>
              Tell InkBoard’s owner what’s wrong. You don’t need an account, and nothing about you is stored.
            </DialogDescription>
          </DialogHeader>
          <Suspense fallback={<div className="h-80 animate-pulse rounded-xl bg-muted" aria-hidden />}>
            <ReportForm target={target} />
          </Suspense>
        </DialogContent>
    </Dialog>
  );
}
