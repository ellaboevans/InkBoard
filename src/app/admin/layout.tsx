import { FeatherIcon, SettingsIcon, UserRoundIcon } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { getCurrentEditor } from "@/server/auth/dal";
import { SignOutButton } from "./sign-out-button";

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="sticky top-0 z-10 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-6">
          <Link href="/admin" className="flex items-center gap-2 font-serif text-lg">
            <FeatherIcon className="size-4 text-primary" aria-hidden />
            PoemHub
            <span className="rounded-md bg-secondary px-1.5 py-0.5 font-sans text-xs text-muted-foreground">
              Editor
            </span>
          </Link>
          <Suspense fallback={null}>
            <EditorMenu />
          </Suspense>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">{children}</main>
    </div>
  );
}

async function EditorMenu() {
  const editor = await getCurrentEditor();
  if (!editor) return null;
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="hidden text-muted-foreground sm:inline">
        {editor.penName ?? editor.email}
      </span>
      {editor.penName && (
        <>
          <Button asChild variant="ghost" size="sm">
            <Link href="/admin/profile">
              <UserRoundIcon />
              Profile
            </Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href="/admin/settings">
              <SettingsIcon />
              Settings
            </Link>
          </Button>
        </>
      )}
      <SignOutButton />
    </div>
  );
}
