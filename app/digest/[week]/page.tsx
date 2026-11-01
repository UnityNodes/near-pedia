import type { Metadata } from 'next';
import { ArrowLeft } from 'lucide-react';
import { getDb } from '@/lib/db';
import { notFound } from 'next/navigation';
import { SITE } from '@/lib/site.config';
import { statusTone } from '@/lib/status';
import { PgList, PgRow } from '@/components/page-shell';
import { BackLink, MetaLine, ReaderHead, ReaderPage } from '@/components/reader-shell';

export const revalidate = 3600;

interface PageProps { params: Promise<{ week: string }> }

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { week } = await params;
  const title = `Digest ${week}`;
  const brandedTitle = `${title} | ${SITE.name}`;
  const description = `NEAR weekly digest for ${week}.`;
  const url = `${SITE.url}/digest/${week}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { type: 'article', title: brandedTitle, description, url },
    twitter: { card: 'summary_large_image', title: brandedTitle, description },
  };
}

interface NewCip { id: string; cip_number: number | null; title: string | null; status: string | null }
interface Change { cip_id: string; cip_number: number | null; title: string | null; from_status: string | null; to_status: string }
interface ForumItem { id: number; title: string | null; reply_count: number; views: number }
interface BlogItem { id: string; title: string | null; author: string | null; published_at: string | null }
interface Payload { week: string; generatedAt: string; newCips: NewCip[]; changes: Change[]; topForum: ForumItem[]; blogs: BlogItem[] }

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="rd-section">
      <h2 className="rd-section-h">{title}</h2>
      <PgList empty={count === 0 ? <p className="pg-empty">Nothing this week.</p> : null}>
        {children}
      </PgList>
    </section>
  );
}

const cipLabel = (num: number | null, id: string) => `CIP-${String(num ?? id).padStart(4, '0')}`;

export default async function DigestWeekPage({ params }: PageProps) {
  const { week } = await params;
  const db = getDb();
  const row = db.prepare('SELECT payload FROM weekly_digests WHERE week = ?').get(week) as { payload: string } | undefined;
  if (!row) notFound();
  const p: Payload = JSON.parse(row.payload);

  return (
    <ReaderPage crumbs={[{ label: 'Digest', href: '/digest' }, { label: week }]}>
      <ReaderHead
        tags={<span className="pg-tag" data-tone="lime">Weekly digest</span>}
        title={week}
        meta={
          <MetaLine
            items={[
              <span key="n">{p.newCips.length} CIP activity</span>,
              <span key="c">{p.changes.length} status changes</span>,
              <span key="f">{p.topForum.length} discussions</span>,
              p.blogs.length > 0 ? <span key="b">{p.blogs.length} posts</span> : null,
            ]}
          />
        }
        lede="The week in one read: what moved in the CIPs, what the forum talked about, and what was published."
      />

      <Section title="CIP activity" count={p.newCips.length}>
        {p.newCips.map((c, i) => (
          <PgRow
            key={c.id}
            href={`/cips/${c.id}`}
            tag={c.status ?? undefined}
            tone={statusTone(c.status)}
            meta={cipLabel(c.cip_number, c.id)}
            title={c.title}
            delay={i * 30}
          />
        ))}
      </Section>

      <Section title="Status changes" count={p.changes.length}>
        {p.changes.map((ch, i) => (
          <PgRow
            key={i}
            href={`/cips/${ch.cip_id}`}
            tag={`${ch.from_status ?? '-'} → ${ch.to_status}`}
            tone={statusTone(ch.to_status)}
            meta={cipLabel(ch.cip_number, ch.cip_id)}
            title={ch.title}
            delay={i * 30}
          />
        ))}
      </Section>

      <Section title="Top discussions" count={p.topForum.length}>
        {p.topForum.map((f, i) => (
          <PgRow
            key={f.id}
            href={`/discussions/${f.id}`}
            meta={`${f.reply_count} replies · ${f.views} views`}
            title={f.title}
            delay={i * 30}
          />
        ))}
      </Section>

      {p.blogs.length > 0 && (
        <Section title="Blog & news" count={p.blogs.length}>
          {p.blogs.map((b, i) => (
            <PgRow
              key={b.id}
              href={`/blog/${b.id}`}
              meta={b.author ? `by ${b.author}` : undefined}
              title={b.title}
              delay={i * 30}
            />
          ))}
        </Section>
      )}

      <BackLink href="/digest"><ArrowLeft size={14} strokeWidth={1.75} aria-hidden="true" />All digests</BackLink>
    </ReaderPage>
  );
}
