import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AuthShell } from "@/components/auth/auth-shell";
import { getCurrentEditor } from "@/server/auth/dal";
import { RecoverySignInForm } from "./recovery-sign-in-form";

export const metadata: Metadata = {
  title: "Sign in with a recovery code",
  alternates: { canonical: "/sign-in/recovery" },
  robots: { index: false, follow: false },
};

/**
 * The way in without email (docs/PLAN.md, Phase 16): an email address plus
 * one of the recovery codes the editor saved from their profile.
 */
export default function RecoverySignInPage() {
  return (
    <AuthShell
      title="Use a recovery code"
      description="Enter your email address and one of the recovery codes you saved. Each code works once."
    >
      <Suspense fallback={null}>
        <RedirectIfSignedIn />
      </Suspense>
      <RecoverySignInForm />
    </AuthShell>
  );
}

async function RedirectIfSignedIn() {
  const editor = await getCurrentEditor();
  if (editor) redirect(editor.penName ? "/admin" : "/admin/onboarding");
  return null;
}
