import { BookOpenTextIcon, LockIcon, PenLineIcon } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireOnboardedEditor } from "@/server/auth/dal";

export const metadata: Metadata = { title: "Dashboard" };

export default function AdminHomePage() {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <Dashboard />
    </Suspense>
  );
}

async function Dashboard() {
  const editor = await requireOnboardedEditor();
  return (
    <div className="grid gap-8">
      <div>
        <h1 className="font-serif text-3xl">Welcome, {editor.penName}</h1>
        <p className="mt-1 text-muted-foreground">
          Your poems appear on the board under the section &ldquo;
          {editor.penName}&rdquo;.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-serif text-xl">
            <BookOpenTextIcon className="size-5 text-primary" aria-hidden />
            Your poems
          </CardTitle>
          <CardDescription>
            Write poems, choose public or password-protected, and publish them to the board.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-12 text-center">
            <PenLineIcon className="size-8 text-muted-foreground" aria-hidden />
            <p className="font-serif text-lg">No poems yet</p>
            <p className="flex max-w-sm items-center gap-1.5 text-sm text-muted-foreground">
              <LockIcon className="size-3.5 shrink-0" aria-hidden />
              Poem editing is coming in the next release.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="grid animate-pulse gap-8" aria-busy>
      <div className="h-9 w-64 rounded-md bg-muted" />
      <div className="h-64 rounded-xl bg-muted" />
    </div>
  );
}
