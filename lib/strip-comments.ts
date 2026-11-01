/**
 * Removing comments before a source scan, in one place.
 *
 * WHY. Three checks each carried their own `code()` and they did not agree:
 *
 *   check-scheduled          block comments -> '', line numbers collapse
 *   check-deadlines          block comments -> spaces, line numbers survive
 *   check-writers-succeeding block comments -> ' ', strips shell `#` not `//`
 *
 * The difference is not cosmetic. check-deadlines reports the line a finding
 * sits on, computed by counting newlines up to the match — so it needs the
 * newline-preserving form, and the other JS one would have made every line
 * number it prints wrong. The third is a different job: sync-tick.sh is shell.
 *
 * A scan that strips comments is doing it because a comment that NAMES a
 * construct is not the construct. check-scheduled learned that when
 * check-upstream-echo grew a comment explaining which writes it inspects and was
 * accused of performing them.
 */

/**
 * JavaScript and TypeScript comments, replaced by whitespace of the same shape.
 *
 * Newlines inside a block comment are kept so that an offset into the result
 * still names the same line in the original. Anything that reports a line number
 * needs this; nothing is harmed by it otherwise.
 */
export function stripJsComments(src: string): string {
  const out: string[] = [];
  const exprDepth: number[] = [];
  let inTemplate = false;
  let prev = '';
  let word = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (inTemplate) {
      if (c === '\\') { out.push(src.slice(i, i + 2)); i += 2; continue; }
      if (c === '`') { out.push(c); i++; inTemplate = false; prev = '`'; word = ''; continue; }
      if (c === '$' && next === '{') { out.push('${'); i += 2; exprDepth.push(0); inTemplate = false; prev = '{'; word = ''; continue; }
      out.push(c); i++; continue;
    }
    if (c === '/' && next === '/' && src[i - 1] !== ':') {
      const end = src.indexOf('\n', i);
      i = end < 0 ? src.length : end;
      continue;
    }
    if (c === '/' && next === '*') {
      const close = src.indexOf('*/', i + 2);
      if (close >= 0) {
        out.push(src.slice(i, close + 2).replace(/[^\n]/g, ' '));
        i = close + 2;
        continue;
      }
    }
    if (c === "'" || c === '"') {
      const end = quotedEnd(src, i, c);
      out.push(src.slice(i, end)); i = end; prev = c; word = ''; continue;
    }
    if (c === '`') { out.push(c); i++; inTemplate = true; continue; }
    if (c === '/') {
      const end = regexAllowed(prev, word) ? regexEnd(src, i) : -1;
      if (end > 0) { out.push(src.slice(i, end)); i = end; prev = ')'; word = ''; continue; }
      out.push(c); i++; prev = c; word = ''; continue;
    }
    if (c === '{' || c === '}') {
      if (exprDepth.length) {
        const top = exprDepth.length - 1;
        if (c === '{') exprDepth[top]++;
        else if (exprDepth[top] === 0) { exprDepth.pop(); out.push(c); i++; inTemplate = true; continue; }
        else exprDepth[top]--;
      }
      out.push(c); i++; prev = c; word = ''; continue;
    }
    if (WORD_CHAR.test(c)) {
      let j = i + 1;
      while (j < src.length && WORD_CHAR.test(src[j])) j++;
      word = src.slice(i, j); out.push(word); i = j; prev = 'w'; continue;
    }
    out.push(c); i++;
    if (!/\s/.test(c)) { prev = c; word = ''; }
  }
  return out.join('');
}

const WORD_CHAR = /[A-Za-z0-9_$]/;
const REGEX_AFTER_WORD = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);
const REGEX_AFTER_PUNCT = new Set('(,=:[!&|?{};+-*%<>~^/}'.split(''));

function regexAllowed(prev: string, word: string): boolean {
  if (prev === '') return true;
  if (prev === 'w') return REGEX_AFTER_WORD.has(word);
  return REGEX_AFTER_PUNCT.has(prev);
}

function quotedEnd(src: string, start: number, quote: string): number {
  let j = start + 1;
  while (j < src.length) {
    const ch = src[j];
    if (ch === '\\') { j += 2; continue; }
    if (ch === quote) return j + 1;
    if (ch === '\n') return j;
    j++;
  }
  return src.length;
}

function regexEnd(src: string, start: number): number {
  let j = start + 1;
  let inClass = false;
  while (j < src.length) {
    const ch = src[j];
    if (ch === '\n') return -1;
    if (ch === '\\') { j += 2; continue; }
    if (inClass) { if (ch === ']') inClass = false; }
    else if (ch === '[') inClass = true;
    else if (ch === '/') {
      j++;
      while (j < src.length && /[a-z]/i.test(src[j])) j++;
      return j;
    }
    j++;
  }
  return -1;
}

/** Shell `#` comments, for reading deploy/sync-tick.sh and friends. */
export function stripShellComments(src: string): string {
  return src.replace(/(^|[^$])#.*$/gm, (_m, p1) => p1);
}

/**
 * Rust comments, replaced by whitespace of the same shape, for check_code.
 * Block comments nest in Rust; string, raw-string and char literals are kept
 * whole so an RPC method name or URL inside one is still seen. A lone `'` is a
 * lifetime, not a char literal, and is copied as is.
 */
export function stripRustComments(src: string): string {
  const out: string[] = [];
  let i = 0;
  const blank = (s: string) => s.replace(/[^\n]/g, ' ');
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '/' && next === '/') {
      const end = src.indexOf('\n', i);
      i = end < 0 ? src.length : end;
      continue;
    }
    if (c === '/' && next === '*') {
      let depth = 1;
      let j = i + 2;
      while (j < src.length && depth > 0) {
        if (src[j] === '/' && src[j + 1] === '*') { depth++; j += 2; continue; }
        if (src[j] === '*' && src[j + 1] === '/') { depth--; j += 2; continue; }
        j++;
      }
      out.push(blank(src.slice(i, j)));
      i = j;
      continue;
    }
    const raw = c === 'r' && !/\w/.test(src[i - 1] ?? '') ? src.slice(i).match(/^r(#*)"/) : null;
    if (raw) {
      const close = src.indexOf(`"${raw[1]}`, i + raw[0].length);
      const end = close < 0 ? src.length : close + 1 + raw[1].length;
      out.push(src.slice(i, end));
      i = end;
      continue;
    }
    if (c === '"') {
      // Rust strings run across lines; the JS helper stops at a newline and
      // would leave the rest of a multi-line string to be read as code.
      let j = i + 1;
      while (j < src.length && src[j] !== '"') j += src[j] === '\\' ? 2 : 1;
      out.push(src.slice(i, j + 1));
      i = j + 1;
      continue;
    }
    if (c === "'") {
      const lit = src.slice(i).match(/^'(?:\\(?:x[0-9a-fA-F]{2}|u\{[0-9a-fA-F]+\}|.)|[^'\\\n])'/);
      if (lit) { out.push(lit[0]); i += lit[0].length; continue; }
    }
    out.push(c);
    i++;
  }
  return out.join('');
}

/** TOML `#` comments outside strings, for Cargo.toml scans. */
export function stripTomlComments(src: string): string {
  return src.split('\n').map((line) => {
    let quote: string | null = null;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (quote) {
        if (c === '\\' && quote === '"') { i++; continue; }
        if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'") { quote = c; continue; }
      if (c === '#') return line.slice(0, i) + ' '.repeat(line.length - i);
    }
    return line;
  }).join('\n');
}
