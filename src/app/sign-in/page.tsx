import { FeatherIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getCurrentEditor } from "@/server/auth/dal";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Editor sign in" };

export default function SignInPage() {
  return (
    <main className="flex flex-1 items-center justify-center bg-canvas p-6">
      {/* Reads the session cookie, so it sits behind its own boundary. */}
      <Suspense fallback={null}>
        <RedirectIfSignedIn />
      </Suspense>

      <div className="w-full max-w-sm">
        <Link
          href="/"
          className="mb-6 flex items-center justify-center gap-2 font-serif text-2xl"
        >
          <FeatherIcon className="size-5 text-primary" aria-hidden />
          PoemHub
        </Link>
        <Card>
          <CardHeader>
            <CardTitle className="font-serif text-xl">Editor sign in</CardTitle>
            <CardDescription>
              We&apos;ll email you a one-time code.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SignInForm />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

async function RedirectIfSignedIn() {
  const editor = await getCurrentEditor();
  if (editor) redirect(editor.penName ? "/admin" : "/admin/onboarding");
  return null;
}
