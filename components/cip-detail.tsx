import type {
  CipRow,
  CipStatusHistoryRow,
  CipAttachmentRow,
  CipForumMention,
  CipBlogMention,
  CipOtherMention,
  CipProposalMention,
} from '@/lib/cips';
import { extractHeadings } from '@/lib/cips';
import { MarkdownRenderer } from '@/lib/parsers/markdown';
import { CipToc } from './cip-toc';
import { RelatedPanel } from './related-panel';
import { getRelated } from '@/lib/related';
import { formatDate, formatAuthor } from '@/lib/utils';
import { ExternalLink, Rss } from 'lucide-react';
import { AsideCard, KeyValues, LinkCards, MetaLine, ReaderHead, ReaderPage, RelCard } from '@/components/reader-shell';
import { CipTldr } from './cip-tldr';
import { CipStatusTimeline } from './cip-status-timeline';
import { CipAttachmentsList } from './cip-attachments-list';

export async function CipDetail({
  cip,
  history = [],
  attachments = [],
  forumMentions = [],
  blogMentions = [],
  otherCipMentions = [],
  proposalMentions = [],
}: {
  cip: CipRow;
  history?: CipStatusHistoryRow[];
  attachments?: CipAttachmentRow[];
  forumMentions?: CipForumMention[];
  blogMentions?: CipBlogMention[];
  otherCipMentions?: CipOtherMention[];
  proposalMentions?: CipProposalMention[];
}) {
  const related = getRelated('cip', cip.id, 5);
  const cleanMd = cip.content_md
    ? cip.content_md.replace(/<pre>[\s\S]*?<\/pre>/i, '').trim()
    : null;
  const headings = cleanMd ? extractHeadings(cleanMd) : [];
  const isDraft = cip.status === 'In Review';
  // your-org/CIPs stores files flat as cips/cip-NNN.md with 3-digit
  // padding (cips/cip-051.md), not a per-CIP CIP-NNNN/README.md directory -
  // the old template literal here 404'd for every single CIP, not just
  // drafts, since nothing in this repo has ever used that layout.
  const cipFileNum = String(cip.cip_number ?? parseInt(cip.id, 10)).padStart(3, '0');
  const githubUrl = isDraft && cip.pr_url
    ? cip.pr_url
    : `https://github.com/your-org/CIPs/blob/main/cips/cip-${cipFileNum}.md`;
  // Relative links/images inside a CIP body (25 of 51 CIPs have one) resolve
  // against the directory the file actually lives in - cips/, not repo root.
  // Missing that segment 404'd every relative image/link on those 25 pages.
  const githubBase = `https://github.com/your-org/CIPs/blob/main/cips`;
  const feedUrl = `https://yourpedia.example/api/feed/cip/${cip.id}`;

  const padded = String(cip.cip_number ?? cip.id).padStart(4, '0');
  const mentionCount = blogMentions.length + proposalMentions.length + otherCipMentions.length;

  const aside = (
    <>
      <AsideCard title="Metadata">
        <KeyValues
          rows={[
            { k: 'Status', v: cip.status ? <span className="pill" data-status={cip.status}>{cip.status}</span> : '-' },
            cip.type ? { k: 'Type', v: cip.type } : null,
            cip.author ? { k: 'Author', v: formatAuthor(cip.author) } : null,
            cip.created_date ? { k: 'Created', v: formatDate(cip.created_date) } : null,
            cip.approved_date ? { k: 'Approved', v: formatDate(cip.approved_date) } : null,
            cip.license ? { k: 'License', v: cip.license } : null,
            cip.requires ? { k: 'Requires', v: `CIP-${cip.requires}` } : null,
          ]}
        />
      </AsideCard>

      {headings.length > 0 && (
        <AsideCard title="Contents">
          <CipToc headings={headings} />
        </AsideCard>
      )}

      {history.length > 0 && (
        <AsideCard title="Status history" count={history.length}>
          <CipStatusTimeline history={history} />
        </AsideCard>
      )}

      {attachments.length > 0 && (
        <AsideCard title="Attachments" count={attachments.length}>
          <CipAttachmentsList attachments={attachments} />
        </AsideCard>
      )}

      {forumMentions.length > 0 && (
        <LinkCards title="Discussed in" count={forumMentions.length}>
          {forumMentions.map(t => (
            <RelCard
              key={`forum-${t.topic_id}`}
              href={`/discussions/${t.topic_id}`}
              tag="Forum"
              tone="info"
              meta={`${t.posts_count} posts`}
              title={t.title}
            />
          ))}
        </LinkCards>
      )}

      {mentionCount > 0 && (
        <LinkCards title="Mentioned in" count={mentionCount}>
          {otherCipMentions.map(c => (
            <RelCard
              key={`cip-${c.id}`}
              href={`/cips/${c.id}`}
              tag={`CIP-${String(c.cip_number ?? c.id).padStart(4, '0')}`}
              tone="lime"
              meta={c.status ?? undefined}
              title={c.title ?? `CIP-${c.cip_number ?? c.id}`}
            />
          ))}
          {proposalMentions.map(p => (
            <RelCard
              key={`prop-${p.id}`}
              href={`/proposals/${p.id.replace('#', '/')}`}
              tag={`Proposal #${p.number}`}
              meta={p.board_status ?? p.state}
              title={p.title}
            />
          ))}
          {blogMentions.map(b => {
            const tag = (b.tags ?? '').split(',')[0] ?? '';
            const path = tag === 'release-notes' ? `/releases/${b.id}` : `/blog/${b.id}`;
            return (
              <RelCard
                key={`blog-${b.id}`}
                href={path}
                tag={tag || 'Blog'}
                meta={b.published_at ? b.published_at.slice(0, 10) : undefined}
                title={b.title}
              />
            );
          })}
        </LinkCards>
      )}

      <RelatedPanel items={related} />

      <AsideCard title="Subscribe">
        <a href={feedUrl} target="_blank" rel="noopener noreferrer" className="pg-btn pg-btn--line">
          <Rss size={14} strokeWidth={1.75} aria-hidden="true" />RSS for this CIP
        </a>
        <p className="rd-card-note">
          <a href="/api/feed/changes" target="_blank" rel="noopener noreferrer" className="rd-card-link">All CIP changes feed ↗</a>
        </p>
      </AsideCard>
    </>
  );

  return (
    <ReaderPage crumbs={[{ label: 'CIPs', href: '/cips' }, { label: `CIP-${padded}` }]} aside={aside}>
      <ReaderHead
        tags={
          <>
            {cip.status && <span className="pill" data-status={cip.status}>{cip.status}</span>}
            {cip.type && <span className="pg-tag">{cip.type}</span>}
            {attachments.length > 0 && (
              <span className="pg-tag" data-tone="info">
                {attachments.length} attachment{attachments.length === 1 ? '' : 's'}
              </span>
            )}
          </>
        }
        title={<>CIP-{cip.id}: {cip.title}</>}
        meta={
          <MetaLine
            items={[
              cip.author && <span key="a">by <b>{formatAuthor(cip.author)}</b></span>,
              cip.created_date && <span key="c">Created {formatDate(cip.created_date)}</span>,
              cip.approved_date && <span key="p">Approved {formatDate(cip.approved_date)}</span>,
            ]}
          />
        }
        actions={
          <a href={githubUrl} target="_blank" rel="noopener noreferrer" className="pg-btn pg-btn--line">
            {isDraft ? 'View PR' : 'View on GitHub'}<ExternalLink size={14} strokeWidth={1.75} aria-hidden="true" />
          </a>
        }
      />

      <CipTldr cipId={cip.id} initial={cip.tldr ?? null} />

      {cleanMd ? (
        <div className="rd-prose">
          <MarkdownRenderer content={cleanMd} baseUrl={githubBase} />
        </div>
      ) : (
        <div className="rd-empty">
          <p>
            This CIP is only available on GitHub.{' '}
            <a href={githubUrl} target="_blank" rel="noopener noreferrer">View on GitHub ↗</a>
          </p>
        </div>
      )}
    </ReaderPage>
  );
}
