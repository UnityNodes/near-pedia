import { headers } from 'next/headers';

/**
 * Privacy-friendly analytics tracker. Reads the per-request CSP nonce
 * so the script tag passes the nonce-CSP gate set in middleware.ts.
 *
 * The external script is loaded with `defer` so it never blocks
 * paint; the inline shim defines the `window.plausible(...)` queue
 * so app code can fire custom events before the tracker bundle has
 * finished loading.
 */
export async function Plausible() {
  const nonce = (await headers()).get('x-csp-nonce') ?? undefined;
  return (
    <>
      <script
        defer
        data-domain="yourpedia.example"
        src="https://stats.example.com/js/script.file-downloads.hash.outbound-links.pageview-props.revenue.tagged-events.js"
        nonce={nonce}
      />
      <script
        nonce={nonce}
        dangerouslySetInnerHTML={{
          __html: 'window.plausible = window.plausible || function() { (window.plausible.q = window.plausible.q || []).push(arguments) }',
        }}
      />
    </>
  );
}
