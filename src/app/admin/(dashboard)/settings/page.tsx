import { BracesIcon, DownloadIcon, FileTextIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { pluralCount } from "@/lib/plural";
import { requireOnboardedEditor, requireOnboardedSession } from "@/server/auth/dal";
import { listPasskeys } from "@/server/auth/passkeys";
import { isSessionFresh } from "@/server/auth/step-up";
import { listCollections } from "@/server/collections";
import { getEditorStats } from "@/server/editor-stats";
import { getPasswordSettings } from "@/server/password-settings";
import { DeleteAccount } from "./delete-account";
import { PasswordSettingsForm } from "./password-settings-form";

export const metadata: Metadata = { title: "Settings" };

/*
 * Settings: how readers get into private poems, then the account itself
 * (Phase 17): download your poems, and, set apart at the bottom, delete the
 * account. They live here rather than on the profile, which is about how you
 * appear to readers and how you sign in; this page is about your work and
 * your account as a whole.
 */
export default function SettingsPage() {
  return (
    <div className="mx-auto grid w-full max-w-2xl gap-12">
      <section className="grid gap-6" aria-labelledby="settings-heading">
        <div>
          <h1 id="settings-heading" className="font-serif text-3xl">
            Settings
          </h1>
          <p className="mt-1 text-muted-foreground">
            Private poems, your poems as files, and your account. What InkBoard stores about you, and for how long, is
            on the{" "}
            <Link href="/privacy" className="text-foreground underline underline-offset-4">
              privacy page
            </Link>
            .
          </p>
        </div>
        <Suspense fallback={<div className="h-72 animate-pulse rounded-xl bg-muted" />}>
          <Settings />
        </Suspense>
      </section>

      <section id="download" className="grid scroll-mt-20 gap-4" aria-labelledby="download-heading">
        <div>
          <h2 id="download-heading" className="font-serif text-2xl">
            Download your poems
          </h2>
          <p className="mt-1 text-muted-foreground">Everything you&apos;ve written here, as files you keep.</p>
        </div>
        <Suspense fallback={<div className="h-56 animate-pulse rounded-xl bg-muted" />}>
          <Download />
        </Suspense>
      </section>

      <section
        id="delete-account"
        className="grid scroll-mt-20 gap-4 border-t pt-10"
        aria-labelledby="delete-account-heading"
      >
        <div>
          <h2 id="delete-account-heading" className="font-serif text-2xl">
            Delete account
          </h2>
          <p className="mt-1 text-muted-foreground">Leave InkBoard, and remove everything of yours from it.</p>
        </div>
        <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-muted" />}>
          <Delete />
        </Suspense>
      </section>
    </div>
  );
}

async function Settings() {
  const editor = await requireOnboardedEditor();
  const settings = await getPasswordSettings(editor.id);
  return <PasswordSettingsForm key={settings.mode} {...settings} />;
}

async function Download() {
  const editor = await requireOnboardedEditor();
  const [stats, collections] = await Promise.all([getEditorStats(editor.id), listCollections(editor.id)]);
  const formats = [
    {
      href: "/admin/export/markdown",
      icon: FileTextIcon,
      label: "Markdown (.md)",
      text: "One file to read in any text editor: your profile, then each poem with its details, collection by collection.",
    },
    {
      href: "/admin/export/json",
      icon: BracesIcon,
      label: "JSON (.json)",
      text: "The complete backup: every poem with its saved versions, your collections in order, and your profile.",
    },
  ];
  return (
    <div className="grid gap-5 rounded-xl border bg-card p-6">
      <p className="text-sm">
        {stats.total === 0
          ? "You haven't written any poems yet; the files will hold your profile."
          : `${pluralCount(stats.total, "poem")} (${pluralCount(stats.drafts, "draft")}) and ${pluralCount(collections.length, "collection")}.`}
      </p>
      <ul className="grid gap-4 sm:grid-cols-2">
        {formats.map(({ href, icon: Icon, label, text }) => (
          <li key={href} className="grid content-start gap-3 rounded-lg border p-4">
            <p className="flex items-center gap-2 font-medium">
              <Icon className="size-4 text-muted-foreground" aria-hidden />
              {label}
            </p>
            <p className="text-sm text-muted-foreground">{text}</p>
            <div>
              {/* A plain link: the route answers with a file, so the page stays put. */}
              <Button asChild variant="outline" size="sm">
                <a href={href}>
                  <DownloadIcon />
                  Download {label.split(" ")[0]}
                </a>
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <p className="text-sm text-muted-foreground">
        Drafts and private poems are included with their text, so keep the files somewhere private. Passwords and sign-in
        details never are.
      </p>
    </div>
  );
}

async function Delete() {
  const { editor, sessionId } = await requireOnboardedSession();
  const [fresh, keys, stats, collections] = await Promise.all([
    isSessionFresh(editor.id, sessionId),
    listPasskeys(editor.id),
    getEditorStats(editor.id),
    listCollections(editor.id),
  ]);
  return (
    <DeleteAccount
      penName={editor.penName}
      slug={editor.slug}
      email={editor.email}
      fresh={fresh}
      hasPasskeys={keys.length > 0}
      poemCount={stats.total}
      collectionCount={collections.length}
    />
  );
}
