/**
 * Plausible analytics shim, pointed at the analytics host (stats.example.com).
 *
 * Renders nothing unless NODE_ENV is production. The tracked domain comes from
 * NEXT_PUBLIC_PLAUSIBLE_DOMAIN and falls back to the site domain.
 */
import { headers } from 'next/headers';
import { SITE } from '@/lib/site.config';

interface Props {
  domain?: string;
}

export async function Monitoring({ domain }: Props) {
  const d = domain ?? process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN ?? SITE.host;
  if (process.env.NODE_ENV !== 'production') return null;

  const nonce = (await headers()).get('x-csp-nonce') ?? undefined;
  return (
    <>
      <script
        defer
        data-domain={d}
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
