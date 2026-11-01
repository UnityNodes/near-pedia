import type { Metadata } from 'next';
import { getDb } from '@/lib/db';
import { breadcrumbList, collectionPage } from '@/lib/jsonld';
import { JsonLd } from '@/components/json-ld';
import { PageShell, PgFoot, PgList, PgRow } from '@/components/page-shell';
import { formatDateLong } from '@/lib/utils';

export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'Weekly Digest',
  description: 'Weekly roundup of YourChain CIP activity, forum discussions, and news.',
  alternates: { canonical: 'https://yourpedia.example/digest' },
};

interface DigestRow { week: string; payload: string; generated_at: string; }

const DIGEST_LIMIT = 12;

function getDigests() {
  const db = getDb();
  return db.prepare('SELECT week, payload, generated_at FROM weekly_digests ORDER BY week DESC LIMIT ?').all(DIGEST_LIMIT) as DigestRow[];
}

function countDigests() {
  const db = getDb();
  return (db.prepare('SELECT COUNT(*) c FROM weekly_digests').get() as { c: number }).c;
}

function plural(n: number, one: string, many: string) {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}

export default function DigestIndexPage() {
  const digests = getDigests();
  const total = countDigests();
  const schemas = [
    collectionPage({
      name: 'YourChain Weekly Digest',
      description: 'Weekly roundup of CIP activity, forum discussions, releases, and YourChain ecosystem news.',
      path: '/digest',
      itemCount: digests.length,
    }),
    breadcrumbList([
      { name: 'Home', path: '/' },
      { name: 'Digest', path: '/digest' },
    ]),
  ];

  return (
    <PageShell
      href="/digest"
      title="Weekly Digest"
      description="The week in one read: new CIPs, status changes, the busiest forum topics and blog posts. Published every Monday."
      stat={{ value: total, unit: total === 1 ? 'digest' : 'digests' }}
      synced={digests[0]?.generated_at ?? null}
      source="weekly roundup"
    >
      <JsonLd payload={schemas} />
      <PgList
        empty={digests.length === 0 ? (
          <div className="pg-empty">No digests yet. They are published every Monday.</div>
        ) : null}
      >
        {digests.map((d, i) => {
          const p = JSON.parse(d.payload) as { newCips: unknown[]; changes: unknown[]; topForum: unknown[]; blogs: unknown[] };
          return (
            <PgRow
              key={d.week}
              href={`/digest/${d.week}`}
              tag={d.week}
              tone="lime"
              title={[
                plural(p.newCips.length, 'CIP', 'CIPs'),
                plural(p.changes.length, 'change', 'changes'),
                plural(p.topForum.length, 'topic', 'topics'),
                plural(p.blogs.length, 'post', 'posts'),
              ].join(' · ')}
              date={formatDateLong(d.generated_at)}
              delay={i * 40}
            />
          );
        })}
      </PgList>
      <PgFoot shown={digests.length} total={total} />
    </PageShell>
  );
}
