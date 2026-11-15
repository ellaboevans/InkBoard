"use client";

import { FingerprintIcon, Loader2Icon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { notify, UNEXPECTED_ERROR } from "@/lib/notify";
import { PUBLIC_DEVICE_PASSKEY } from "@/lib/passkey-messages";
import { useWebAuthnSupport } from "@/lib/webauthn-client";
import { PASSKEY_NAME_MAX } from "@/lib/passkey-limits";
import { removePasskeyAction, renamePasskeyAction } from "./passkey-actions";
import { StepUpCard } from "./step-up-card";
import { useAddPasskey } from "./use-add-passkey";

export type PasskeyRow = {
  id: string;
  name: string;
  /** Preformatted on the server (time zones). */
  createdLabel: string;
  lastUsedLabel: string | null;
  backedUp: boolean;
};

/** passkeyGate's answer for adding, as a hint for the UI (the server decides). */
export type PasskeyAddGate = "fresh" | "recovery" | "step_up_required" | "public_device" | "no_session";

type StepUp = { for: "add" } | { for: "remove"; passkey: PasskeyRow };

/**
 * The profile's "Passkeys" section (docs/PLAN.md, Phase 16 round 2): the
 * editor's passkeys (name, added, last used, synced), Add, Rename and Remove.
 * Adding and removing need a recent verification (StepUpCard); adding is
 * never offered on a "This isn't my device" session.
 */
export function PasskeysPanel({ email, passkeys, gate }: { email: string; passkeys: PasskeyRow[]; gate: PasskeyAddGate }) {
  const webauthn = useWebAuthnSupport();
  const [stepUp, setStepUp] = useState<StepUp | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [renaming, setRenaming] = useState<PasskeyRow | null>(null);
  const [removing, setRemoving] = useState<PasskeyRow | null>(null);
  const [pending, startTransition] = useTransition();
  const { add, pending: adding } = useAddPasskey({
    onStepUp: () => setStepUp({ for: "add" }),
    onAdded: () => setConfirmed(false),
  });

  const remove = (passkey: PasskeyRow) =>
    startTransition(async () => {
      try {
        const res = await removePasskeyAction(passkey.id);
        setRemoving(null);
        if (res.ok) notify.success("Passkey removed", `“${passkey.name}” can no longer sign you in.`);
        else if (res.reason === "step_up") setStepUp({ for: "remove", passkey });
        else notify.error("Couldn't remove the passkey", res.reason === "error" ? res.message : undefined);
      } catch {
        notify.error(UNEXPECTED_ERROR.title, UNEXPECTED_ERROR.description);
      }
    });

  if (stepUp) {
    return (
      <StepUpCard
        email={email}
        hasPasskeys={passkeys.length > 0}
        what={stepUp.for === "add" ? "Adding a passkey" : "Removing a passkey"}
        onConfirmed={() => {
          setStepUp(null);
          // Removing needs no prompt, so it goes ahead. Adding opens the
          // browser's passkey prompt, which needs a fresh click.
          if (stepUp.for === "remove") remove(stepUp.passkey);
          else setConfirmed(true);
        }}
        onCancel={() => setStepUp(null)}
      />
    );
  }

  const canAdd = webauthn && gate !== "public_device" && gate !== "no_session";
  return (
    <div className="grid gap-4 rounded-xl border bg-card p-6">
      {passkeys.length === 0 ? (
        <div className="flex items-start gap-3">
          <FingerprintIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
          <div className="grid gap-1">
            <p className="font-medium">No passkeys yet</p>
            <p className="text-sm text-muted-foreground">
              Add one on each computer or phone you use often. It signs you in with your fingerprint, face or device
              PIN: no email, no codes.
            </p>
          </div>
        </div>
      ) : (
        <ul aria-label="Your passkeys" className="divide-y rounded-lg border">
          {passkeys.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <FingerprintIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="grid min-w-0 flex-1 basis-48 gap-0.5">
                <p className="flex min-w-0 flex-wrap items-center gap-2 font-medium">
                  <span className="truncate">{p.name}</span>
                  {p.backedUp && (
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-normal text-muted-foreground">
                      Synced
                    </span>
                  )}
                </p>
                <p className="text-sm text-muted-foreground">
                  Added {p.createdLabel} · {p.lastUsedLabel ? `last used ${p.lastUsedLabel}` : "not used yet"}
                </p>
              </div>
              <div className="flex gap-1">
                <Button type="button" variant="ghost" size="sm" onClick={() => setRenaming(p)} aria-label={`Rename ${p.name}`}>
                  <PencilIcon />
                  Rename
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setRemoving(p)} aria-label={`Remove ${p.name}`}>
                  <Trash2Icon />
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {gate === "public_device" ? (
        <p className="text-sm text-muted-foreground">{PUBLIC_DEVICE_PASSKEY}</p>
      ) : !webauthn ? (
        <p className="text-sm text-muted-foreground">This browser can&apos;t make passkeys.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          {canAdd && (
            <Button
              type="button"
              variant={passkeys.length === 0 || confirmed ? "default" : "outline"}
              disabled={adding}
              onClick={add}
            >
              {adding ? <Loader2Icon className="animate-spin" /> : <PlusIcon />}
              Add a passkey
            </Button>
          )}
          <p className="text-sm text-muted-foreground" role={confirmed ? "status" : undefined}>
            {confirmed
              ? "Confirmed. Add your passkey now."
              : gate === "recovery"
                ? "You signed in with a recovery code just now, so you can add a passkey on this computer without an email check."
                : gate === "step_up_required"
                  ? "We'll ask you to confirm it's you first."
                  : "Your browser will ask how to save it: on this device, or in your password manager."}
          </p>
        </div>
      )}

      {renaming && <RenameDialog passkey={renaming} onClose={() => setRenaming(null)} />}

      <AlertDialog open={removing !== null} onOpenChange={(open) => !open && !pending && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove &ldquo;{removing?.name}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              It will no longer sign you in. Your browser or password manager may still list it; you can delete it
              there too.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <Button variant="destructive" disabled={pending} onClick={() => removing && remove(removing)}>
              {pending ? <Loader2Icon className="animate-spin" /> : <Trash2Icon />}
              Remove passkey
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Mounted only while open, so the name starts from the passkey's current one. */
function RenameDialog({ passkey, onClose }: { passkey: PasskeyRow; onClose: () => void }) {
  const [name, setName] = useState(passkey.name);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const save = () =>
    startTransition(async () => {
      try {
        const res = await renamePasskeyAction(passkey.id, name);
        if (res.ok) {
          notify.success("Passkey renamed");
          onClose();
        } else setError(res.error);
      } catch {
        notify.error(UNEXPECTED_ERROR.title, UNEXPECTED_ERROR.description);
      }
    });
  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <DialogHeader>
            <DialogTitle>Rename passkey</DialogTitle>
            <DialogDescription>A name that tells you which device or password manager holds it.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="passkey-name">Name</Label>
            <Input
              id="passkey-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={PASSKEY_NAME_MAX}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "passkey-name-error" : undefined}
              required
              autoFocus
            />
            {error && (
              <p id="passkey-name-error" role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2Icon className="animate-spin" />}
              Save name
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
