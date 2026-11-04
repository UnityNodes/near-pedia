type Json = Record<string, unknown>;
interface Ctx { spec: Json; said: Set<string> }

export const MAX_RENDER_CHARS = 8000;
const MAX_DEPTH = 4;
const RESPONSE_START_DEPTH = 2;
const MAX_ENUM = 12;
const MAX_DESCRIPTION = 400;
const STUB = /^(\S*(?:openapi|swagger)\S*\.(?:json|ya?ml))\s+(get|post|put|patch|delete|head|options)\s+(\S+)[ \t]*(?:\n([\s\S]*))?$/i;

export interface Stub { spec: string; method: string; path: string; rest: string }

export function parseStub(content: string): Stub | null {
  const m = STUB.exec(content.trim());
  return m ? { spec: m[1], method: m[2].toLowerCase(), path: m[3], rest: (m[4] ?? '').trim() } : null;
}

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const oneLine = (s: unknown) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '');

function describe(ctx: Ctx, raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const text = oneLine(raw.split(/\n#{1,6}\s|```/)[0]).replace(/[.;:,]\s*$/, '');
  if (!text || ctx.said.has(text)) return '';
  ctx.said.add(text);
  return text.length > MAX_DESCRIPTION ? `${text.slice(0, MAX_DESCRIPTION).replace(/\s\S*$/, '')} …` : `${text}.`;
}

function resolve(ctx: Ctx, raw: unknown, seen: ReadonlySet<string>): { schema: Json | null; ref: string | null; seen: ReadonlySet<string> } {
  if (!isObj(raw)) return { schema: null, ref: null, seen };
  const ref = typeof raw.$ref === 'string' ? raw.$ref : null;
  if (!ref) return { schema: raw, ref: null, seen };
  if (seen.has(ref) || !ref.startsWith('#/')) return { schema: null, ref, seen };
  const target = ref.slice(2).split('/').reduce<unknown>((o, k) => (isObj(o) ? o[k.replace(/~1/g, '/').replace(/~0/g, '~')] : undefined), ctx.spec);
  return { schema: isObj(target) ? target : null, ref, seen: new Set([...seen, ref]) };
}

function variantsOf(s: Json): unknown[] | null {
  const v = s.oneOf ?? s.anyOf;
  return Array.isArray(v) ? v : null;
}

function propertiesOf(ctx: Ctx, s: Json, seen: ReadonlySet<string>): { props: Array<[string, unknown]>; required: Set<string> } {
  const props: Array<[string, unknown]> = isObj(s.properties) ? Object.entries(s.properties) : [];
  const required = new Set(Array.isArray(s.required) ? s.required.filter((r): r is string => typeof r === 'string') : []);
  if (Array.isArray(s.allOf)) {
    for (const part of s.allOf) {
      const r = resolve(ctx, part, seen);
      if (!r.schema) continue;
      const inner = propertiesOf(ctx, r.schema, r.seen);
      props.push(...inner.props);
      for (const k of inner.required) required.add(k);
    }
  }
  return { props, required };
}

function hasFields(ctx: Ctx, s: Json, seen: ReadonlySet<string>): boolean {
  return variantsOf(s) !== null || propertiesOf(ctx, s, seen).props.length > 0;
}

function typeLabel(ctx: Ctx, s: Json, seen: ReadonlySet<string>): string {
  const t = Array.isArray(s.type) ? s.type.filter((x) => x !== 'null').join(' | ') : typeof s.type === 'string' ? s.type : '';
  if (t !== 'array') return t;
  const items = resolve(ctx, s.items, seen);
  const inner = items.schema ? typeLabel(ctx, items.schema, items.seen) || items.ref?.split('/').pop() : '';
  return inner ? `array of ${inner}` : 'array';
}

function enumText(s: Json): string {
  if (!Array.isArray(s.enum)) return '';
  const values = s.enum.filter((v) => v !== null).map(String);
  const shown = values.slice(0, MAX_ENUM).join(', ');
  return `one of ${shown}${values.length > MAX_ENUM ? ` … (${values.length - MAX_ENUM} more)` : ''}`;
}

function fields(ctx: Ctx, raw: unknown, indent: string, depth: number, seen: ReadonlySet<string>, out: string[]): void {
  const { schema, seen: inner } = resolve(ctx, raw, seen);
  if (!schema || depth > MAX_DEPTH) return;
  const variants = variantsOf(schema);
  if (variants) {
    variants.forEach((v, i) => {
      const r = resolve(ctx, v, inner);
      const s = r.schema;
      const label = (s && oneLine(s.title)) || r.ref?.split('/').pop() || (s && Array.isArray(s.required) && s.required.join(', ')) || `option ${i + 1}`;
      if (s && hasFields(ctx, s, r.seen) && depth < MAX_DEPTH) {
        out.push(`${indent}${label}:`);
        fields(ctx, v, `${indent}  `, depth + 1, inner, out);
      } else {
        const note = s ? [typeLabel(ctx, s, r.seen), enumText(s)].filter(Boolean).join(': ') : '';
        out.push(`${indent}${label}${note && note !== label ? `: ${note}` : ''}`);
      }
    });
    return;
  }
  const { props, required } = propertiesOf(ctx, schema, inner);
  for (const [name, p] of props) field(ctx, name, p, required.has(name), indent, depth, inner, out);
}

function field(ctx: Ctx, name: string, raw: unknown, required: boolean, indent: string, depth: number, seen: ReadonlySet<string>, out: string[]): void {
  const r = resolve(ctx, raw, seen);
  const s = r.schema ?? {};
  const composite = variantsOf(s) !== null;
  const meta = [typeLabel(ctx, s, r.seen), typeof s.format === 'string' ? s.format : '', required ? 'required' : ''].filter(Boolean).join(', ');
  const notes = [describe(ctx, s.description), enumText(s), composite ? 'one of' : ''].filter(Boolean).join(' ');
  out.push(`${indent}- ${name}${meta ? ` (${meta})` : ''}${notes ? `: ${notes}` : ''}`);
  if (depth >= MAX_DEPTH) return;
  const items = s.type === 'array' ? resolve(ctx, s.items, r.seen) : null;
  if (items?.schema && hasFields(ctx, items.schema, items.seen)) fields(ctx, s.items, `${indent}  `, depth + 1, r.seen, out);
  else if (hasFields(ctx, s, r.seen)) fields(ctx, raw, `${indent}  `, depth + 1, seen, out);
}

function cap(text: string): string {
  if (text.length <= MAX_RENDER_CHARS) return text;
  const cut = text.slice(0, MAX_RENDER_CHARS - 2);
  return `${cut.slice(0, cut.lastIndexOf('\n'))}\n…`;
}

export function renderOperation(spec: unknown, method: string, path: string): string | null {
  if (!isObj(spec) || !isObj(spec.paths)) return null;
  const item = spec.paths[path];
  const op = isObj(item) ? item[method] : undefined;
  if (!isObj(item) || !isObj(op)) return null;
  const ctx: Ctx = { spec, said: new Set() };
  const out = [`${method.toUpperCase()} ${path}`];
  for (const t of [oneLine(op.summary), typeof op.description === 'string' ? op.description.trim() : '']) if (t && !out.includes(t)) out.push(t);
  const params = [...(Array.isArray(item.parameters) ? item.parameters : []), ...(Array.isArray(op.parameters) ? op.parameters : [])]
    .map((p) => resolve(ctx, p, new Set()).schema).filter((p): p is Json => p !== null && typeof p.name === 'string');
  if (params.length) {
    out.push('', 'Parameters:');
    for (const p of params) {
      const s = resolve(ctx, p.schema, new Set()).schema ?? {};
      const meta = [oneLine(p.in), typeLabel(ctx, s, new Set()), p.required ? 'required' : ''].filter(Boolean).join(', ');
      const notes = [describe(ctx, p.description), enumText(s)].filter(Boolean).join(' ');
      out.push(`- ${p.name}${meta ? ` (${meta})` : ''}${notes ? `: ${notes}` : ''}`);
    }
  }
  const body = resolve(ctx, op.requestBody, new Set()).schema;
  const bodyType = body && isObj(body.content) ? Object.keys(body.content)[0] : undefined;
  if (body && bodyType && isObj(body.content)) {
    out.push('', `Request body (${bodyType}):`);
    fields(ctx, (body.content[bodyType] as Json | undefined)?.schema, '', 0, new Set(), out);
  }
  if (isObj(op.responses)) {
    out.push('', 'Responses:');
    for (const [code, raw] of Object.entries(op.responses)) {
      const res = resolve(ctx, raw, new Set()).schema;
      if (!res) continue;
      out.push(`${code}: ${oneLine(res.description) || 'no description'}`);
      const type = isObj(res.content) ? Object.keys(res.content)[0] : undefined;
      if (/^2/.test(code) && type && isObj(res.content)) fields(ctx, (res.content[type] as Json | undefined)?.schema, '  ', RESPONSE_START_DEPTH, new Set(), out);
    }
  }
  return cap(out.join('\n'));
}
