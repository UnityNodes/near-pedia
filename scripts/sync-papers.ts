/**
 * Sync research papers about YourChain into the whitepapers table.
 * arXiv (Atom API, no auth) for topic searches + a curated list of IACR
 * ePrint papers (hardcoded ids; PDFs public).
 */
import 'dotenv/config';
import { guardSync } from '../lib/sync-log';
import { getDb } from '../lib/db';
import { isoNowSql } from '../lib/formats';

const ARXIV_QUERIES = [
  'abs:YourChain',
  'all:%22your+topic%22',
  'ti:%22your+topic%22+AND+abs:YourChain',
];
const RELEVANT = /yourchain|your topic/i;

const IACR: { id: string; title: string; desc: string }[] = [];

interface Paper { slug: string; title: string; description: string; pdf_url: string; content_text: string; }

function decode(s: string) { return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim(); }

async function arxiv(): Promise<Paper[]> {
  const out = new Map<string, Paper>();
  for (const q of ARXIV_QUERIES) {
    try {
      const res = await fetch(`http://export.arxiv.org/api/query?search_query=${q}&start=0&max_results=60`);
      const xml = await res.text();
      // arXiv's Atom feed reports the true match count regardless of
      // max_results - log it so a query that outgrows the 60-result page
      // shows up somewhere instead of silently dropping the tail.
      const totalResults = Number((xml.match(/<opensearch:totalResults[^>]*>(\d+)</) || [])[1] ?? 0);
      if (totalResults > 60) {
        console.warn(`[sync-papers] query "${q}" has ${totalResults} results, only fetching first 60`);
      }
      for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
        const e = m[1];
        const idUrl = (e.match(/<id>(.*?)<\/id>/) || [])[1] ?? '';
        const arxivId = idUrl.split('/abs/')[1]?.replace(/v\d+$/, '');
        if (!arxivId) continue;
        const title = decode((e.match(/<title>([\s\S]*?)<\/title>/) || [])[1] ?? '');
        const summary = decode((e.match(/<summary>([\s\S]*?)<\/summary>/) || [])[1] ?? '');
        if (!RELEVANT.test(`${title} ${summary}`)) continue;
        out.set(arxivId, {
          slug: `arxiv-${arxivId.replace(/[^0-9.]/g, '-')}`,
          title, description: summary.slice(0, 400),
          pdf_url: `https://arxiv.org/pdf/${arxivId}`,
          content_text: `${title}\n\n${summary}`,
        });
      }
    } catch (e) { console.warn('arxiv q', q, (e as Error).message); }
  }
  return [...out.values()];
}

async function main() {
  const db = getDb();
  const papers: Paper[] = [
    ...await arxiv(),
    ...IACR.map((p) => ({
      slug: `iacr-${p.id.replace('/', '-')}`,
      title: p.title, description: p.desc,
      pdf_url: `https://eprint.iacr.org/${p.id}.pdf`,
      content_text: `${p.title}\n\n${p.desc}`,
    })),
  ];

  const ins = db.prepare(`INSERT OR IGNORE INTO whitepapers (slug,title,description,tag,pdf_url,content_text,pages,synced_at)
    VALUES (?,?,?,?,?,?,?,${isoNowSql()})`);
  let n = 0;
  for (const p of papers) {
    if (!p.title || !p.pdf_url) continue;
    n += ins.run(p.slug, p.title, p.description, 'research', p.pdf_url, p.content_text, null).changes;
  }
  try { db.exec("INSERT INTO whitepapers_fts(whitepapers_fts) VALUES('rebuild')"); } catch {}
  const total = (db.prepare('SELECT COUNT(*) c FROM whitepapers').get() as { c: number }).c;
  console.log(`papers found ${papers.length}, inserted ${n}, whitepapers total now ${total}`);
}
guardSync('papers', main).catch((e) => { console.error(e); process.exit(1); });
