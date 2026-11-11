"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { endSession, requireEditor } from "@/server/auth/dal";
import { setPenName } from "@/server/auth/profile";

/**
 * Ends the session. Deliberately does *not* redirect: the client then does a
 * full page load (see sign-out-button.tsx), because a client-side navigation
 * would leave earlier admin pages, including private poem text, mounted but
 * hidden in <Activity>, readable by the next person at a shared computer.
 */
export async function signOutAction(): Promise<void> {
  await endSession();
}

export type OnboardingState = { error?: string; penName?: string };

export async function completeOnboardingAction(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  // Always re-authorise inside the action; never trust the page that rendered it.
  const editor = await requireEditor();
  const penName = formData.get("penName");
  const res = await setPenName(editor.id, penName);
  if (!res.ok) return { error: res.error, penName: String(penName ?? "") };
  // The admin layout (header shows the pen name) is shared, so re-render it too.
  refresh();
  redirect("/admin");
}
