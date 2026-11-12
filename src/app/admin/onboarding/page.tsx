import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AuthShell } from "@/components/auth/auth-shell";
import { requireEditor } from "@/server/auth/dal";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = { title: "Welcome" };

export default function OnboardingPage() {
  return (
    <AuthShell
      title="Choose your pen name"
      description="This is how readers will find you. It labels your section on the board, and you can change it later in your profile."
    >
      <Suspense fallback={<div className="h-24 animate-pulse rounded-md bg-muted" />}>
        <Onboarding />
      </Suspense>
    </AuthShell>
  );
}

async function Onboarding() {
  const editor = await requireEditor();
  if (editor.penName) redirect("/admin");
  return <OnboardingForm />;
}
