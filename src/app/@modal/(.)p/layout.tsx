import { PoemModal } from "@/components/poem/poem-modal";

/**
 * The board overlay's shell for every intercepted /p/[author]/[poem]. At this
 * level (above [author] and [poem]) it stays mounted while you step between
 * poems, even another author's (search can open one), so only the page inside
 * it changes. It unmounts when the slot falls back to @modal/default.tsx,
 * page.tsx or [...catchAll], which clears the overlay.
 */
export default function PoemOverlayLayout({ children }: { children: React.ReactNode }) {
  return <PoemModal>{children}</PoemModal>;
}
