import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AuthShell } from "@/components/auth/auth-shell";
import { getCurrentEditor } from "@/server/auth/dal";
import { FlashToast } from "@/components/flash-toast";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = {
  title: "Editor sign in",
  alternates: { canonical: "/sign-in" },
  robots: { index: false, follow: true },
};

export default function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  return (
    <AuthShell
      title="Sign in to InkBoard"
      description="We'll email you a one-time code and a sign-in link. New here? Your account is created the first time you sign in."
    >
      {/* Reads the session cookie, so it sits behind its own boundary. */}
      <Suspense fallback={null}>
        <RedirectIfSignedIn />
      </Suspense>
      <Suspense fallback={null}>
        <SignedOutFlash searchParams={searchParams} />
      </Suspense>
      <SignInForm />
    </AuthShell>
  );
}

async function SignedOutFlash({ searchParams }: Pick<PageProps<"/sign-in">, "searchParams">) {
  const { "signed-out": signedOut } = await searchParams;
  return signedOut === "1" ? <FlashToast param="signed-out" title="Signed out" /> : null;
}

async function RedirectIfSignedIn() {
  const editor = await getCurrentEditor();
  if (editor) redirect(editor.penName ? "/admin" : "/admin/onboarding");
  return null;
}
