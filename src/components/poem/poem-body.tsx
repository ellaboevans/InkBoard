import { PoemText } from "./poem-text";

/** A poem's full text as readers see it, with light Markdown. Shared by the reading view and the editor preview. */
export function PoemBody({ body, lang }: { body: string; lang?: string | null }) {
  return (
    <div lang={lang ?? undefined} className="font-serif text-lg leading-relaxed whitespace-pre-wrap sm:text-xl">
      <PoemText text={body} />
    </div>
  );
}
