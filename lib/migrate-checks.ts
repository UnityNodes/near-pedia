import { builtinModules } from 'node:module';
import ts from 'typescript';
import type Database from 'better-sqlite3';

export interface RpcShape { type: 'object' | 'array'; forms: string[] }

const SCRIPT = /\.(?:[cm]?[jt]sx?)$/;
const PARAMS = /^- params \((object|array)\b/;
const FIELD = /^ {2}- ([A-Za-z_]\w*) /;
const VARIANT = /^ {2}([A-Za-z_][\w, ]*):\s*$/;

export function rpcShape(page: string): RpcShape | null {
  const lines = page.split('\n');
  const at = lines.findIndex((l) => PARAMS.test(l));
  if (at < 0) return null;
  const fields: string[] = [];
  const variants: string[] = [];
  for (const line of lines.slice(at + 1)) {
    const field = FIELD.exec(line);
    const variant = VARIANT.exec(line);
    if (field) fields.push(field[1]);
    else if (variant) variants.push(variant[1].trim());
    else if (!/^ {4,}/.test(line)) break;
  }
  const forms = variants.length ? variants.map((v) => `{ ${v} }`) : fields.length ? [`{ ${fields.join(', ')} }`] : [];
  return { type: PARAMS.exec(lines[at])![1] as RpcShape['type'], forms };
}

const describeShape = (s: RpcShape) => `an ${s.type}${s.forms.length ? `: ${s.forms.join(' or ')}` : ''}`;

export function rpcHints(methods: readonly string[], shapeOf: (method: string) => RpcShape | null): string[] {
  return methods.flatMap((m) => {
    const shape = shapeOf(m);
    return shape ? [`${m} takes params as ${describeShape(shape)}`] : [];
  });
}

export function rpcShapeLookup(db: Database.Database): (method: string) => RpcShape | null {
  const page = db.prepare(`SELECT content_text FROM doc_pages WHERE substr(content_text, 1, ?) = ? LIMIT 1`);
  const cache = new Map<string, RpcShape | null>();
  return (method) => {
    if (!cache.has(method)) {
      const header = `POST /${method}\n`;
      try {
        const row = page.get(header.length, header) as { content_text: string } | undefined;
        cache.set(method, row ? rpcShape(row.content_text) : null);
      } catch (e) {
        if (!/no such table/.test((e as Error).message)) throw e;
        cache.set(method, null);
      }
    }
    return cache.get(method)!;
  };
}

function scriptKind(file: string): ts.ScriptKind {
  return /x$/.test(file) ? ts.ScriptKind.TSX : /\.[cm]?ts$/.test(file) ? ts.ScriptKind.TS : ts.ScriptKind.JS;
}

function parse(file: string, code: string): ts.SourceFile {
  return ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, scriptKind(file));
}

const propName = (p: ts.ObjectLiteralElementLike) => (p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : null);

export function rpcParamProblems(file: string, code: string, shapeOf: (method: string) => RpcShape | null): string[] {
  if (!SCRIPT.test(file)) return [];
  const problems: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isObjectLiteralExpression(n)) {
      const prop = (name: string) => n.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && propName(p) === name);
      const method = prop('method')?.initializer;
      const params = prop('params')?.initializer;
      if (method && params && (ts.isStringLiteral(method) || ts.isNoSubstitutionTemplateLiteral(method))) {
        const given = ts.isArrayLiteralExpression(params) ? 'array' : ts.isObjectLiteralExpression(params) ? 'object' : null;
        const shape = shapeOf(method.text);
        if (given && shape && given !== shape.type) {
          problems.push(`${method.text} with params as an ${given}; it takes ${describeShape(shape)}`);
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(parse(file, code));
  return problems;
}

function importedModules(file: string, code: string): Set<string> {
  const out = new Set<string>();
  const visit = (n: ts.Node) => {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) out.add(n.moduleSpecifier.text);
    if (ts.isCallExpression(n) && n.arguments[0] && ts.isStringLiteral(n.arguments[0])
      && (n.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(n.expression) && n.expression.text === 'require'))) out.add(n.arguments[0].text);
    ts.forEachChild(n, visit);
  };
  visit(parse(file, code));
  return out;
}

const CHECKED = (m: string) => m === 'near-api-js' || m.startsWith('.') || m.startsWith('/') || m.startsWith('node:') || builtinModules.includes(m);

export function addedImports(file: string, original: string, updated: string): string[] {
  if (!SCRIPT.test(file)) return [];
  const had = importedModules(file, original);
  return [...importedModules(file, updated)].filter((m) => !had.has(m) && !CHECKED(m)).sort();
}
