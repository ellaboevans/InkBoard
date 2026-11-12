import { BookOpenIcon, CalendarIcon, LockIcon, PenLineIcon } from "lucide-react";
import type { EditorStats } from "@/server/editor-stats";

const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium" });

/** Real counts only (we don't track readers, so there are no view numbers). */
export function StatCards({ stats }: { stats: EditorStats }) {
  const items: { label: string; value: string; hint: string; icon: typeof BookOpenIcon; small?: boolean }[] = [
    { label: "Published", value: String(stats.published), hint: "On the board", icon: BookOpenIcon },
    { label: "Drafts", value: String(stats.drafts), hint: "Only you can see these", icon: PenLineIcon },
    { label: "Private", value: String(stats.privatePublished), hint: "Published behind a password", icon: LockIcon },
    {
      label: "Last published",
      value: stats.lastPublishedAt ? dateFormat.format(stats.lastPublishedAt) : "—",
      hint: stats.firstPublishedAt ? `First poem ${dateFormat.format(stats.firstPublishedAt)}` : "Nothing published yet",
      icon: CalendarIcon,
      small: true,
    },
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
      {items.map(({ label, value, hint, icon: Icon, small }) => (
        <div key={label} className="grid gap-1 rounded-xl border bg-card p-4 lg:p-5">
          <dt className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
            {label}
            <Icon className="size-4" aria-hidden />
          </dt>
          <dd className={small ? "font-serif text-xl whitespace-nowrap tabular-nums" : "font-serif text-2xl tabular-nums lg:text-3xl"}>
            {value}
          </dd>
          <dd className="text-xs text-muted-foreground">{hint}</dd>
        </div>
      ))}
    </dl>
  );
}

