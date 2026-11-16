import { KeyRoundIcon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { plural } from "@/lib/plural";
import { RECOVERY_CODES_LOW } from "@/lib/recovery-code-format";
import type { RecoveryCodeStatus } from "@/server/auth/recovery-codes";
import { dismissRecoveryPromptAction } from "./actions";

const PROFILE_SECTION = "/admin/profile#recovery-codes";

/**
 * Dashboard notices about recovery codes (docs/PLAN.md, Phase 16):
 * - no codes yet: a one-time setup prompt. "Not now" is stored on the
 *   editor (server-side), so it never comes back, on any device;
 * - 2 or fewer unused codes left: a reminder to make a new set, until they do.
 * While the welcome checklist is shown (Phase 20) the setup prompt is left
 * out (`setupPrompt={false}`): the checklist's step replaces it, and its
 * "Not now" sets the same flag. The low-codes reminder always shows.
 */
export function RecoveryNotice({ status, setupPrompt = true }: { status: RecoveryCodeStatus; setupPrompt?: boolean }) {
  if (status.total === 0) {
    // While the welcome checklist is up, its "Keep a way in" step is the setup prompt (Phase 20).
    if (status.promptDismissed || !setupPrompt) return null;
    return (
      <Notice
        icon={<KeyRoundIcon className="size-5" aria-hidden />}
        title="Set up recovery codes so you can sign in without your email"
        description="Ten single-use codes, kept in a password manager or your wallet, let you in from any computer when your email is on a phone you don't have with you."
      >
        <Button asChild>
          <Link href={PROFILE_SECTION}>Set up recovery codes</Link>
        </Button>
        <form action={dismissRecoveryPromptAction}>
          <Button type="submit" variant="ghost">
            Not now
          </Button>
        </form>
      </Notice>
    );
  }
  if (status.unused > RECOVERY_CODES_LOW) return null;
  return (
    <Notice
      icon={<TriangleAlertIcon className="size-5" aria-hidden />}
      title={
        status.unused === 0
          ? "You've used all your recovery codes"
          : `Only ${status.unused} recovery ${plural(status.unused, "code")} left`
      }
      description="Make a new set so you can still sign in without your email. The new set replaces the old one."
    >
      <Button asChild>
        <Link href={PROFILE_SECTION}>Make a new set</Link>
      </Button>
    </Notice>
  );
}

function Notice({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-labelledby="recovery-notice-title"
      className="flex flex-col gap-4 rounded-xl border bg-card p-5 sm:flex-row sm:items-center"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-primary">
        {icon}
      </span>
      <div className="grid min-w-0 flex-1 gap-1">
        <h2 id="recovery-notice-title" className="font-medium">
          {title}
        </h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </section>
  );
}
