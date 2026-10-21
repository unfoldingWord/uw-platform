type Line = { readonly text: string; readonly fenced: boolean };
type Visible = { readonly text: string; readonly comment: boolean };

const DONE_WHEN = /^done when:?$/i;
const FENCE = /^ {0,3}(```|~~~)/;
const LIST_MARK = /^(?:[-*+]|\d{1,9}[.)])[ \t]+/;
const CHECKBOX = /^\[[ xX]\][ \t]+/;
const BLOCKED_BY = /^blocked by/i;
const LIST_START = /^[-*+][ \t]+/;
const BOLD = /^(?:\*\*|__)/;
const STRUCK = /~~.*?~~/g;
const SEPARATORS = /[\s,;()]+/;
const DIGITS = /^\d{1,9}$/;
const COMMENT_OPEN = '<!--';
const COMMENT_CLOSE = '-->';
const LINE_LIMIT = 20;
const LENGTH_LIMIT = 500;
const BLOCKER_LIMIT = 50;

function uncommented(text: string, inComment: boolean): Visible {
  const parts: string[] = [];
  let comment = inComment;
  let at = 0;
  while (at < text.length) {
    const next = text.indexOf(comment ? COMMENT_CLOSE : COMMENT_OPEN, at);
    if (!comment) parts.push(text.slice(at, next < 0 ? text.length : next));
    if (next < 0) break;
    at = next + (comment ? COMMENT_CLOSE.length : COMMENT_OPEN.length);
    comment = !comment;
  }
  return { text: parts.join(''), comment };
}

function marked(markdown: string): readonly Line[] {
  const lines: Line[] = [];
  let fence: string | null = null;
  let comment = false;
  for (const raw of markdown.replaceAll('\u0000', '').split(/\r?\n/)) {
    const opened = comment ? null : (FENCE.exec(raw)?.[1] ?? null);
    if (fence !== null || opened !== null) {
      lines.push({ text: raw, fenced: true });
      if (fence === null) fence = opened;
      else if (opened === fence) fence = null;
      continue;
    }
    const visible = uncommented(raw, comment);
    comment = visible.comment;
    lines.push({ text: visible.text, fenced: false });
  }
  return lines;
}

function trimmedEnd(text: string, strip: string): string {
  let end = text.length;
  while (end > 0 && strip.includes(text.charAt(end - 1))) end -= 1;
  return text.slice(0, end);
}

function headingText(line: Line): string | null {
  if (line.fenced) return null;
  let at = 0;
  while (at < 3 && line.text.charAt(at) === ' ') at += 1;
  let level = 0;
  while (line.text.charAt(at + level) === '#') level += 1;
  const after = line.text.charAt(at + level);
  if (level < 1 || level > 6 || (after !== '' && after !== ' ' && after !== '\t')) return null;
  return trimmedEnd(line.text.slice(at + level), ' \t#').trimStart();
}

function cleaned(text: string): string {
  return text
    .trimStart()
    .replace(LIST_MARK, '')
    .replace(CHECKBOX, '')
    .trim()
    .slice(0, LENGTH_LIMIT);
}

export function doneWhenOf(markdown: string): readonly string[] {
  const lines = marked(markdown);
  const start = lines.findIndex((line) => DONE_WHEN.test(headingText(line) ?? ''));
  if (start < 0) return [];
  const found: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (headingText(line) !== null || found.length === LINE_LIMIT) break;
    const text = cleaned(line.text);
    if (!line.fenced && text !== '' && blockedLine(line.text) === undefined) found.push(text);
  }
  return found;
}

function referenceOf(token: string, own: string): number | null {
  const mark = token.lastIndexOf('#');
  if (mark < 0) return null;
  const owner = token.slice(0, mark).toLowerCase();
  const number = trimmedEnd(token.slice(mark + 1), '.:');
  if ((owner !== '' && owner !== own) || !DIGITS.test(number)) return null;
  return Number(number) > 0 ? Number(number) : null;
}

function referencesIn(listed: string, repository: string): readonly number[] {
  const own = repository.toLowerCase();
  const tokens = listed.replace(STRUCK, ' ').split(SEPARATORS);
  return tokens.flatMap((token) => referenceOf(token, own) ?? []);
}

function blockedLine(text: string): string | undefined {
  const bare = text.trim().replace(LIST_START, '').replace(BOLD, '');
  if (!BLOCKED_BY.test(bare)) return undefined;
  const rest = bare.slice('blocked by'.length).replace(BOLD, '').trimStart();
  return rest.startsWith(':') ? rest.slice(1) : undefined;
}

export function blockedByOf(markdown: string, repository: string): readonly number[] {
  const found = new Set<number>();
  for (const line of marked(markdown)) {
    const listed = line.fenced ? undefined : blockedLine(line.text);
    if (listed === undefined) continue;
    for (const number of referencesIn(listed, repository)) found.add(number);
  }
  return [...found].slice(0, BLOCKER_LIMIT);
}
