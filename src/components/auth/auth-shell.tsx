import { FeatherIcon } from "lucide-react";
import Link from "next/link";
import { PoemBloom } from "./poem-bloom";

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
            InkBoard
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
        className="poem-bloom-host relative hidden overflow-hidden border-l bg-canvas [background-image:radial-gradient(var(--canvas-dot)_1px,transparent_1px)] [background-size:22px_22px] lg:flex lg:items-center lg:justify-center"
      >
        <PoemBloom />
      </aside>
    </main>
  );
}
