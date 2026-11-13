/**
 * schema.org structured data. `<` is escaped so text from poems or profiles
 * can never close the script tag. JSON-LD isn't executed, so the CSP is fine.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}
