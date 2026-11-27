export type PageWords = {
  readonly title: string;
  readonly text: string;
  readonly scripted: boolean;
};

const DROPPED = ['script', 'style', 'noscript', 'svg', 'template', 'iframe', 'head'] as const;
const BLOCK_TAG =
  /<\/?(p|div|br|li|ul|ol|tr|td|th|h[1-6]|section|article|header|footer|main|nav|table|blockquote|pre|dd|dt)\b[^>]*>/gi;
const ANY_TAG = /<[^>]*>/g;
const COMMENT_OPEN = '<!--';
const COMMENT_CLOSE = '-->';
const TITLE = /<title\b[^>]*>([^<]*)<\/title\s*>/i;
const NAMED: ReadonlyMap<string, string> = new Map([
  ['nbsp', ' '],
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
  ['ndash', '-'],
  ['mdash', '-'],
  ['hellip', '...'],
  ['euro', 'EUR'],
  ['pound', 'GBP'],
  ['copy', '(c)'],
]);
const ENTITY = /&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi;
const CODE_POINT_MOST = 0x10ffff;

const TAG_END: ReadonlySet<string> = new Set([' ', '>', '/', '\t', '\n', '\r']);

function openingAt(lower: string, open: string, from: number): number {
  let at = lower.indexOf(open, from);
  while (at >= 0 && open.startsWith('<') && open !== COMMENT_OPEN) {
    if (TAG_END.has(lower.charAt(at + open.length))) return at;
    at = lower.indexOf(open, at + 1);
  }
  return at;
}

function cut(html: string, open: string, close: string): string {
  const lower = html.toLowerCase();
  const pieces: string[] = [];
  let from = 0;
  for (;;) {
    const start = openingAt(lower, open, from);
    if (start < 0) break;
    pieces.push(html.slice(from, start));
    const end = lower.indexOf(close, start + open.length);
    if (end < 0) return pieces.join(' ');
    const after = lower.indexOf('>', end);
    if (after < 0) return pieces.join(' ');
    from = after + 1;
  }
  pieces.push(html.slice(from));
  return pieces.join(' ');
}

function decoded(entity: string, body: string): string {
  const lower = body.toLowerCase();
  if (!lower.startsWith('#')) return NAMED.get(lower) ?? entity;
  const point = lower.startsWith('#x')
    ? Number.parseInt(lower.slice(2), 16)
    : Number.parseInt(lower.slice(1), 10);
  return point > 0 && point <= CODE_POINT_MOST ? String.fromCodePoint(point) : entity;
}

function decodeEntities(text: string): string {
  return text.replace(ENTITY, (entity, body: string) => decoded(entity, body));
}

function lines(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t\r\f\v\u00a0]+/g, ' ').trim())
    .filter((line) => line !== '')
    .join('\n');
}

export function pageWords(html: string): PageWords {
  const title = lines(decodeEntities(TITLE.exec(html)?.[1] ?? ''));
  let body = cut(html, COMMENT_OPEN, COMMENT_CLOSE);
  const scripted = body.toLowerCase().includes('<script');
  for (const name of DROPPED) body = cut(body, `<${name}`, `</${name}`);
  const text = lines(decodeEntities(body.replace(BLOCK_TAG, '\n').replace(ANY_TAG, ' ')));
  return { title, text, scripted };
}
