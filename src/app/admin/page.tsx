import { PenLineIcon, PlusIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { StatusBadge, VisibilityBadge } from "@/components/poem-badges";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireOnboardedEditor } from "@/server/auth/dal";
import { listEditorPoems, type EditorPoemSummary } from "@/server/poems";
import { FlashToast } from "@/components/flash-toast";

export const metadata: Metadata = { title: "Your poems" };

export default function AdminHomePage(props: PageProps<"/admin">) {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <Dashboard {...props} />
    </Suspense>
  );
}

async function Dashboard({ searchParams }: PageProps<"/admin">) {
  const editor = await requireOnboardedEditor();
  const poems = await listEditorPoems(editor.id);
  const flash = await searchParams;
  const published = poems.filter((p) => p.status === "published").length;

  return (
    <div className="grid gap-8">
      {flash.deleted === "1" && <FlashToast param="deleted" title="Poem deleted" />}
      {flash["signed-in"] === "1" && (
        <FlashToast param="signed-in" title="Signed in" description={`Welcome back, ${editor.penName}.`} />
      )}
      {flash.welcome === "1" && (
        <FlashToast
          param="welcome"
          title="You're all set"
          description={`Your poems will appear on the board under “${editor.penName}”.`}
        />
      )}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl">Your poems</h1>
          <p className="mt-1 text-muted-foreground">
            {poems.length === 0
              ? <>They&apos;ll appear on the board under &ldquo;{editor.penName}&rdquo;.</>
              : <>{published} of {poems.length} published under &ldquo;{editor.penName}&rdquo;.</>}
          </p>
        </div>
        {poems.length > 0 && <NewPoemButton />}
      </div>

      {poems.length === 0 ? <EmptyState /> : <PoemTable poems={poems} />}
    </div>
  );
}

function NewPoemButton() {
  return (
    <Button asChild size="lg">
      <Link href="/admin/poems/new">
        <PlusIcon />
        New poem
      </Link>
    </Button>
  );
}

const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium" });

function PoemTable({ poems }: { poems: EditorPoemSummary[] }) {
  return (
    <div className="rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-4">Title</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Access</TableHead>
            <TableHead className="hidden pr-4 text-right sm:table-cell">Last edited</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {poems.map((poem) => (
            <TableRow key={poem.id} className="relative">
              <TableCell className="max-w-0 pl-4 font-serif text-base">
                {/* Stretched link: the whole row is clickable, one tab stop. */}
                <Link
                  href={`/admin/poems/${poem.id}`}
                  className="block truncate after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
                >
                  {poem.title}
                </Link>
              </TableCell>
              <TableCell className="w-28">
                <StatusBadge status={poem.status} />
              </TableCell>
              <TableCell className="w-28">
                <VisibilityBadge visibility={poem.visibility} />
              </TableCell>
              <TableCell className="hidden w-36 pr-4 text-right text-muted-foreground tabular-nums sm:table-cell">
                {dateFormat.format(poem.updatedAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed bg-card py-16 text-center">
      <PenLineIcon className="size-8 text-muted-foreground" aria-hidden />
      <p className="font-serif text-xl">No poems yet</p>
      <p className="max-w-sm text-sm text-muted-foreground">
        Write your first poem. You can keep it as a draft, publish it for everyone,
        or protect it with a password.
      </p>
      <Button asChild size="lg" className="mt-2">
        <Link href="/admin/poems/new">
          <PlusIcon />
          Write a poem
        </Link>
      </Button>
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
