import { getDb } from '../lib/db';

const DAY = 86_400_000;
const iso = (daysAgo: number): string => new Date(Date.now() - daysAgo * DAY).toISOString();

if (!process.env.DB_PATH || process.env.DB_PATH === ':memory:') {
  console.error('seed-demo: set DB_PATH to a scratch file, for example DB_PATH=/tmp/demo.db');
  process.exit(1);
}

const db = getDb();
const existing = (db.prepare('SELECT COUNT(*) c FROM doc_pages').get() as { c: number }).c;
if (existing > 0) {
  console.error(`seed-demo: ${process.env.DB_PATH} already holds ${existing} doc pages, refusing to add demo rows to it`);
  process.exit(1);
}

const insertDoc = db.prepare(`INSERT OR REPLACE INTO doc_pages (url, title, breadcrumb, excerpt, content_text, content_html, source, last_modified, synced_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
['Getting started', 'Run a node', 'Configure a validator', 'Deploy an application', 'Network upgrades', 'Monitoring and alerts', 'Backups and restore', 'Security checklist', 'REST API reference', 'Release notes'].forEach((t, i) => {
  const source = i < 6 ? 'docs' : i < 9 ? 'partner-docs' : 'github-code';
  insertDoc.run(`https://docs.example.com/${t.toLowerCase().replace(/\s+/g, '-')}`, t, `Docs > ${t}`, `${t}: a short demo page that explains one task step by step.`, `${t}. Step one, step two, step three.`, `<h1>${t}</h1><p>Step one, step two, step three.</p>`, source, iso(i * 3), iso(0.1));
});

const insertBlog = db.prepare('INSERT OR REPLACE INTO blog_posts (id, title, excerpt, content_text, content_html, author, published_at, url, tags, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
['Mainnet upgrade recap', 'Ten things to know about staking', 'Community call notes', 'A new SDK release', 'Security advisory follow-up', 'Ecosystem grants, round two', 'How the registry works', 'Roadmap for the quarter'].forEach((t, i) => {
  insertBlog.run(`post-${i}`, t, `${t}: a short demo excerpt that reads like the first lines of a real post.`, `${t}. Demo body.`, `<p>${t}. Demo body.</p>`, 'Demo Team', iso(2 + i * 5), `https://blog.example.com/${i}`, i % 2 ? 'blog' : 'news', iso(0.2));
});

const insertTopic = db.prepare(`INSERT OR REPLACE INTO forum_topics (id, title, category_id, created_at, last_post_at, posts_count, reply_count, views, like_count, last_poster_username, url, synced_at, posts_synced_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
for (let i = 0; i < 16; i++) {
  insertTopic.run(100 + i, ['How do I rotate a validator key?', 'Upgrade window for the next release', 'Proposal: lower the minimum stake', 'Indexer lagging behind the chain', 'Best practice for backups', 'Question about fee estimation', 'Weekly update', 'Ideas for the docs site'][i % 8] + (i >= 8 ? ' (2)' : ''), 1, iso(30 - i), iso(i / 2), 3 + i, 2 + i, 120 + i * 40, i, `user${i}`, `https://forum.example.com/t/${100 + i}`, iso(0.1), iso(0.1));
}

const insertVideo = db.prepare('INSERT OR REPLACE INTO youtube_videos (id, title, description, published_at, url, thumbnail_url, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
['Core dev call 41', 'Core dev call 40', 'Validator onboarding', 'Intro to the SDK', 'Governance walkthrough', 'Office hours'].forEach((t, i) => {
  insertVideo.run(`vid${i}`, t, `${t}: a demo recording.`, iso(7 + i * 9), `https://www.youtube.com/watch?v=vid${i}`, '', iso(0.2));
});

const insertGh = db.prepare('INSERT OR REPLACE INTO github_items (id, type, repo, number, title, body, state, author, created_at, url, labels, board_status, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
for (let i = 0; i < 12; i++) {
  insertGh.run(`gh${i}`, i % 3 ? 'issue' : 'pull_request', i % 2 ? 'demo-org/demo-node' : 'demo-org/demo-app', 400 + i, ['Fix flaky sync test', 'Add pagination to the list endpoint', 'Document the upgrade flow', 'Bump the SDK'][i % 4], 'Demo body.', i % 4 ? 'open' : 'closed', 'demo-dev', iso(i * 2), `https://github.com/demo-org/demo-node/issues/${400 + i}`, i % 3 === 0 ? 'bug,good first issue' : i % 3 === 1 ? 'docs' : '', null, iso(0.1));
}

const insertRel = db.prepare('INSERT OR REPLACE INTO github_releases (id, repo, tag, name, body, published_at, url, synced_at, prerelease) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
['v1.4.0', 'v1.3.2', 'v1.3.1', 'v1.3.0', 'v1.2.0', 'v1.2.0-rc1'].forEach((tag, i) => {
  insertRel.run(`rel${i}`, 'demo-org/demo-node', tag, `NEAR Node ${tag}`, '## Changes\n\n- Demo change one\n- Demo change two\n', iso(4 + i * 12), `https://github.com/demo-org/demo-node/releases/tag/${tag}`, iso(0.1), tag.includes('rc') ? 1 : 0);
});

const insertDisc = db.prepare(`INSERT OR REPLACE INTO github_discussions (id, repo, db_id, number, title, body, category, author, created_at, updated_at, url, upvotes, comments_count, comments_json, answered, synced_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
for (let i = 0; i < 8; i++) {
  insertDisc.run(`disc${i}`, 'demo-org/community', 900 + i, 50 + i, ['Show and tell', 'Roadmap feedback', 'Operator tooling', 'Docs wishlist'][i % 4] + ` #${i + 1}`, 'Demo body.', i % 2 ? 'Ideas' : 'Q&A', 'demo-user', iso(20 - i), iso(i), `https://github.com/demo-org/community/discussions/${50 + i}`, 2 + i, i, '[]', i % 2, iso(0.1));
}

const logSync = db.prepare('INSERT INTO sync_log (source, status, items_synced, ran_at) VALUES (?, ?, ?, ?)');
['docs', 'blog', 'forum', 'youtube', 'github', 'releases', 'discussions'].forEach((s) => logSync.run(s, 'ok', 10, iso(0.05)));

console.log(`seed-demo: filled ${process.env.DB_PATH}`);
