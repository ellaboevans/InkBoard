import { Fragment } from "react";
import { parsePoem, type PoemNode } from "@/lib/poem-markdown";

/**
 * Poem text with light Markdown (see src/lib/poem-markdown.ts), as inline
 * elements and "\n" text, so the parent's `whitespace-pre-*` keeps the
 * lines. Renders anywhere (server or client, inside <p> or <span>).
 *
 * `truncated`: the text is a cut-off excerpt, so emphasis still open at the
 * end is closed there instead of showing a stray `*`.
 */
export function PoemText({ text, truncated = false }: { text: string; truncated?: boolean }) {
  return parsePoem(text, { truncated }).map((line, i) => (
    <Fragment key={i}>
      {i > 0 && "\n"}
      <Nodes nodes={line} />
    </Fragment>
  ));
}

/** Inline emphasis nodes (light Markdown), also used for chapter prose (src/components/novel/prose-text.tsx). */
export function Nodes({ nodes }: { nodes: PoemNode[] }) {
  return nodes.map((n, i) => {
    if (typeof n === "string") return <Fragment key={i}>{n}</Fragment>;
    const Tag = n.kind === "strong" ? "strong" : "em";
    return (
      <Tag key={i} className={n.kind === "strong" ? "font-semibold" : undefined}>
        <Nodes nodes={n.children} />
      </Tag>
    );
  });
}
