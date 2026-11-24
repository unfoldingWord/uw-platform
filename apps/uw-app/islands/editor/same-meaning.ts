import type { Definition, Nodes, Root } from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';

const IGNORED: ReadonlySet<string> = new Set(['position', 'spread']);
const IMAGE_ONLY: ReadonlySet<string> = new Set(['alt', 'title']);
const REFERENCE_ONLY: ReadonlySet<string> = new Set(['identifier', 'label', 'referenceType']);

type Definitions = ReadonlyMap<string, Definition>;

function parsed(markdown: string): Root {
  return unified().use(remarkParse).use(remarkGfm).parse(markdown);
}

function definitionsIn(root: Root): Definitions {
  const found = new Map<string, Definition>();
  visit(root, 'definition', (node) => {
    if (!found.has(node.identifier)) found.set(node.identifier, node);
  });
  return found;
}

function resolvedType(node: Nodes): string {
  if (node.type === 'linkReference') return 'link';
  if (node.type === 'imageReference') return 'image';
  return node.type;
}

function kept(type: string, key: string): boolean {
  if (IGNORED.has(key) || REFERENCE_ONLY.has(key)) return false;
  return !(type === 'image' && IMAGE_ONLY.has(key));
}

function plain(node: Nodes, definitions: Definitions): unknown {
  const type = resolvedType(node);
  const target =
    'identifier' in node && type !== node.type ? definitions.get(node.identifier) : undefined;
  const fields = Object.entries(node)
    .filter(([key]) => kept(type, key))
    .map(([key, value]) => {
      if (key === 'type') return [key, type];
      if (key !== 'children') return [key, value];
      const children = (value as Nodes[]).filter((child) => child.type !== 'definition');
      return [key, children.map((child) => plain(child, definitions))];
    });
  const titled = target === undefined || type === 'image' ? [] : [['title', target.title ?? null]];
  const resolved = target === undefined ? [] : [['url', target.url], ...titled];
  return Object.fromEntries(
    [...fields, ...resolved].sort(([a], [b]) => String(a).localeCompare(String(b))),
  );
}

const LIVE_WIKI = /(?<!\\)(!?)(?<!\\)\[\[([^\][\n]+)\]\]/g;

function liveWikiLinks(root: Root, markdown: string): readonly string[] {
  const found: string[] = [];
  visit(root, 'text', (node) => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) return;
    for (const match of markdown.slice(start, end).matchAll(LIVE_WIKI)) {
      found.push(`${match[1] ?? ''}${match[2] ?? ''}`);
    }
  });
  return found;
}

function meaningOf(markdown: string): string {
  const root = parsed(markdown);
  const links = liveWikiLinks(root, markdown);
  return JSON.stringify([plain(root, definitionsIn(root)), links]);
}

export function sameMeaning(before: string, after: string): boolean {
  return meaningOf(before) === meaningOf(after);
}
