import { Fragment } from "react";
import { Nodes } from "@/components/poem/poem-text";
import { parseProse, type ProseBlock } from "@/lib/prose";

/** Opening punctuation (“ ‘ « ( " ' ¿ ¡ …): ::first-letter draws it large with the letter. */
const OPENING = /^[\p{Ps}\p{Pi}"'¡¿]/u;

function dropCapClass(block: Extract<ProseBlock, { kind: "paragraph" }>) {
  if (!block.dropCap) return undefined;
  const first = block.lines[0]?.[0];
  const text = typeof first === "string" ? first : "";
  // The quote mark doubles the initial's width, so on phones it sinks two lines, not three (globals.css).
  return OPENING.test(text) ? "prose-drop-cap prose-drop-cap-quoted" : "prose-drop-cap";
}

/**
 * A chapter's text (docs/PLAN.md, Phase 23): one <p> per paragraph, kept
 * line breaks as <br>, scene breaks as a separator, emphasis as in poems.
 * Paragraphs carry `data-p` (their number from 1), the anchor a reader's
 * saved place will scroll to. Styling (measure, indent) is the caller's,
 * except the drop cap a writer asked for (`^^`, Phase 24): the paragraph gets
 * `prose-drop-cap` (globals.css), drawn with ::first-letter, so the word stays
 * whole in the DOM for screen readers, copying and find.
 */
export function ProseText({ text }: { text: string }) {
  let n = 0;
  return parseProse(text).map((block, i) =>
    block.kind === "break" ? (
      <div key={i} role="separator" aria-label="Scene break" data-scene-break className="my-6 text-center text-muted-foreground">
        <span aria-hidden>⁂</span>
      </div>
    ) : (
      <p key={i} data-p={++n} className={dropCapClass(block)} data-drop-cap={block.dropCap ? "" : undefined}>
        {block.lines.map((line, j) => (
          <Fragment key={j}>
            {j > 0 && <br />}
            <Nodes nodes={line} />
          </Fragment>
        ))}
      </p>
    ),
  );
}
