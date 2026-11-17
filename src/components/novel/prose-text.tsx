import { Fragment } from "react";
import { Nodes } from "@/components/poem/poem-text";
import { parseProse } from "@/lib/prose";

/**
 * A chapter's text (docs/PLAN.md, Phase 23): one <p> per paragraph, kept
 * line breaks as <br>, scene breaks as a separator, emphasis as in poems.
 * Paragraphs carry `data-p` (their number from 1), the anchor a reader's
 * saved place will scroll to. Styling (measure, indent) is the caller's.
 */
export function ProseText({ text }: { text: string }) {
  let n = 0;
  return parseProse(text).map((block, i) =>
    block.kind === "break" ? (
      <div key={i} role="separator" aria-label="Scene break" data-scene-break className="my-6 text-center text-muted-foreground">
        <span aria-hidden>⁂</span>
      </div>
    ) : (
      <p key={i} data-p={++n}>
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
