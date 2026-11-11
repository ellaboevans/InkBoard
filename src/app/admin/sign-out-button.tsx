"use client";

import { Loader2Icon, LogOutIcon } from "lucide-react";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { signOutAction } from "./actions";

export function SignOutButton() {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await signOutAction();
          // Full page load, not router.push: discards every client-side route
          // kept alive in <Activity> (and its poem text) from this tab.
          window.location.replace("/sign-in");
        })
      }
    >
      {pending ? <Loader2Icon className="animate-spin" /> : <LogOutIcon />}
      Sign out
    </Button>
  );
}
