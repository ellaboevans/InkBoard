import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/auth-shell";
import { LinkSignInForm } from "./link-sign-in-form";

export const metadata: Metadata = {
  title: "Continue signing in",
  robots: { index: false, follow: false },
};

/**
 * Landing page for the sign-in link in the email (`/sign-in/link#<token>`).
 * Fully static: the token lives in the URL fragment, which browsers never
 * send to the server, and is only submitted when the person presses the
 * button. Mail scanners that pre-open links therefore can't consume it.
 */
export default function LinkSignInPage() {
  return (
    <AuthShell
      title="Continue signing in"
      description="You opened a sign-in link from your email. This will sign in this device."
    >
      <LinkSignInForm />
    </AuthShell>
  );
}
