"use client";

import { Loader2Icon, LogOutIcon } from "lucide-react";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { notify, UNEXPECTED_ERROR } from "@/lib/notify";
import { revokeOtherSessionsAction, revokeSessionAction, type RevokeResult } from "./actions";
import { pluralCount } from "@/lib/plural";

function useRevoke(run: () => Promise<RevokeResult>, success: (count: number) => string) {
  const [pending, startTransition] = useTransition();
  const onClick = () =>
    startTransition(async () => {
      let res: RevokeResult;
      try {
        res = await run();
      } catch {
        notify.error(UNEXPECTED_ERROR.title, UNEXPECTED_ERROR.description);
        return;
      }
      if (res.ok) notify.success(success(res.count));
      else notify.error("Couldn't sign out that device", res.error);
    });
  return { pending, onClick };
}

export function RevokeSessionButton({ sessionId, label }: { sessionId: string; label: string }) {
  const { pending, onClick } = useRevoke(
    () => revokeSessionAction(sessionId),
    () => "Device signed out",
  );
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={onClick}
      aria-label={`Sign out ${label}`}
    >
      {pending ? <Loader2Icon className="animate-spin" /> : <LogOutIcon />}
      Sign out
    </Button>
  );
}

export function RevokeOtherSessionsButton() {
  const { pending, onClick } = useRevoke(revokeOtherSessionsAction, (n) =>
    `Signed out ${pluralCount(n, "other device")}`,
  );
  return (
    <Button type="button" variant="outline" size="sm" disabled={pending} onClick={onClick}>
      {pending && <Loader2Icon className="animate-spin" />}
      Sign out all other devices
    </Button>
  );
}
