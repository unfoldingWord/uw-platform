type Line = { readonly text: string; readonly fenced: boolean };

const HEADING = /^ {0,3}#{1,6}[ \t]+(.*?)[ \t#]*$/;
const DONE_WHEN = /^done when:?$/i;
const FENCE = /^ {0,3}(```|~~~)/;
const LIST_MARK = /^(?:[-*+]|\d{1,9}[.)])[ \t]+/;
const CHECKBOX = /^\[[ xX]\][ \t]+/;
const COMMENT_ONLY = /^<!--.*-->$/;
const BLOCKED_BY = /^blocked by/i;
const LIST_START = /^[-*+][ \t]+/;
const BOLD = /^(?:\*\*|__)/;
const STRUCK = /~~.*?~~/g;
const SEPARATORS = /[\s,;()]+/;
const TRAILING = /[.:]+$/;
const DIGITS = /^\d{1,9}$/;
const LINE_LIMIT = 20;
const LENGTH_LIMIT = 500;
const BLOCKER_LIMIT = 50;

function marked(markdown: string): readonly Line[] {
  const lines: Line[] = [];
  let fence: string | null = null;
  for (const text of markdown.replaceAll('\u0000', '').split(/\r?\n/)) {
    const opened = FENCE.exec(text)?.[1] ?? null;
    if (fence === null && opened !== null) {
      fence = opened;
      lines.push({ text, fenced: true });
      continue;
    }
    const closing = fence !== null && opened === fence;
    lines.push({ text, fenced: fence !== null });
    if (closing) fence = null;
  }
  return lines;
}

function headingText(line: Line): string | null {
  if (line.fenced) return null;
  return HEADING.exec(line.text)?.[1] ?? null;
}

function cleaned(text: string): string {
  return text.trim().replace(LIST_MARK, '').replace(CHECKBOX, '').trim().slice(0, LENGTH_LIMIT);
}

export function doneWhenOf(markdown: string): readonly string[] {
  const lines = marked(markdown);
  const start = lines.findIndex((line) => DONE_WHEN.test(headingText(line) ?? ''));
  if (start < 0) return [];
  const found: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (headingText(line) !== null || found.length === LINE_LIMIT) break;
    const text = cleaned(line.text);
    if (!line.fenced && text !== '' && !COMMENT_ONLY.test(text)) found.push(text);
  }
  return found;
}

function referenceOf(token: string, own: string): number | null {
  const mark = token.lastIndexOf('#');
  if (mark < 0) return null;
  const owner = token.slice(0, mark).toLowerCase();
  const number = token.slice(mark + 1).replace(TRAILING, '');
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
