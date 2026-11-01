/**
 * A tool that names another tool as the source of an id must actually hand one
 * over, in a form that tool accepts.
 *
 * Built for this app's own tool set: CIP_ID_TOOLS lists the 5 tools that
 * actually take a CIP id here, found the same way the check finds them
 * itself: grepping every `.describe('...CIP...id...')` in mcp-server.ts.
 *
 * THE CLASS. Tools reachable only by identifier are documented "from
 * <listing>" in prose, and in one set of eight two were broken -
 * the listing printed an id shape the getter didn't key on. Both halves can
 * pass every other check while the pair is unusable: the listing prints
 * correct data, the getter answers correctly for a correct id, and no id
 * ever crosses between them. This app's own tools were checked fresh, not
 * assumed innocent.
 *
 * THE ORACLE IS A ROUND TRIP, not a string match. The check calls the
 * producer, then offers the consumer every candidate token in that output
 * and asks whether any is accepted - with a negative control (an impossible
 * value, to learn what a refusal looks like) and a positive control (a
 * value read straight from the database, so a consumer broken for ALL
 * inputs is blamed on the consumer and not the listing).
 *
 * THE DECLARED LIST IS ASSERTED COMPLETE, from the SOURCE (mcp-server.ts),
 * not the running server: a "from <tool>" phrasing anywhere in a tool's
 * description or parameter docs must appear in HANDOFFS or NOT_A_HANDOFF,
 * so a new tool that names a producer and hands nothing over cannot pass
 * quietly. Note the scanner only catches the FIRST tool name after a
 * trigger phrase ("from search or list_cips" is seen as naming only
 * "search") - real, so several pairs below are declared beyond what the
 * assertion strictly requires, for actual coverage rather than the
 * assertion's minimum.
 *
 *   npx tsx scripts/check-handoffs.ts
 *   npx tsx scripts/check-handoffs.ts --verbose
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  IMPOSSIBLE_A, IMPOSSIBLE_B, learnRefusal, looksLikeRefusal, startScratchMcp, tokens,
  type Refusal, type ScratchMcp,
} from '../lib/mcp-probe';
import { getDb } from '../lib/db';
import { logRun } from '../lib/sync-log';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const VERBOSE = process.argv.includes('--verbose');
const CALL_TIMEOUT_MS = 30_000;
const RUN_DEADLINE_MS = 8 * 60 * 1000;
const startedAt = Date.now();

interface Handoff {
  producer: string;
  producerArgs: Record<string, unknown>;
  consumer: string;
  param: string;
  everyPrintedId?: RegExp;
  alsoTestSql?: string;
  consumerArgs?: Record<string, unknown>;
  knownGoodSql: string;
}

/**
 * Every pair where one tool's documentation names another as the source of
 * its identifier, plus real functional pairs found by reading the full
 * descriptions (a "from X or Y" sentence names two producers; the
 * completeness scanner below only requires the first).
 */
const HANDOFFS: Handoff[] = [
  { producer: 'search', producerArgs: { query: 'namespace', type: 'cip', limit: 5 },
    consumer: 'get_cip', param: 'id', knownGoodSql: 'SELECT id FROM cips LIMIT 1' },
  { producer: 'list_cips', producerArgs: { limit: 5 },
    consumer: 'get_cip', param: 'id', knownGoodSql: 'SELECT id FROM cips LIMIT 1' },
  { producer: 'search', producerArgs: { query: 'namespace', type: 'cip', limit: 5 },
    consumer: 'get_cip_history', param: 'id', knownGoodSql: 'SELECT id FROM cips LIMIT 1' },
  { producer: 'list_cips', producerArgs: { limit: 5 },
    consumer: 'get_cip_history', param: 'id', knownGoodSql: 'SELECT id FROM cips LIMIT 1' },
  { producer: 'search', producerArgs: { query: 'namespace', type: 'cip', limit: 5 },
    consumer: 'get_cip_attachments', param: 'id', knownGoodSql: "SELECT DISTINCT cip_id FROM cip_attachments LIMIT 1" },
  { producer: 'list_cips', producerArgs: { limit: 5 },
    consumer: 'get_cip_attachments', param: 'id', knownGoodSql: "SELECT DISTINCT cip_id FROM cip_attachments LIMIT 1" },
  { producer: 'search', producerArgs: { query: 'namespace', type: 'cip', limit: 5 },
    consumer: 'get_cip_mentions', param: 'id', knownGoodSql: 'SELECT id FROM cips LIMIT 1' },
  { producer: 'list_cips', producerArgs: { limit: 5 },
    consumer: 'get_cip_mentions', param: 'id', knownGoodSql: 'SELECT id FROM cips LIMIT 1' },

  { producer: 'search', producerArgs: { query: 'validator', type: 'discussion', limit: 5 },
    consumer: 'get_discussion', param: 'id', knownGoodSql: 'SELECT id FROM forum_topics LIMIT 1' },
  // get_discussion's own docs name get_cip_mentions as its second producer:
  // get_cip_mentions prints forum thread ids in its "Forum threads" section, which only a CIP
  // actually cited on the forum will have (CIP-0001 has none; 0013 does).
  { producer: 'get_cip_mentions', producerArgs: { id: '0013' },
    consumer: 'get_discussion', param: 'id', knownGoodSql: 'SELECT id FROM forum_topics LIMIT 1' },

  { producer: 'search', producerArgs: { query: 'node', type: 'doc', limit: 5 },
    consumer: 'get_doc', param: 'id', knownGoodSql: 'SELECT id FROM doc_pages LIMIT 1' },
  { producer: 'semantic_search', producerArgs: { query: 'how does node syncing work', limit: 3, source_types: ['doc_page'] },
    consumer: 'get_doc', param: 'id', knownGoodSql: 'SELECT id FROM doc_pages LIMIT 1' },

  { producer: 'list_github_discussions', producerArgs: { limit: 3 },
    consumer: 'get_github_discussion', param: 'id', knownGoodSql: 'SELECT id FROM github_discussions LIMIT 1' },

  { producer: 'list_videos', producerArgs: { limit: 3 },
    consumer: 'get_video', param: 'id', knownGoodSql: 'SELECT id FROM youtube_videos LIMIT 1' },
  { producer: 'list_blog_posts', producerArgs: { limit: 3 },
    consumer: 'get_blog_post', param: 'id', knownGoodSql: 'SELECT id FROM blog_posts LIMIT 1' },
  { producer: 'search', producerArgs: { query: 'yourchain', type: 'youtube', limit: 5 },
    consumer: 'get_video', param: 'id', knownGoodSql: 'SELECT id FROM youtube_videos LIMIT 1' },

  // Not documented as a handoff in get_latest_release's own description
  // (it just says "requires a package name"), but list_repos prints exactly
  // the repo strings get_latest_release keys on, confirmed by hand -
  // real coverage even though nothing in prose asserts the pair.
  { producer: 'list_repos', producerArgs: {},
    consumer: 'get_latest_release', param: 'package', knownGoodSql: 'SELECT repo FROM github_releases LIMIT 1' },
];

/**
 * The five tools that take a CIP id here.
 */
const CIP_ID_TOOLS: Array<{ tool: string; param: string }> = [
  { tool: 'get_cip', param: 'id' },
  { tool: 'get_cip_history', param: 'id' },
  { tool: 'get_cip_attachments', param: 'id' },
  { tool: 'get_cip_mentions', param: 'id' },
  { tool: 'detect_cip_dependency_chain', param: 'cip_id' },
];

/**
 * The id SHAPES the cips table can hold. Checked before writing this down:
 * as of writing the cips table here has ZERO "PR-" draft rows (every one
 * of 52 is merged/numeric) - your-org/CIPs currently has no open-PR
 * draft this corpus has captured. Declared
 * anyway: detect_cip_dependency_chain's own description explicitly claims
 * "open-PR drafts (PR-203)" as accepted input, so the shape is a real,
 * documented contract even though nothing exercises it today. The check's
 * own "no row to test with" path reports that honestly rather than as a
 * pass or a failure.
 */
// notStoredHere: a shape this product does not produce, with why. It is skipped
// only while NO row of that shape exists. The moment one appears the shape is
// tested like any other, so declaring it cannot hide a shape that starts to exist.
const CIP_ID_SHAPES: Array<{ label: string; sql: string; notStoredHere?: string }> = [
  { label: 'merged, numeric', sql: `SELECT id FROM cips WHERE id NOT LIKE 'PR-%' ORDER BY id LIMIT 1` },
  {
    label: 'draft, PR- + padded CIP number',
    sql: `SELECT id FROM cips WHERE id LIKE 'PR-0%' ORDER BY id LIMIT 1`,
    notStoredHere: 'this product does not ingest draft CIPs from open pull requests (there is no sync-cip-drafts here), so cips holds no PR- ids',
  },
  {
    label: 'draft, PR- + unpadded PR number',
    sql: `SELECT id FROM cips WHERE id LIKE 'PR-%' AND id NOT LIKE 'PR-0%' ORDER BY id LIMIT 1`,
    notStoredHere: 'this product does not ingest draft CIPs from open pull requests (there is no sync-cip-drafts here), so cips holds no PR- ids',
  },
];

/** A refusal OF THE IDENTIFIER, distinct from a legitimate empty answer. */
const ID_REJECTION = /Invalid CIP id|CIP "[^"]*" not found/i;

/**
 * Mentions of one tool inside another's docs that are NOT a handoff. Each
 * needs a reason, so the completeness assertion cannot be silenced by
 * adding a name to a list.
 */
const NOT_A_HANDOFF: Record<string, string> = {
  'get_network_state<-get_network_stats': 'disambiguation: "distinct from get_network_stats (which counts indexed CONTENT, not chain state)"',
  'learning_path<-get_started_guide': 'disambiguation: "topic-driven (distinct from get_started_guide, which is background-driven)"',
  'get_doc<-semantic_search': 'declared above as its own pair',
  'get_blog_post<-search': 'search prints the /blog/<id> link, which contains the id; covered by the list_blog_posts pair',
};

let mcp: ScratchMcp;
const callTool = (n: string, a: Record<string, unknown>) => mcp.callTool(n, a);

function paramIsNumber(schemas: Map<string, Record<string, { type?: string }>>, tool: string, param: string): boolean {
  return schemas.get(tool)?.[param]?.type === 'number' || schemas.get(tool)?.[param]?.type === 'integer';
}

function assertDeclaredComplete(problems: string[]): number {
  const src = fs.readFileSync(path.join(ROOT, 'mcp-server.ts'), 'utf-8');
  const blocks = src.split(/server\.tool\('/).slice(1);
  const names = new Set(blocks.map(b => b.slice(0, b.indexOf("'"))));
  const declared = new Set(HANDOFFS.map(h => `${h.consumer}<-${h.producer}`));
  let seen = 0;

  for (const block of blocks) {
    const me = block.slice(0, block.indexOf("'"));
    const head = block.slice(0, 4000);
    const phrasing = /(?:from|returned by|discover(?:ed)? (?:with|via)|obtain (?:ids )?from|pass the [a-z ]*id from|pair it with)\s+`?([a-z_]{4,})`?/gi;
    for (const m of [...head.matchAll(phrasing)]) {
      const other = m[1];
      if (!names.has(other) || other === me) continue;
      const key = `${me}<-${other}`;
      seen++;
      if (declared.has(key) || key in NOT_A_HANDOFF) continue;
      problems.push(`${key}: documentation names ${other} as the source of an id, and this pair is in neither HANDOFFS nor NOT_A_HANDOFF`);
    }
  }

  const declaredCipTools = new Set(CIP_ID_TOOLS.map(t => t.tool));
  for (const block of blocks) {
    const me = block.slice(0, block.indexOf("'"));
    const head = block.slice(0, 4000);
    const takesCipId = /\.describe\('[^']*\bCIP\s*(?:id|ID|number)\b/.test(head);
    if (takesCipId && !declaredCipTools.has(me)) {
      problems.push(`${me}: a parameter is documented as a CIP id and the tool is not in CIP_ID_TOOLS, so the printed-identity walk skips it`);
    }
  }
  return seen;
}

async function main(): Promise<void> {
  const problems: string[] = [];
  const mentions = assertDeclaredComplete(problems);

  mcp = await startScratchMcp({ label: 'check-handoffs', callTimeoutMs: CALL_TIMEOUT_MS });
  const snapshot = mcp.snapshot;

  let walked = 0;
  let cipIdChecks = 0;
  try {
    const listed = await mcp.rpc('tools/list', {}) as { result?: { tools?: Array<{ name: string; inputSchema?: { properties?: Record<string, { type?: string }> } }> } };
    const schemas = new Map<string, Record<string, { type?: string }>>();
    for (const t of listed.result?.tools ?? []) schemas.set(t.name, t.inputSchema?.properties ?? {});

    for (const h of HANDOFFS) {
      if (!schemas.has(h.consumer) || !schemas.has(h.producer)) {
        problems.push(`${h.producer} -> ${h.consumer}: one of the pair is not published by the server; a rename leaves this walk one pair short`);
        continue;
      }
      if (Date.now() - startedAt > RUN_DEADLINE_MS) {
        problems.push(`ran out of time after ${walked} of ${HANDOFFS.length} pair(s); the rest were not examined`);
        break;
      }
      const base = h.consumerArgs ?? {};
      const label = `${h.producer} -> ${h.consumer}.${h.param}`;
      const numeric = paramIsNumber(schemas, h.consumer, h.param);
      const send = (v: string): Record<string, unknown> => ({ ...base, [h.param]: numeric ? Number(v) : v });

      const refusal = learnRefusal(
        await callTool(h.consumer, send(numeric ? '999999991' : IMPOSSIBLE_A)),
        await callTool(h.consumer, send(numeric ? '888888882' : IMPOSSIBLE_B)),
      );

      const good = snapshot.prepare(h.knownGoodSql).get() as Record<string, unknown> | undefined;
      const goodValue = good ? String(Object.values(good)[0]) : null;
      if (goodValue === null) {
        problems.push(`${label}: no row to test with (${h.knownGoodSql}); the pair was not examined`);
        continue;
      }
      const goodAnswer = await callTool(h.consumer, send(goodValue));
      if (looksLikeRefusal(goodAnswer, refusal)) {
        walked++;
        problems.push(`${label}: the consumer refuses a value read straight from the database, so the fault is the consumer, not the listing`);
        continue;
      }

      const produced = await callTool(h.producer, h.producerArgs);
      if (produced.startsWith(' rpc-error:')) {
        walked++;
        problems.push(`${label}: the producer could not be called with these arguments (${produced.trim().slice(0, 120)}); the pair was not examined`);
        continue;
      }
      if (/^\s*\w+ failed:/.test(produced)) {
        walked++;
        problems.push(`${label}: the producer returned its own failure (${produced.trim().slice(0, 120)}); the pair was not examined, and this says nothing about whether the id crosses`);
        continue;
      }
      const cands = tokens(produced).filter(t => !numeric || /^\d+$/.test(t));
      if (cands.length === 0) {
        walked++;
        const said = produced.trim().split('\n').find(l => l.trim()) ?? '(nothing at all)';
        problems.push(
          `${label}: ${h.producer} printed no candidate value for ${h.param} with these arguments, ` +
          `so this run tested nothing. It said: ${said.slice(0, 160)}`,
        );
        if (VERBOSE) console.error(`    producer output was:\n${produced.slice(0, 600)}`);
        continue;
      }
      if (h.everyPrintedId) {
        const printed = [...produced.matchAll(h.everyPrintedId)].map(m => m[1]);
        const extra: string[] = [];
        if (h.alsoTestSql) {
          const row = snapshot.prepare(h.alsoTestSql).get() as Record<string, unknown> | undefined;
          const v = row ? String(Object.values(row)[0] ?? '') : '';
          if (v && !printed.includes(v)) extra.push(v);
        }
        const toTest = [...printed, ...extra];
        const refused: string[] = [];
        for (const p of toTest) {
          const a = await callTool(h.consumer, send(p));
          if (looksLikeRefusal(a, refusal)) refused.push(p);
        }
        walked++;
        if (!toTest.length) {
          problems.push(`${label}: ${h.producer} labelled no ids with ${h.everyPrintedId}, so this run tested nothing`);
        } else if (refused.length) {
          problems.push(
            `${label}: ${h.consumer} refuses ${refused.length} of the ${toTest.length} ids ${h.producer} prints `
            + `(${refused.slice(0, 4).join(', ')}${refused.length > 4 ? ', …' : ''}). One usable id on the page is not the same as `
            + `the id beside the row a caller picked`,
          );
        } else if (VERBOSE) {
          console.error(`    ${label}: all ${toTest.length} printed ids accepted`);
        }
        continue;
      }

      let accepted: string | null = null;
      for (const t of cands) {
        if (t === goodValue) { accepted = t; break; }
        const a = await callTool(h.consumer, send(t));
        if (!looksLikeRefusal(a, refusal)) { accepted = t; break; }
      }

      walked++;
      if (accepted === null) {
        problems.push(
          `${label}: the consumer accepts none of the ${cands.length} value(s) ${h.producer} prints, ` +
          `while accepting one read from the database — the listing does not hand over a usable id`,
        );
        if (VERBOSE) console.error(`    producer output was:\n${produced.slice(0, 600)}`);
      } else if (VERBOSE) {
        console.log(`  ok    ${label.padEnd(52)} via ${accepted.slice(0, 40)}`);
      }
    }

    // ── second walk: the identity a tool prints must be one it takes ────────
    for (const t of CIP_ID_TOOLS) {
      if (!schemas.has(t.tool)) problems.push(`${t.tool}: declared as taking a CIP id but not published by the server`);
    }
    for (const shape of CIP_ID_SHAPES) {
      const row = snapshot.prepare(shape.sql).get() as { id?: string } | undefined;
      if (!row?.id && shape.notStoredHere) {
        console.log(`  n/a   cip id shape "${shape.label}": ${shape.notStoredHere}`);
        continue;
      }
      if (!row?.id) {
        problems.push(`cip id shape "${shape.label}": no row to test with (${shape.sql}); this shape was not examined`);
        continue;
      }
      const printed = (await callTool('get_cip', { id: row.id })).match(/^#\s*(\S+?):/m)?.[1];
      if (!printed) {
        problems.push(`cip id shape "${shape.label}": get_cip("${row.id}") printed no headline id, so nothing could be handed back`);
        continue;
      }
      for (const t of CIP_ID_TOOLS) {
        if (!schemas.has(t.tool)) continue;
        cipIdChecks++;
        const answer = await callTool(t.tool, { [t.param]: printed });
        if (ID_REJECTION.test(answer)) {
          problems.push(
            `${t.tool}.${t.param}: refuses "${printed}", which is the id every CIP tool prints for the row stored as ` +
            `"${row.id}" (${shape.label}) — it said: ${answer.replace(/\s+/g, ' ').slice(0, 90)}`,
          );
        } else if (!answer.toLowerCase().includes(row.id.toLowerCase())) {
          problems.push(
            `${t.tool}.${t.param}: accepts "${printed}" but its answer never mentions "${row.id}" (${shape.label}) — ` +
            `it answered about a different record: ${answer.replace(/\s+/g, ' ').slice(0, 90)}`,
          );
        } else if (VERBOSE) {
          console.log(`  ok    ${`${t.tool}.${t.param}`.padEnd(38)} takes its own printed "${printed}"`);
        }
      }
    }
  } finally {
    mcp.close();
  }

  const db = getDb();
  const examined = walked + cipIdChecks;
  console.log(
    `[check-handoffs] ${walked} of ${HANDOFFS.length} declared pair(s) round-tripped; ` +
    `${cipIdChecks} printed-identity round trip(s) over ${CIP_ID_SHAPES.length} id shape(s) × ${CIP_ID_TOOLS.length} tool(s); ` +
    `${mentions} documented mention(s) of another tool, ${Object.keys(NOT_A_HANDOFF).length} classified as not a handoff`,
  );
  if (problems.length) {
    for (const p of problems) console.error(`  BROKEN  ${p}`);
    console.error('          a getter reachable only by id is unreachable if no listing prints one it accepts');
    logRun('check-handoffs', { status: 'partial', items: examined, error: problems.join(' ; ').slice(0, 1000) }, db);
    process.exitCode = 1;
    return;
  }
  console.log('every tool that names another as the source of an id is handed one it accepts, including the id it prints itself');
  logRun('check-handoffs', { status: 'success', items: examined }, db);
}

main().then(() => process.exit(process.exitCode ?? 0)).catch((e) => {
  console.error('[check-handoffs]', e);
  try { logRun('check-handoffs', { status: 'error', items: 0, error: String(e).slice(0, 500) }); } catch { /* db down */ }
  process.exit(1);
});
