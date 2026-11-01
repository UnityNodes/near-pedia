import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { JsonLd } from '@/components/json-ld';
import { AsideCard, BackLink, KeyValues, MetaLine, ReaderHead, ReaderPage } from '@/components/reader-shell';
import { SITE } from '@/lib/site.config';
import { sanitizeDocHtml } from '@/lib/sanitize';
import { formatDateLong } from '@/lib/utils';
import type { ReleaseDetail, ReleaseItem } from '@/lib/releases';

const LINE_LIST_MAX = 8;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function lineWindow(inLine: ReleaseItem[], current: ReleaseItem): ReleaseItem[] {
  const at = inLine.findIndex(i => i.id === current.id);
  const start = Math.max(0, Math.min(at - Math.floor(LINE_LIST_MAX / 2), inLine.length - LINE_LIST_MAX));
  return inLine.slice(start, start + LINE_LIST_MAX);
}

function Status({ detail }: { detail: ReleaseDetail }) {
  const { item, latestInLine, latestOfProduct } = detail;
  const lines: ReactNode[] = [];
  if (item.prerelease) lines.push(<>A pre-release, not marked stable on GitHub.</>);
  if (latestInLine && latestInLine.id !== item.id) {
    lines.push(<>The newest stable release in the {item.line} line: <Link href={`/releases/${latestInLine.id}`}>{latestInLine.title}</Link></>);
  } else if (latestInLine) {
    lines.push(<>The latest release in the {item.line} line.</>);
  }
  if (latestOfProduct && latestOfProduct.line !== item.line) {
    lines.push(<>Newest {item.name}: <Link href={`/releases/${latestOfProduct.id}`}>{latestOfProduct.title}</Link></>);
  }
  if (lines.length === 0) return null;
  return (
    <ul className="rd-note">
      {lines.map((l, i) => <li key={i}>{l}</li>)}
    </ul>
  );
}

export function ReleasePageContent({ detail }: { detail: ReleaseDetail }) {
  const { item, html, inLine } = detail;
  const host = hostOf(item.sourceUrl);
  const pageUrl = `${SITE.url}/releases/${item.id}`;
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    headline: item.title,
    description: item.summary || undefined,
    url: pageUrl,
    datePublished: item.date ?? undefined,
    about: { '@type': 'SoftwareApplication', name: item.name, softwareVersion: item.version },
    sameAs: item.sourceUrl,
    isPartOf: { '@type': 'WebSite', name: SITE.name, url: SITE.url },
  };
  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE.url },
      { '@type': 'ListItem', position: 2, name: 'Releases', item: `${SITE.url}/releases` },
      { '@type': 'ListItem', position: 3, name: item.title, item: pageUrl },
    ],
  };
  const nearby = lineWindow(inLine, item);

  const aside = (
    <>
      <AsideCard title="About this release">
        <KeyValues
          rows={[
            { k: 'Product', v: item.name },
            { k: 'Version', v: <span className="rd-kv-mono">{item.version}</span> },
            item.date ? { k: 'Released', v: formatDateLong(item.date) } : null,
            { k: 'Repository', v: <span className="rd-kv-mono">{item.repo}</span> },
            { k: 'Stability', v: item.prerelease ? 'Pre-release' : 'Stable' },
          ]}
        />
      </AsideCard>
      {nearby.length > 1 ? (
        <AsideCard title={`The ${item.line} line`}>
          <ol className="rd-line">
            {nearby.map(r => (
              <li key={r.id}>
                {r.id === item.id
                  ? <span aria-current="page">{r.version}</span>
                  : <Link href={`/releases/${r.id}`}>{r.version}</Link>}
                {r.date ? <time dateTime={r.date}>{formatDateLong(r.date)}</time> : null}
              </li>
            ))}
          </ol>
        </AsideCard>
      ) : null}
    </>
  );

  return (
    <>
      <JsonLd payload={schema} />
      <JsonLd payload={breadcrumb} />
      <ReaderPage crumbs={[{ label: 'Releases', href: '/releases' }, { label: item.title }]} aside={aside}>
        <ReaderHead
          tags={
            <>
              <span className="pg-tag" data-tone="lime">{item.name}</span>
              <span className="pg-tag" data-tone={item.prerelease ? 'bad' : 'ok'}>{item.prerelease ? 'Pre-release' : 'Stable'}</span>
            </>
          }
          title={item.title}
          meta={
            <MetaLine
              items={[
                item.date ? <time key="d" dateTime={item.date}>{formatDateLong(item.date)}</time> : null,
                <span key="t">{item.tag}</span>,
                host ? <span key="h">{host}</span> : null,
              ]}
            />
          }
          lede={item.summary || undefined}
          actions={
            <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer" className="pg-btn pg-btn--line">
              {item.sourceLabel}<ExternalLink size={14} strokeWidth={1.75} aria-hidden="true" />
              <span className="pg-sr"> (opens in a new tab)</span>
            </a>
          }
        />
        <Status detail={detail} />

        {html ? (
          <div className="rd-prose rd-body" dangerouslySetInnerHTML={{ __html: sanitizeDocHtml(html) }} />
        ) : (
          <div className="rd-empty">
            <p>This release was published without notes. The original is linked above.</p>
          </div>
        )}

        <BackLink href={`/releases?product=${item.product}`}><ArrowLeft size={14} strokeWidth={1.75} aria-hidden="true" />All {item.name} releases</BackLink>
      </ReaderPage>
    </>
  );
}
