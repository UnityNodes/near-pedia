import { headers } from 'next/headers';

/**
 * Reads the per-request CSP nonce from middleware and emits a
 * <script type="application/ld+json" nonce="…">. Drop-in replacement
 * for the hand-rolled inline script tags scattered around the app.
 *
 * Usage in a server component:
 *
 *   const schema = breadcrumbList([...]);
 *   return <JsonLd payload={schema} />
 *
 * When `payload` is an array, emits one <script> per entry so each
 * JSON-LD object renders as its own block (Google's parser is
 * happier with that than with @graph arrays).
 */
export async function JsonLd({ payload }: { payload: unknown | unknown[] }) {
  const nonce = (await headers()).get('x-csp-nonce') ?? undefined;
  const items = Array.isArray(payload) ? payload : [payload];
  return (
    <>
      {items.map((item, i) => (
        <script
          key={i}
          type="application/ld+json"
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: JSON.stringify(item) }}
        />
      ))}
    </>
  );
}
