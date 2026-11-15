/**
 * Tells the service worker whether this page may be saved for offline reading
 * (src/lib/offline/rules.ts, rule 3). Every reader page renders one: "save"
 * with what the offline page lists, or "never" (a private poem: nothing about
 * it is stored, even after a reader unlocks it). React hoists these into <head>.
 */
export function OfflineMarker(
  props: { save: false } | { save: true; kind: "board" | "poem" | "author" | "collection"; title: string; author?: string },
) {
  if (!props.save) return <meta name="inkboard-offline" content="never" />;
  return (
    <>
      <meta name="inkboard-offline" content="save" />
      <meta name="inkboard-offline-kind" content={props.kind} />
      <meta name="inkboard-offline-title" content={props.title} />
      {props.author && <meta name="inkboard-offline-author" content={props.author} />}
    </>
  );
}
