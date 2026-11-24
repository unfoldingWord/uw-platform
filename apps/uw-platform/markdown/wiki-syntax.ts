import GithubSlugger from 'github-slugger';
import type { Root } from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';

export type WikiRef = {
  readonly kind: 'link' | 'embed';
  readonly target: string;
  readonly heading: string | null;
  readonly label: string | null;
  readonly start: number;
  readonly end: number;
};

export type Resolved = { readonly id: string; readonly title: string };
export type PageRefs = {
  readonly links: readonly string[];
  readonly embeds: readonly { readonly id: string; readonly fragment: string | null }[];
};

const WIKI = /(?<!\\)(!?)\[\[([^\][\n]+)\]\]/g;
const PAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PAGES = '/pages/';

function parse(source: string): Root {
  return unified().use(remarkParse).use(remarkGfm).parse(source);
}

export function pageAddress(url: string): { id: string; fragment: string | null } | null {
  if (!url.startsWith(PAGES)) return null;
  const [id = '', ...rest] = url.slice(PAGES.length).split('#');
  if (!PAGE_ID.test(id)) return null;
  const fragment = rest.join('#');
  return { id, fragment: fragment === '' ? null : fragment };
}

function headingSlug(heading: string): string {
  return new GithubSlugger().slug(heading);
}

function part(text: string | undefined): string | null {
  const trimmed = text?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

export function wikiParts(inner: string): Pick<WikiRef, 'target' | 'heading' | 'label'> | null {
  const [before = '', ...labelled] = inner.split('|');
  const [named = '', ...sectioned] = before.split('#');
  const target = part(named);
  if (target === null) return null;
  return { target, heading: part(sectioned.join('#')), label: part(labelled.join('|')) };
}

function refsIn(source: string, from: number, to: number): WikiRef[] {
  const found: WikiRef[] = [];
  for (const match of source.slice(from, to).matchAll(WIKI)) {
    const parts = wikiParts(match[2] ?? '');
    if (parts === null) continue;
    const start = from + match.index;
    const kind = match[1] === '!' ? 'embed' : 'link';
    found.push({ kind, ...parts, start, end: start + match[0].length });
  }
  return found;
}

export function wikiRefs(source: string): readonly WikiRef[] {
  const found: WikiRef[] = [];
  visit(parse(source), 'text', (node) => {
    const from = node.position?.start.offset;
    const to = node.position?.end.offset;
    if (from === undefined || to === undefined) return;
    found.push(...refsIn(source, from, to));
  });
  return found.sort((left, right) => left.start - right.start);
}

function escaped(text: string): string {
  return text.replace(/[\\[\]]/g, (bracket) => `\\${bracket}`);
}

function written(ref: WikiRef, page: Resolved): string {
  const shown = escaped(ref.label ?? page.title);
  if (ref.kind === 'link') return `[${shown}](/pages/${page.id})`;
  const fragment = ref.heading === null ? '' : `#${headingSlug(ref.heading)}`;
  return `![${shown}](/pages/${page.id}${fragment})`;
}

export function rewriteWikiRefs(
  source: string,
  resolve: (target: string) => Resolved | null,
): string {
  let out = source;
  for (const ref of [...wikiRefs(source)].reverse()) {
    const page = resolve(ref.target);
    if (page === null) continue;
    out = `${out.slice(0, ref.start)}${written(ref, page)}${out.slice(ref.end)}`;
  }
  return out;
}

export function pageRefs(source: string): PageRefs {
  const links = new Set<string>();
  const embeds = new Map<string, { id: string; fragment: string | null }>();
  visit(parse(source), (node) => {
    if (node.type !== 'link' && node.type !== 'image') return;
    const address = pageAddress(node.url);
    if (address === null) return;
    if (node.type === 'link') links.add(address.id);
    else embeds.set(`${address.id}#${address.fragment ?? ''}`, address);
  });
  return { links: [...links], embeds: [...embeds.values()] };
}
