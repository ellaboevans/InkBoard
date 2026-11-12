import { LaptopIcon } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { requireOnboardedSession } from "@/server/auth/dal";
import { listSessions, type SessionSummary } from "@/server/auth/sessions";
import { getProfile } from "@/server/auth/profile";
import { getEditorStats } from "@/server/editor-stats";
import { listEditorPoems } from "@/server/poems";
import { avatarIdFor } from "@/lib/avatars";
import { EditorAvatar } from "@/components/admin/editor-avatar";
import { StatCards } from "@/components/admin/stat-cards";
import { describeUserAgent } from "@/lib/user-agent";
import { ProfileForm } from "./profile-form";
import { RevokeOtherSessionsButton, RevokeSessionButton } from "./session-buttons";

export const metadata: Metadata = { title: "Profile" };

export default function ProfilePage() {
  return (
    <div className="mx-auto grid w-full max-w-4xl gap-10">
      <section className="grid gap-6" aria-labelledby="profile-heading">
        <div>
          <h1 id="profile-heading" className="font-serif text-3xl">
            Profile
          </h1>
          <p className="mt-1 text-muted-foreground">How you appear to readers, and your writing so far.</p>
        </div>
        <Suspense fallback={<div className="h-[40rem] animate-pulse rounded-xl bg-muted" />}>
          <Profile />
        </Suspense>
      </section>

      <section className="grid gap-4" aria-labelledby="devices-heading">
        <div>
          <h2 id="devices-heading" className="font-serif text-2xl">
            Signed-in devices
          </h2>
          <p className="mt-1 text-muted-foreground">
            Each sign-in lasts 30 days. Sign out any device you don&apos;t recognise.
          </p>
        </div>
        <Suspense fallback={<div className="h-40 animate-pulse rounded-xl bg-muted" />}>
          <Devices />
        </Suspense>
      </section>
    </div>
  );
}

async function Profile() {
  const { editor } = await requireOnboardedSession();
  const [profile, stats, poems] = await Promise.all([
    getProfile(editor.id),
    getEditorStats(editor.id),
    listEditorPoems(editor.id),
  ]);
  if (!profile) return null;
  const avatar = profile.avatar ?? avatarIdFor(editor);
  const published = poems.filter((p) => p.status === "published").map((p) => ({ id: p.id, title: p.title }));
  const pinned = published.find((p) => p.id === profile.pinnedPoemId);
  return (
    <div className="grid gap-6">
      <div className="flex flex-col gap-4 rounded-xl border bg-card p-6 sm:flex-row sm:items-center">
        <EditorAvatar editor={{ id: editor.id, avatar }} size={72} className="size-18" />
        <div className="grid min-w-0 gap-1">
          <p className="truncate font-serif text-2xl">{profile.penName}</p>
          {profile.tagline && <p className="text-muted-foreground">{profile.tagline}</p>}
          <p className="text-sm text-muted-foreground">
            {stats.firstPublishedAt
              ? `On the board since ${dateFormat.format(stats.firstPublishedAt)}`
              : "Not on the board yet"}
            {pinned && <> · Pinned: &ldquo;{pinned.title}&rdquo;</>}
          </p>
        </div>
      </div>
      <StatCards stats={stats} />
      <ProfileForm
        key={JSON.stringify(profile)}
        initial={{ ...profile, avatar }}
        slug={editor.slug}
        publishedPoems={published}
      />
    </div>
  );
}

const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium" });

async function Devices() {
  const { editor, sessionId } = await requireOnboardedSession();
  const sessions = await listSessions(editor.id, sessionId);
  const others = sessions.filter((s) => !s.current).length;
  return (
    <div className="grid gap-4">
      <ul className="divide-y rounded-xl border bg-card">
        {sessions.map((s) => (
          <DeviceRow key={s.id} session={s} />
        ))}
      </ul>
      {others > 0 && (
        <div className="flex justify-end">
          <RevokeOtherSessionsButton />
        </div>
      )}
    </div>
  );
}

function DeviceRow({ session: s }: { session: SessionSummary }) {
  const label = describeUserAgent(s.userAgent);
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <LaptopIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="grid min-w-0 flex-1 gap-0.5">
        <p className="flex flex-wrap items-center gap-2 font-medium">
          {label}
          {s.current && (
            <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-normal text-muted-foreground">
              This device
            </span>
          )}
        </p>
        <p className="truncate text-sm text-muted-foreground">
          Signed in {dateFormat.format(s.createdAt)}
          {s.ip && <> · {s.ip}</>}
          {" · "}expires {dateFormat.format(s.expiresAt)}
        </p>
      </div>
      {!s.current && <RevokeSessionButton sessionId={s.id} label={label} />}
    </li>
  );
}
