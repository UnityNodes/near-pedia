import type { Metadata } from 'next';
import type { JSX } from 'react';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getDb } from '@/lib/db';
import { formatDate } from '@/lib/utils';
import { SITE } from '@/lib/site.config';
import type { Tone } from '@/lib/status';
import { BackLink, MetaLine, ReaderHead, ReaderPage } from '@/components/reader-shell';

export const dynamic = 'force-dynamic';

interface GithubItem {
  id: string;
  type: string;
  repo: string;
  number: number;
  title: string;
  body: string | null;
  state: string;
  author: string | null;
  created_at: string | null;
  url: string;
  labels: string | null;
  board_status: string | null;
}

function getItem(id: string): GithubItem | null {
  const db = getDb();
  return db.prepare('SELECT * FROM github_items WHERE id = ?').get(id) as GithubItem | null;
}

interface PageProps {
  params: Promise<{ slug: string[] }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const [org, repo, number] = slug;
  if (!org || !repo || !number) return {};
  const id = `${org}/${repo}#${number}`;
  const item = getItem(id);
  if (!item) return { title: 'Not Found' };

  const title = `#${item.number} ${item.title}`;
  const brandedTitle = `${title} | ${SITE.name}`;
  const body = (item.body ?? '')
    .replace(/^#{1,6}\s+.*$/gm, '')
    .replace(/[`*_>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
  const description = body || `NEAR GitHub ${item.type === 'pr' ? 'pull request' : 'issue'} #${item.number} in ${item.repo}.`;
  const path = `/proposals/${id.replace('#', '/')}`;

  return {
    title,
    description,
    alternates: { canonical: `${SITE.url}${path}` },
    openGraph: {
      type: 'article',
      title: brandedTitle,
      description,
      url: `${SITE.url}${path}`,
      // images auto-merged from app/proposals/[...slug]/opengraph-image.tsx
    },
    twitter: { card: 'summary_large_image', title: brandedTitle, description },
  };
}

// STATE_CONFIG only supplies the label string now — color/background come
// from .pill[data-status] in globals.css, the same mechanism every status
// pill uses, so a PR/issue badge looks like every other status badge on
// the site instead of its own one-off hex-coded variant.
const STATE_LABEL: Record<string, string> = {
  open: 'Open',
  closed: 'Closed',
  merged: 'Merged',
};

const TYPE_LABEL: Record<string, string> = {
  pr:    'Pull Request',
  issue: 'Issue',
};

const LABEL_TONE_MAP: Array<{ match: RegExp; tone: Tone }> = [
  { match: /bug|error|fix/i,       tone: 'bad' },
  { match: /feat|enhance|new/i,    tone: 'info' },
  { match: /doc|spec|rfc/i,        tone: 'lime' },
  { match: /security|vuln|cve/i,   tone: 'bad' },
  { match: /good.first|help/i,     tone: 'ok' },
  { match: /wip|draft|progress/i,  tone: 'lime' },
];

function getLabelTone(label: string): Tone {
  return LABEL_TONE_MAP.find(rule => rule.match.test(label))?.tone ?? 'mute';
}

function renderBody(text: string): JSX.Element[] {
  const lines = text.split(/\r?\n/);
  const elements: JSX.Element[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Empty line - skip
    if (!line.trim()) { i++; continue; }

    // Heading - treat each heading line independently
    const hm = line.match(/^(#{1,6})\s+(.+)$/);
    if (hm) {
      const level = Math.min(hm[1].length, 4);
      const Tag = (['h2','h3','h4','h4'] as const)[level - 1];
      elements.push(<Tag key={key++} dangerouslySetInnerHTML={{ __html: inlineFormat(hm[2]) }} />);
      i++;
      continue;
    }

    // Fenced code block
    if (line.startsWith('```')) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) { codeLines.push(lines[i]); i++; }
      i++; // closing ```
      elements.push(<pre key={key++}><code>{codeLines.join('\n')}</code></pre>);
      continue;
    }

    // Blockquote
    if (line.startsWith('>')) {
      const bqLines: string[] = [];
      while (i < lines.length && lines[i].startsWith('>')) { bqLines.push(lines[i].replace(/^>\s?/, '')); i++; }
      elements.push(<blockquote key={key++} dangerouslySetInnerHTML={{ __html: inlineFormat(bqLines.join(' ')) }} />);
      continue;
    }

    // Unordered list
    if (/^[-*+]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*+]\s/.test(lines[i])) { items.push(lines[i].replace(/^[-*+]\s+/, '')); i++; }
      elements.push(<ul key={key++}>{items.map((it, j) => <li key={j} dangerouslySetInnerHTML={{ __html: inlineFormat(it) }} />)}</ul>);
      continue;
    }

    // Ordered list
    if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) { items.push(lines[i].replace(/^\d+\.\s+/, '')); i++; }
      elements.push(<ol key={key++}>{items.map((it, j) => <li key={j} dangerouslySetInnerHTML={{ __html: inlineFormat(it) }} />)}</ol>);
      continue;
    }

    // Paragraph - collect until blank line or block element
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^#{1,6}\s/.test(lines[i]) &&
      !lines[i].startsWith('```') &&
      !lines[i].startsWith('>') &&
      !/^[-*+]\s/.test(lines[i]) &&
      !/^\d+\.\s/.test(lines[i])
    ) { paraLines.push(lines[i]); i++; }
    if (paraLines.length) {
      elements.push(<p key={key++} dangerouslySetInnerHTML={{ __html: inlineFormat(paraLines.join(' ')) }} />);
    }
  }

  return elements;
}

function inlineFormat(text: string): string {
  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return escape(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}

export default async function ProposalDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const [org, repo, number] = slug;
  if (!org || !repo || !number) notFound();

  const id = `${org}/${repo}#${number}`;
  const item = getItem(id);
  if (!item) notFound();

  const labels = item.labels ? item.labels.split(',').map(s => s.trim()).filter(Boolean) : [];
  const stateLabel = STATE_LABEL[item.state] ?? item.state;
  const bodyNodes = item.body ? renderBody(item.body) : null;

  return (
    <ReaderPage
      crumbs={[
        { label: 'Proposals', href: '/proposals' },
        { label: `${org}/${repo}`, href: `/proposals?repo=${org}%2F${repo}` },
        { label: `#${number}` },
      ]}
    >
      <ReaderHead
        tags={
          <>
            <span className="pill" data-status={stateLabel}>{stateLabel}</span>
            <span className="pg-tag">{TYPE_LABEL[item.type] ?? item.type}</span>
            {item.board_status && <span className="pg-tag" data-tone="lime">{item.board_status}</span>}
            {labels.map(l => <span key={l} className="pg-tag" data-tone={getLabelTone(l)}>{l}</span>)}
          </>
        }
        title={item.title}
        meta={
          <MetaLine
            items={[
              item.author ? <span key="a">by <b>{item.author}</b></span> : null,
              item.created_at ? <span key="c">Created {formatDate(item.created_at)}</span> : null,
              <span key="r">{org}/{repo}</span>,
            ]}
          />
        }
        actions={
          <a href={item.url} target="_blank" rel="noopener noreferrer" className="pg-btn pg-btn--line">
            View on GitHub<ExternalLink size={14} strokeWidth={1.75} aria-hidden="true" />
          </a>
        }
      />

      {bodyNodes && bodyNodes.length > 0 ? (
        <div className="rd-prose">
          {bodyNodes}
        </div>
      ) : (
        <div className="rd-empty">
          <p>No description provided.</p>
        </div>
      )}

      <BackLink href="/proposals"><ArrowLeft size={14} strokeWidth={1.75} aria-hidden="true" />Back to Proposals</BackLink>
    </ReaderPage>
  );
}
