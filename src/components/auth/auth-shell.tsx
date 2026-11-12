import { FeatherIcon } from "lucide-react";
import Link from "next/link";

/**
 * Sign-in and onboarding layout (shadcn login-02): the form on the left, a
 * typographic panel on the dotted board canvas on the right (large screens
 * only). No image: everything is text, so it stays crisp and CSP-friendly.
 */
export function AuthShell({
  title,
  description,
  children,
}: {
  title: string;
  description: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <main className="grid min-h-svh flex-1 lg:grid-cols-2">
      <div className="flex flex-col gap-4 p-6 md:p-10">
        <div className="flex justify-center md:justify-start">
          <Link href="/" className="flex items-center gap-2 font-serif text-lg">
            <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <FeatherIcon className="size-4" aria-hidden />
            </span>
            PoemHub
          </Link>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="grid w-full max-w-sm gap-6">
            <div className="grid gap-1 text-center">
              <h1 className="font-serif text-3xl">{title}</h1>
              <p className="text-sm text-balance text-muted-foreground">{description}</p>
            </div>
            {children}
          </div>
        </div>
      </div>
      <aside
        aria-hidden
        className="relative hidden overflow-hidden border-l bg-canvas [background-image:radial-gradient(var(--canvas-dot)_1px,transparent_1px)] [background-size:22px_22px] lg:flex lg:items-center lg:justify-center"
      >
        <figure className="max-w-sm rotate-[-1.5deg] rounded-2xl border bg-card p-8 shadow-[0_1px_2px_oklch(0_0_0/0.06),0_12px_32px_-12px_oklch(0_0_0/0.18)]">
          <p className="font-serif text-2xl leading-snug">Ink Hour</p>
          <blockquote className="mt-4 font-serif text-lg leading-relaxed whitespace-pre-line text-muted-foreground">
            {"the kettle hums its one low note,\nthe lamp leans in to read,\nand every word I haven't said\n    is waiting, like a seed."}
          </blockquote>
          <figcaption className="mt-6 text-sm text-muted-foreground">Write it down. Pin it to the board.</figcaption>
        </figure>
      </aside>
    </main>
  );
}
