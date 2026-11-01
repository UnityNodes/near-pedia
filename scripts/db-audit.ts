import { getDb } from '../lib/db';

const db = getDb();

const stats = {
  cips: (db.prepare('SELECT COUNT(*) as c FROM cips').get() as {c:number}).c,
  topics: (db.prepare('SELECT COUNT(*) as c FROM forum_topics').get() as {c:number}).c,
  docs: (db.prepare('SELECT COUNT(*) as c FROM doc_pages').get() as {c:number}).c,
  blog: (db.prepare('SELECT COUNT(*) as c FROM blog_posts').get() as {c:number}).c,
  videos: (db.prepare('SELECT COUNT(*) as c FROM youtube_videos').get() as {c:number}).c,
  github: (db.prepare('SELECT COUNT(*) as c FROM github_items').get() as {c:number}).c,
  whitepapers: (db.prepare('SELECT COUNT(*) as c FROM whitepapers').get() as {c:number}).c,
};
console.log('=== DB STATS ===');
console.log(JSON.stringify(stats, null, 2));

const noTitle = (db.prepare('SELECT COUNT(*) as c FROM cips WHERE title IS NULL').get() as {c:number}).c;
console.log('\nCIPs without title:', noTitle);

const cipsFts = (db.prepare('SELECT COUNT(*) as c FROM cips_fts').get() as {c:number}).c;
console.log('CIPs FTS entries:', cipsFts);

const docsFts = (db.prepare('SELECT COUNT(*) as c FROM docs_fts').get() as {c:number}).c;
console.log('Docs FTS entries:', docsFts);

const blogNoHtml = (db.prepare("SELECT COUNT(*) as c FROM blog_posts WHERE content_html IS NULL OR LENGTH(content_html) < 50").get() as {c:number}).c;
const blogTotal = stats.blog;
console.log(`Blog posts without content_html: ${blogNoHtml} / ${blogTotal}`);

const dupCips = db.prepare('SELECT cip_number, COUNT(*) as c FROM cips WHERE cip_number IS NOT NULL GROUP BY cip_number HAVING c > 1').all();
console.log('Duplicate CIP numbers:', dupCips);

const nullUrl = (db.prepare("SELECT COUNT(*) as c FROM doc_pages WHERE url IS NULL OR url = ''").get() as {c:number}).c;
console.log('Doc pages without URL:', nullUrl);

const docSources = db.prepare('SELECT source, COUNT(*) as c FROM doc_pages GROUP BY source ORDER BY c DESC').all();
console.log('\nDoc sources:');
console.log(JSON.stringify(docSources, null, 2));

const blogTags = db.prepare('SELECT tags, COUNT(*) as c FROM blog_posts GROUP BY tags ORDER BY c DESC').all();
console.log('\nBlog tags distribution:');
console.log(JSON.stringify(blogTags, null, 2));

const orphanPosts = (db.prepare('SELECT COUNT(*) as c FROM forum_posts fp WHERE NOT EXISTS (SELECT 1 FROM forum_topics ft WHERE ft.id = fp.topic_id)').get() as {c:number}).c;
console.log('\nOrphan forum posts (no parent topic):', orphanPosts);

const topicsNoPosts = (db.prepare('SELECT COUNT(*) as c FROM forum_topics ft WHERE NOT EXISTS (SELECT 1 FROM forum_posts fp WHERE fp.topic_id = ft.id)').get() as {c:number}).c;
console.log('Forum topics with no synced posts:', topicsNoPosts);

const gitRepo = db.prepare('SELECT repo, type, COUNT(*) as c FROM github_items GROUP BY repo, type').all();
console.log('\nGitHub items by repo/type:');
console.log(JSON.stringify(gitRepo, null, 2));
