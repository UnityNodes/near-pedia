import { getDb } from '../lib/db';

// One-time: prune embedding_chunks/embedding_doc_hash rows whose source_id no
// longer matches any row in the table it claims to embed. check-index-coverage.ts
// found two distinct causes, both leaving retrievable-but-uncitable content in
// the index:
//
//   blog_post   15 source_ids (39 chunks) in the old Mongo ObjectId id scheme,
//               from before blog_posts.id became a slug. The current content
//               (where it still exists) is already correctly embedded under
//               its slug id; these are dead duplicates or references to rows
//               deleted from blog_posts without a corresponding index prune.
//
//   whitepaper  2 source_ids (1, 2 - 2 chunks) are stale duplicates of
//               two whitepapers already correctly embedded under their
//               current ids (3, 4).
//
//               6 source_ids (2897-2902 - 162 chunks) are NOT nearpedia
//               content at all: whitepapers from other projects, fully absent from the current whitepapers table
//               (a cross-project data leak, not a rekey artifact) but still
//               retrievable via semantic_search with no working citation.

const TABLES: Record<string, { table: string; idExpr: string }> = {
  blog_post: { table: 'blog_posts', idExpr: 'id' },
  whitepaper: { table: 'whitepapers', idExpr: 'CAST(id AS TEXT)' },
};

function main(): void {
  const db = getDb();
  let totalChunks = 0, totalHash = 0;

  for (const [sourceType, { table, idExpr }] of Object.entries(TABLES)) {
    const orphanIds = (db.prepare(
      `SELECT DISTINCT source_id FROM embedding_chunks WHERE source_type = ? AND source_id NOT IN (SELECT ${idExpr} FROM ${table})`,
    ).all(sourceType) as { source_id: string }[]).map(r => r.source_id);

    if (orphanIds.length === 0) {
      console.log(`${sourceType}: no orphaned source_ids`);
      continue;
    }

    const placeholders = orphanIds.map(() => '?').join(',');
    const delChunks = db.prepare(
      `DELETE FROM embedding_chunks WHERE source_type = ? AND source_id IN (${placeholders})`,
    ).run(sourceType, ...orphanIds);
    const delHash = db.prepare(
      `DELETE FROM embedding_doc_hash WHERE source_type = ? AND source_id IN (${placeholders})`,
    ).run(sourceType, ...orphanIds);

    console.log(`${sourceType}: pruned ${orphanIds.length} orphaned source_id(s), ${delChunks.changes} chunk(s), ${delHash.changes} hash row(s)`);
    console.log(`  ids: ${orphanIds.join(', ')}`);
    totalChunks += delChunks.changes;
    totalHash += delHash.changes;
  }

  console.log(`Done. ${totalChunks} chunk(s) and ${totalHash} hash row(s) pruned total.`);
}

main();
