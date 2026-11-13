import { BoardView } from "@/components/board/board-view";
import { getBoardSections } from "@/server/board-cache";

// Cached reader data (tagged "board"), so the board is part of the static
// shell and admin edits invalidate it via updateTag (src/server/cache-tags.ts).
export default async function HomePage() {
  const sections = await getBoardSections();
  return (
    <main className="h-dvh">
      <h1 className="sr-only">InkBoard board</h1>
      <BoardView sections={sections} />
    </main>
  );
}
