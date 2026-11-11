"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { endSession, requireEditor } from "@/server/auth/dal";
import { setPenName } from "@/server/auth/profile";

export async function signOutAction(): Promise<void> {
  await endSession();
  redirect("/sign-in");
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
