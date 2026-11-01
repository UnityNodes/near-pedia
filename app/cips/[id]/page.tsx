import {
  getCipById,
  getCipStatusHistory,
  getCipAttachments,
  getCipForumMentions,
  getCipBlogMentions,
  getCipOtherMentions,
  getCipProposalMentions,
} from '@/lib/cips';
import { CipDetail } from '@/components/cip-detail';
import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { JsonLd } from '@/components/json-ld';
import { formatAuthor } from '@/lib/utils';
import { parseCipDate } from '@/lib/parsers/cip-frontmatter';
import { SITE } from '@/lib/site.config';

export const revalidate = 300;

interface PageProps {
  params: Promise<{ id: string }>;
}

function cipMetaDescription(contentMd: string | null | undefined, maxLen: number): string {
  return (contentMd ?? '')
    .replace(/^---[\s\S]*?---\s*/m, '')
    .replace(/<pre\b[^>]*>[\s\S]*?<\/pre>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+.*$/gm, '')
    .replace(/[`*_>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const cip = getCipById(id);
  if (!cip) return { title: 'CIP Not Found' };
  const title = `CIP-${cip.id}: ${cip.title ?? 'Untitled'}`;
  const brandedTitle = `${title} | ${SITE.name}`;

  const body = cipMetaDescription(cip.content_md, 160);
  const meta = [
    cip.status ? `Status: ${cip.status}` : null,
    cip.type ? `Type: ${cip.type}` : null,
    cip.author ? `Author: ${formatAuthor(cip.author)}` : null,
  ].filter(Boolean).join(' · ');
  const description = body || meta || `Chain Improvement Proposal CIP-${cip.id}.`;

  return {
    title,
    description,
    alternates: {
      canonical: `${SITE.url}/cips/${cip.id}`,
      types: {
        'application/atom+xml': `${SITE.url}/api/feed/cip/${cip.id}`,
      },
    },
    openGraph: {
      type: 'article',
      title: brandedTitle,
      description,
      url: `${SITE.url}/cips/${cip.id}`,
      // images auto-merged from app/cips/[id]/opengraph-image.tsx
    },
    twitter: { card: 'summary_large_image', title: brandedTitle, description },
  };
}

export default async function CipDetailPage({ params }: PageProps) {
  const { id } = await params;
  const stripped = id.replace(/^CIP-/i, '');
  if (/^\d+$/.test(stripped) && stripped !== stripped.padStart(4, '0')) {
    redirect(`/cips/${stripped.padStart(4, '0')}`);
  }
  const cip = getCipById(id);
  if (!cip) notFound();

  const history = getCipStatusHistory(cip.id);
  const attachments = getCipAttachments(cip.id);
  const forumMentions = getCipForumMentions(cip.id);
  const blogMentions = getCipBlogMentions(cip.id);
  const otherCipMentions = getCipOtherMentions(cip.id);
  const proposalMentions = getCipProposalMentions(cip.id);

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    headline: `CIP-${cip.id}: ${cip.title}`,
    description: cipMetaDescription(cip.content_md, 200) || `Chain Improvement Proposal CIP-${cip.id}.`,
    url: `${SITE.url}/cips/${cip.id}`,
    datePublished: cip.created_date,
    // Not cip.synced_at. That is when we last crawled the file, so every CIP
    // page told crawlers it had been modified within the last sync window
    // regardless of whether anything actually changed - sync-cips touches
    // synced_at on every run. history is already ordered newest first and
    // carries real commit dates, so its head is when the CIP actually last
    // moved; parseCipDate guards approved_date (author-typed frontmatter,
    // not guaranteed to parse) the same way ingest and get_cip do.
    dateModified: history[0]?.changed_at ?? parseCipDate(cip.approved_date) ?? cip.created_date,
    author: cip.author ? { '@type': 'Person', name: formatAuthor(cip.author) } : undefined,
    publisher: { '@type': 'Organization', name: 'YourChain Foundation', url: 'https://yourchain.example' },
    isPartOf: { '@type': 'WebSite', name: SITE.name, url: SITE.url },
    articleSection: cip.type ?? 'Chain Improvement Proposal',
    keywords: ['YourChain', 'CIP', `CIP-${cip.id}`, cip.type, cip.status].filter(Boolean).join(', '),
  };

  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE.url },
      { '@type': 'ListItem', position: 2, name: 'CIPs', item: `${SITE.url}/cips` },
      { '@type': 'ListItem', position: 3, name: `CIP-${cip.id}`, item: `${SITE.url}/cips/${cip.id}` },
    ],
  };

  return (
    <>
      <JsonLd payload={schema} />
      <JsonLd payload={breadcrumb} />
      <CipDetail
        cip={cip}
        history={history}
        attachments={attachments}
        forumMentions={forumMentions}
        blogMentions={blogMentions}
        otherCipMentions={otherCipMentions}
        proposalMentions={proposalMentions}
      />
    </>
  );
}
