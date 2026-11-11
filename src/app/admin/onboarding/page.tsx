import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireEditor } from "@/server/auth/dal";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = { title: "Welcome" };

export default function OnboardingPage() {
  return (
    <div className="mx-auto max-w-md">
      <Card>
        <CardHeader>
          <CardTitle className="font-serif text-2xl">Choose your pen name</CardTitle>
          <CardDescription>
            This is how readers will find you. It labels your section on the board,
            and you can change it later.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={<div className="h-24 animate-pulse rounded-md bg-muted" />}>
            <Onboarding />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}

async function Onboarding() {
  const editor = await requireEditor();
  if (editor.penName) redirect("/admin");
  return <OnboardingForm />;
}
