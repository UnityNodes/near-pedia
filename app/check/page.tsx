import Link from 'next/link';
import { pageMetadata } from '@/lib/seo';
import { PageShell } from '@/components/page-shell';
import { CheckApp } from './check-app';
import { EXAMPLE_CODE, EXAMPLE_FILENAME } from './example';
import { MAX_CODE_CHARS } from '@/lib/check-code';
import './check.css';

export const metadata = pageMetadata({
  title: 'Check NEAR code',
  description: 'Paste a NEAR contract, script, package.json or Cargo.toml and see each line that uses something NEAR removed, deprecated or changed, with the replacement and the source. No key.',
  path: '/check',
});

export default function CheckPage() {
  return (
    <PageShell
      href="/check"
      title="Check code"
      description={<>Paste one JS/TS or Rust file, a <code>package.json</code> or a <code>Cargo.toml</code>. Each line that imports, calls or depends on something NEAR removed, deprecated or changed comes back with what to use instead and the source it is based on. The same <code>check_code</code> an agent calls over <Link href="/for-ai" className="pg-link">MCP</Link> or <code>POST /api/v1/check-code</code>, with no key.</>}
    >
      <CheckApp exampleCode={EXAMPLE_CODE} exampleFilename={EXAMPLE_FILENAME} maxChars={MAX_CODE_CHARS} />
    </PageShell>
  );
}
