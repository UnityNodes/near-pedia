/**
 * Does every tool survive the inputs its own schema admits?
 *
 * THE CLASS. A parameter schema is a promise about what will be accepted. The
 * handler behind it assumes more than the schema guarantees, and nothing between
 * them checks. Every other check in this repo reads the CORPUS. None of them
 * asks what happens when a caller sends something the corpus has never seen.
 *
 * Three ways a tool fails an input its schema allowed, in order of how hard they
 * are to notice:
 *
 *   1. it throws                  — loud
 *   2. it answers confidently and wrongly
 *   3. it answers EMPTY in a way indistinguishable from "there is nothing here"
 *
 * WHY THIS EXISTS HERE. Writing it found shape (2) live and widespread: of the 11 tools on this server that
 * tokenise a free-text parameter and OR their tokens for recall, only 3 said
 * which of the caller's terms actually appeared in the answer
 * (search_github_issues, search_talks, find_code_examples). The other 8 -
 * search_release_notes, find_maintainer_guidance, find_expert,
 * ecosystem_dependency_graph, find_known_issues, find_cip_for_feature,
 * detect_drift, learning_path - answered a nonsense multi-word query
 * confidently, because "real" and "value" and "information" match almost any
 * row and nothing said "information" was the only term that hit, or that none
 * did. Fixed alongside this check: each now calls tokenMatchNote() at its own
 * return site (see TOKENISING_TOOLS in mcp-server.ts) - this app has no global
 * server.tool wrapper, so each call site was fixed by hand rather than once
 * centrally.
 *
 * PREFIX_PROBES asserts that a tool advertising
 * "id, or a unique prefix of it" REFUSES an ambiguous prefix rather than
 * silently picking a row. No tool on this server offers that contract - none
 * of its id-shaped lookups do a LIKE-prefix match at all, checked directly
 * against the source - so PREFIX_PROBES is empty.
 *
 * THE SURFACE, and where the number comes from. The SERVER's own published
 * schema, not a regex over the source: the server's number is the one a
 * client actually sees. Enum parameters are skipped, since the schema already
 * closes that door.
 *
 * HOW IT RUNS. Against a scratch MCP instance (lib/mcp-probe.ts: VACUUM INTO
 * copy, a second `npx tsx mcp-server.ts` this script starts and kills) rather
 * than prod, for two reasons: a full walk does not fit
 * inside the real rate limiter, and probing anything other than the real HTTP
 * path is how an audit ends up reporting on code nobody runs.
 *
 * WHAT IT CANNOT SEE:
 *   - One probe value per type. A handler that survives
 *     "zzq-not-a-real-value-9999" and dies on a 10 MB string is not covered.
 *   - Enum parameters are skipped: the schema closes them.
 *   - "Confidently wrong" (shape 2) is only checked for the tokenising surface
 *     named above and for the offset-overshoot / empty-source assertions
 *     below. A tool that answers plausibly about the wrong thing in some other
 *     way is not caught here.
 *
 *   npx tsx scripts/check-inputs.ts
 *   npx tsx scripts/check-inputs.ts --verbose
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { getDb } from '../lib/db';
import { logRun } from '../lib/sync-log';
import { startScratchMcp } from '../lib/mcp-probe';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

/**
 * Read from the WORKING TREE, not git HEAD: the scratch server below runs
 * `npx tsx mcp-server.ts` against whatever is on disk right now, so this list
 * has to describe the same file the server under test actually is.
 */
const TOKENISING: Record<string, string> = (() => {
  const src = fs.readFileSync(path.join(ROOT, 'mcp-server.ts'), 'utf8');
  const open = src.indexOf('const TOKENISING_TOOLS: Record<string, string> = {');
  if (open < 0) throw new Error('TOKENISING_TOOLS not found in mcp-server.ts');
  const close = src.indexOf('\n};', open);
  const block = src.slice(open, close);
  return Object.fromEntries([...block.matchAll(/^\s{2}([a-z_]+):\s*'([a-z_]+)',/gm)].map((m) => [m[1], m[2]]));
})();
const VERBOSE = process.argv.includes('--verbose');
const PROBE_STRING = 'zzq-not-a-real-value-9999';
/** emptyPage's strongest sentence, and the only one that asserts a corpus is empty. */
const EMPTY_SOURCE_CLAIM = /is an empty source, not an empty result set/;
/**
 * A value that matches NOTHING, which PROBE_STRING is not.
 *
 * PROBE_STRING splits on its hyphens into ordinary English words ("not",
 * "real", "value") and every free-text tool here ORs its tokens, so a reused
 * PROBE_STRING would match hundreds of rows and the empty branch would never
 * be reached. One unbroken token, no word inside it.
 */
const UNMATCHABLE = 'zzqxwvunmatchable9999';
const PROBE_INT = 999999999;
/** Only `zzqwmt` is specific; the rest are words any corpus contains. */
const NONSENSE_QUERY = 'zzqwmt real value information';

/**
 * Tools that accept "the id, or a unique prefix of it", and so must DECLINE
 * an ambiguous prefix rather than silently resolve it. Empty here - checked
 * directly against mcp-server.ts and no tool on this server offers a
 * prefix-match lookup - but kept
 * as a typed, populatable list rather than deleting the mechanism, so a
 * future prefix-accepting tool has somewhere to be declared.
 */
interface PrefixProbe { tool: string; param: string; table: string; column: string; why: string }
const PREFIX_PROBES: PrefixProbe[] = [];

/** Runtime-error shapes. A refusal is a sentence; these are not. */
const CRASH_MESSAGE = /(Cannot read propert|is not a function|is not iterable|is not defined|undefined is not|null is not|Maximum call stack|SQLITE_|no such (table|column)|Unexpected token|JSON at position|Converting circular)/i;

interface Problem { where: string; what: string; detail: string }
const problems: Problem[] = [];
let boundsChecked = 0;
let prefixProbed = 0;
let probed = 0;

// Every call is bounded, and so is the run. An unbounded wait here would be a
// check whose siblings exist to catch unbounded waits doing the thing itself.
const RUN_DEADLINE_MS = 6 * 60 * 1000;
const BUDGET_WARN_FRACTION = 0.7;
const startedAt = Date.now();
function budgetLeft(): number { return RUN_DEADLINE_MS - (Date.now() - startedAt); }

interface ToolDef {
  name: string;
  inputSchema?: {
    properties?: Record<string, { type?: string; enum?: unknown[]; description?: string; maximum?: number; anyOf?: { type?: string; maximum?: number }[] }>;
    required?: string[];
  };
}

async function main() {
  const mcp = await startScratchMcp({ label: 'check-inputs', callTimeoutMs: 20_000 });
  try {
    const listed = await mcp.rpc('tools/list', {}) as unknown as { result?: { tools?: ToolDef[] } };
    const tools = listed.result?.tools ?? [];
    if (!tools.length) throw new Error('the scratch server published no tools');

    // Two sources: what the source file registers, against what the server
    // publishes. From git HEAD, not the working tree - a rename that changes
    // both sides identically would leave a working-tree comparison green.
    const headSource = execFileSync('git', ['show', 'HEAD:mcp-server.ts'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    const registered = new Set([...headSource.matchAll(/server\.tool\(\s*'([a-z0-9_]+)'/g)].map((m) => m[1]));
    const published = new Set(tools.map((t) => t.name));
    for (const n of registered) {
      if (!published.has(n)) problems.push({ where: n, what: 'registered at git HEAD but not published by the server', detail: 'the walk below cannot probe it' });
    }
    for (const n of published) {
      if (!registered.has(n)) problems.push({ where: n, what: 'published by the server but not registered at git HEAD', detail: 'the source scan or the registration has moved' });
    }

    const fill: Record<string, unknown> = { string: 'yourchain', integer: 1, number: 1, boolean: false, array: ['yourchain'], object: {} };
    const probe: Record<string, unknown> = { string: PROBE_STRING, integer: PROBE_INT, number: PROBE_INT, boolean: true, array: [PROBE_STRING], object: {} };

    let enums = 0;
    let paginated = 0;
    let tokenising = 0;
    let emptySourceProbed = 0;
    let tailProbed = 0;

    for (const t of tools) {
      const props = t.inputSchema?.properties ?? {};
      const required = new Set(t.inputSchema?.required ?? []);
      const hasOffset = Object.keys(props).includes('offset');
      if (hasOffset) paginated++;

      for (const [name, spec] of Object.entries(props)) {
        if (spec.enum) { enums++; continue; }
        // Probe EVERY type a union admits, not a default of 'string'.
        const anyOf = spec.anyOf;
        const types = anyOf ? [...new Set(anyOf.map((s) => s.type ?? 'string'))] : [spec.type ?? 'string'];
        for (const ty of types) {
          if (budgetLeft() <= 0) { problems.push({ where: 'check-inputs', what: 'ran out of its own time budget', detail: `stopped after ${probed} parameter(s)` }); break; }
          const args: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(props)) {
            if (!required.has(k) && k !== name) continue;
            args[k] = k === name
              ? (probe[ty] ?? probe.string)
              : (v.enum ? v.enum[0] : (fill[v.type ?? 'string'] ?? fill.string));
          }

          const res = await mcp.rpc('tools/call', { name: t.name, arguments: args });
          probed++;
          const err = (res as { error?: { message?: string } }).error;
          if (err) {
            problems.push({ where: `${t.name}.${name}`, what: 'threw on a value its own schema admits', detail: String(err.message).slice(0, 160) });
            continue;
          }
          const content = (res as { result?: { content?: { text?: string }[] } }).result?.content ?? [];
          const text = content.map((c) => c.text ?? '').join('\n');
          // A handler that throws does NOT produce a JSON-RPC error. The SDK
          // catches it and answers with result.isError plus the exception
          // message, the same channel a deliberate refusal uses.
          if ((res as { result?: { isError?: boolean } }).result?.isError && CRASH_MESSAGE.test(text)) {
            problems.push({ where: `${t.name}.${name}`, what: 'crashed on a value its own schema admits', detail: text.replace(/\s+/g, ' ').slice(0, 160) });
            continue;
          }
          if (!text.trim()) {
            problems.push({ where: `${t.name}.${name}`, what: 'answered with nothing at all', detail: '(empty content)' });
          }
        }
      }

      // "This is an empty source, not an empty result set."
      //
      // THE ORACLE IS A SECOND CALL, not a row count: a tool that returns
      // content for an ordinary argument is not an empty source, whatever it
      // just said. The impossible value produces the claim, an ordinary value
      // disproves it, both through the same live handler.
      const strings = Object.entries(props).filter(([, v]) => !v.enum && (v.type ?? 'string') === 'string').map(([k]) => k);
      if (strings.length) {
        const missArgs: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(props)) {
          if (!required.has(k) && !strings.includes(k)) continue;
          missArgs[k] = strings.includes(k) ? UNMATCHABLE : (v.enum ? v.enum[0] : (fill[v.type ?? 'string'] ?? fill.string));
        }
        const missed = (await mcp.callTool(t.name, missArgs));
        emptySourceProbed++;
        if (EMPTY_SOURCE_CLAIM.test(missed)) {
          // CONFIRM before reporting: the claim can be true.
          const benignArgs: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(props)) {
            if (!required.has(k)) continue;
            benignArgs[k] = v.enum ? v.enum[0] : (fill[v.type ?? 'string'] ?? fill.string);
          }
          const benign = await mcp.callTool(t.name, benignArgs);
          if (benign.trim() && !EMPTY_SOURCE_CLAIM.test(benign)) {
            problems.push({
              where: `${t.name}.${strings.join('/')}`,
              what: 'told the caller the source is empty, while the same tool returns content for an ordinary argument',
              detail: `benign call returned ${benign.length} chars: ${benign.replace(/\s+/g, ' ').slice(0, 110)}`,
            });
          }
        }
      }

      // Every tool that tokenises a free-text parameter must SAY which of the
      // caller's terms actually matched. Two things are asserted:
      //   - the registered parameter must EXIST in the published schema.
      //   - a query whose terms cannot all be present must produce the note.
      if (TOKENISING[t.name]) {
        const param = TOKENISING[t.name];
        if (!Object.keys(props).includes(param)) {
          problems.push({ where: `${t.name}.${param}`, what: 'registered as the free-text parameter but the schema has no such parameter', detail: `schema has: ${Object.keys(props).join(', ') || '(none)'}` });
        } else {
          const args: Record<string, unknown> = { [param]: NONSENSE_QUERY };
          for (const [k, v] of Object.entries(props)) {
            if (!required.has(k) || k === param) continue;
            args[k] = v.enum ? v.enum[0] : (fill[v.type ?? 'string'] ?? fill.string);
          }
          const text = await mcp.callTool(t.name, args);
          if (!/_(Matched on|None of these terms)[^_]*_/.test(text)) {
            problems.push({
              where: `${t.name}.${param}`,
              what: 'answered a query containing an impossible term without saying the term matched nothing',
              detail: text.replace(/\s+/g, ' ').slice(0, 140) || '(empty)',
            });
          }
        }
        tokenising++;
      }

      // An offset past the end must not read like an empty corpus.
      if (hasOffset) {
        const base: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(props)) {
          if (!required.has(k) || k === 'offset') continue;
          base[k] = v.enum ? v.enum[0] : (fill[v.type ?? 'string'] ?? fill.string);
        }
        // CONFIRM A PAGE 0 EXISTS BEFORE JUDGING THE OVERSHOT PAGE: a tool
        // that requires an id this check cannot synthesise returns "not
        // found" at every offset, which is a wrong id, not an offset problem.
        const at0: Record<string, unknown> = { ...base, offset: 0 };
        if ('limit' in props) at0.limit = 1;
        const head = await mcp.callTool(t.name, at0);
        const text = await mcp.callTool(t.name, { ...base, offset: PROBE_INT });
        const hasPageZero = head.trim().length > text.trim().length + 40;

        if (hasPageZero) {
          const namesASize = /\b\d+\b/.test(text) && /(corpus|holds|total|of \d+|past the end|offset)/i.test(text);
          if (!namesASize) {
            problems.push({
              where: `${t.name}.offset`,
              what: 'an offset past the end answers as though the source were empty',
              detail: text.replace(/\s+/g, ' ').slice(0, 140),
            });
          }

          // Aim the overshoot exactly past the last row, not just far past it:
          // read the stated total at offset 0, then ask at exactly that offset.
          const stated = head.match(/(?:showing\s+)?\d+\s+of\s+([\d,]+)/i);
          const total = stated ? parseInt(stated[1].replace(/,/g, ''), 10) : 0;
          if (total > 0) {
            const tail = await mcp.callTool(t.name, { ...base, offset: total });
            if (!/past the end/i.test(tail)) {
              problems.push({
                where: `${t.name}.offset`,
                what: `offset ${total} is exactly past the last of ${total} rows, and the answer does not say so`,
                detail: tail.replace(/\s+/g, ' ').slice(0, 140),
              });
            }
            tailProbed++;
          }
        }
      }
    }

    console.log(`tools registered at git HEAD:       ${registered.size}`);
    console.log(`tools published by the server:      ${tools.length}`);
    console.log(`parameters published:               ${tools.reduce((n, t) => n + Object.keys(t.inputSchema?.properties ?? {}).length, 0)}`);
    console.log(`  probed with a schema-legal value: ${probed}`);
    console.log(`  enums, closed by the schema:      ${enums}`);
    console.log(`paginated tools, offset overshot:   ${paginated}`);
    console.log(`free-text tools, terms reported:   ${tokenising}`);
    console.log(`tools asked an unmatchable value:  ${emptySourceProbed}`);

    // ── an ambiguous prefix must be declined, not resolved ─────────────────
    for (const pp of PREFIX_PROBES) {
      let real: string | undefined;
      try {
        real = (mcp.snapshot.prepare(`SELECT "${pp.column}" v FROM "${pp.table}" LIMIT 1`).get() as { v: string } | undefined)?.v;
      } catch { /* table absent in this snapshot */ }
      if (!real) continue;
      const short = real.slice(0, 1);
      let matches = 0;
      try {
        matches = (mcp.snapshot.prepare(
          `SELECT COUNT(*) c FROM "${pp.table}" WHERE "${pp.column}" LIKE ? || '%'`,
        ).get(short) as { c: number }).c;
      } catch { /* */ }
      if (matches < 2) continue;
      prefixProbed++;
      const text = await mcp.callTool(pp.tool, { [pp.param]: short });
      const declined = /more than one|not unique|ambiguous|No .*found/i.test(text);
      if (!declined) {
        problems.push({
          where: `${pp.tool}.${pp.param}`,
          what: `a one-character prefix matching ${matches} rows was ANSWERED instead of declined`,
          detail: `${pp.why}. The caller gets a confident answer about whichever row sorted first: ${text.split('\n')[0].slice(0, 90)}`,
        });
      }
    }

    // ── does a stated bound exist in the schema that states it? ────────────
    //
    // MAX ONLY, deliberately. A stated default the schema does not declare is
    // not asserted - the handler applies `?? n` itself and that is a style
    // choice, not a refusal boundary. A stated MAXIMUM is different: it is a
    // refusal boundary, and a schema that does not carry it cannot refuse.
    for (const t of tools) {
      for (const [param, spec] of Object.entries(t.inputSchema?.properties ?? {})) {
        const d = spec.description ?? '';
        const m = d.match(/\bmax(?:imum)?\s*~?\s*(\d[\d,]*)/i);
        if (!m) continue;
        boundsChecked++;
        const said = Number(m[1].replace(/,/g, ''));
        const real = spec.maximum ?? (spec.anyOf ?? []).map((x) => x.maximum).find((x) => x !== undefined);
        if (real === undefined) {
          problems.push({
            where: `${t.name}.${param}`,
            what: `its description promises "max ${said}" and the schema declares no maximum`,
            detail: 'A caller generating requests from the schema is told any value is allowed. Add .max() so the schema refuses what the sentence says it refuses.',
          });
        } else if (real !== said) {
          problems.push({
            where: `${t.name}.${param}`,
            what: `its description promises "max ${said}" and the schema declares ${real}`,
            detail: 'The prose and the schema disagree about the same boundary; one of them is wrong.',
          });
        }
      }
    }

    console.log(`paginated tools asked at their tail: ${tailProbed}`);
    console.log(`  stated maxima checked against the schema: ${boundsChecked}`);
    console.log(`  prefix tools asked an ambiguous prefix: ${prefixProbed} (${PREFIX_PROBES.length} declared; none on this server)`);

    const usedMs = Date.now() - startedAt;
    const usedPct = usedMs / RUN_DEADLINE_MS;
    console.log(`time used: ${(usedMs / 1000).toFixed(0)}s of a ${RUN_DEADLINE_MS / 1000}s budget (${(usedPct * 100).toFixed(0)}%)`);
    if (usedPct > BUDGET_WARN_FRACTION) {
      problems.push({
        where: 'check-inputs',
        what: `used ${(usedPct * 100).toFixed(0)}% of its own time budget, so the next few tools will cut the walk`,
        detail: `raise RUN_DEADLINE_MS above ${RUN_DEADLINE_MS / 1000}s, or split the walk; ${probed} parameter(s) took ${(usedMs / 1000).toFixed(0)}s`,
      });
    }
  } finally {
    mcp.close();
  }

  for (const p of problems) {
    console.error(`\n[${p.where}] ${p.what}`);
    console.error(`    ${p.detail}`);
  }
  if (!VERBOSE && problems.length) console.error('\n(--verbose changes nothing here; every problem is printed)');

  logRun('check-inputs', {
    status: problems.length ? 'partial' : 'success',
    items: probed,
    error: problems.length ? problems.map((p) => `${p.where}: ${p.what}`).join(' ; ').slice(0, 1000) : undefined,
  }, getDb());

  if (problems.length) {
    console.error(`\ncheck-inputs: ${problems.length} problem(s)`);
    process.exit(1);
  }
  console.log('\ncheck-inputs: every tool survives the inputs its own schema admits');
  process.exit(0);
}

main().catch((e) => {
  console.error(String(e));
  try { logRun('check-inputs', { status: 'error', items: 0, error: String(e).slice(0, 1000) }, getDb()); } catch { /* db down */ }
  process.exit(1);
});
