"use client";

import { Loader2Icon, Trash2Icon } from "lucide-react";
import { useState, useTransition } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { notify, UNEXPECTED_ERROR } from "@/lib/notify";
import { pluralCount } from "@/lib/plural";
import { StepUpCard } from "../profile/step-up-card";
import { deleteAccountAction } from "./actions";

/** "your poems" (none yet), "your poem" (one), "your 4 poems". */
const yours = (n: number, noun: string) => (n === 0 ? `your ${noun}s` : n === 1 ? `your ${noun}` : `your ${pluralCount(n, noun)}`);

/** As the server compares it (confirmsPenName): NFC, spaces collapsed, trimmed; case matters. */
const tidy = (s: string) => s.normalize("NFC").replace(/\s+/g, " ").trim();

/**
 * "Delete account" (docs/PLAN.md, Phase 17): what goes, a link to download
 * first, then a recent verification (the shared StepUpCard) and the pen name
 * typed back. The server checks both again. On success: a full page load to
 * the board (nothing of the admin may stay mounted in <Activity>).
 */
export function DeleteAccount({
  penName,
  slug,
  email,
  fresh,
  hasPasskeys,
  poemCount,
  collectionCount,
}: {
  penName: string;
  slug: string;
  email: string;
  /** Recently verified (a hint: the server decides). */
  fresh: boolean;
  hasPasskeys: boolean;
  poemCount: number;
  collectionCount: number;
}) {
  const [stepUp, setStepUp] = useState(false);
  const [open, setOpen] = useState(false);

  if (stepUp) {
    return (
      <StepUpCard
        email={email}
        hasPasskeys={hasPasskeys}
        what="Deleting your account"
        onConfirmed={() => {
          setStepUp(false);
          setOpen(true);
        }}
        onCancel={() => setStepUp(false)}
      />
    );
  }

  return (
    <div className="grid gap-4 rounded-xl border border-destructive/40 bg-card p-6">
      <p>Deleting your account removes, straight away and for good:</p>
      <ul className="grid list-disc gap-1 pl-5 text-sm">
        <li>{yours(poemCount, "poem")}, drafts and private ones included, with every saved version</li>
        <li>{yours(collectionCount, "collection")}, your author page and your profile</li>
        <li>your passkeys, recovery codes and every signed-in device</li>
      </ul>
      <p className="text-sm text-muted-foreground">
        Readers stop seeing your poems at once, and your links (/a/{slug}) are retired, so they never lead to someone
        else&apos;s poems. Copies that readers saved for offline reading stay in their browsers, out of our reach.
      </p>
      <p className="text-sm">
        Want to keep your poems?{" "}
        <a href="#download" className="font-medium underline underline-offset-4 hover:text-primary">
          Download them first
        </a>
        .
      </p>
      <div>
        <Button type="button" variant="destructive" onClick={() => (fresh ? setOpen(true) : setStepUp(true))}>
          <Trash2Icon />
          Delete my account…
        </Button>
      </div>
      {!fresh && <p className="text-sm text-muted-foreground">We&apos;ll ask you to confirm it&apos;s you first.</p>}

      {open && (
        <ConfirmDialog
          penName={penName}
          onClose={() => setOpen(false)}
          onStepUp={() => {
            setOpen(false);
            setStepUp(true);
          }}
        />
      )}
    </div>
  );
}

/** Mounted only while open, so the typed name starts empty each time. */
function ConfirmDialog({ penName, onClose, onStepUp }: { penName: string; onClose: () => void; onStepUp: () => void }) {
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const matches = tidy(typed) === tidy(penName);

  const submit = () =>
    startTransition(async () => {
      try {
        const res = await deleteAccountAction(typed);
        if (res.ok) {
          // A full page load, so no admin page stays mounted (CLAUDE.md, sign-out),
          // replacing this entry so Back can't return to the deleted account.
          window.location.replace("/?account-deleted=1");
          return;
        }
        if (res.reason === "step_up") onStepUp();
        else setError(res.message);
      } catch {
        notify.error(UNEXPECTED_ERROR.title, "Your account wasn't deleted. Please try again.");
      }
    });

  return (
    <AlertDialog open onOpenChange={(next) => !next && !pending && onClose()}>
      <AlertDialogContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (matches) submit();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Delete your account?</AlertDialogTitle>
            <AlertDialogDescription>
              This can&apos;t be undone. Every poem, collection, saved version, passkey and recovery code goes with it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-2">
            {/* Block, not the Label's flex row: the name would split into its own column on phones. */}
            <Label htmlFor="confirm-pen-name" className="block leading-normal">
              Type your pen name, <span className="font-semibold">{penName}</span>, to confirm
            </Label>
            <Input
              id="confirm-pen-name"
              value={typed}
              onChange={(e) => {
                setTyped(e.target.value);
                setError(null);
              }}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "confirm-pen-name-error" : undefined}
              disabled={pending}
              autoFocus
            />
            {error && (
              <p id="confirm-pen-name-error" role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel type="button" disabled={pending}>
              Keep my account
            </AlertDialogCancel>
            <Button type="submit" variant="destructive" disabled={!matches || pending}>
              {pending ? <Loader2Icon className="animate-spin" /> : <Trash2Icon />}
              Delete my account
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
