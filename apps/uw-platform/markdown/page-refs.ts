import GithubSlugger from 'github-slugger';
import type { Element, ElementContent, Root, RootContent, Text } from 'hast';
import { toString } from 'hast-util-to-string';
import { SKIP, visit } from 'unist-util-visit';
import { pageAddress, wikiParts, type Resolved } from './wiki-syntax.ts';
import type { FileKind } from './file-video.ts';
import { claimPanels } from './panel-embeds.ts';

export type EmbedSource =
  | { readonly kind: 'page'; readonly title: string; readonly bodyMd: string }
  | { readonly kind: 'denied' }
  | { readonly kind: 'missing' };

export type RenderHooks = {
  readonly linkTitle: (id: string, shown: string) => string | null;
  readonly wiki: (target: string) => Resolved | null;
  readonly embed: (id: string) => EmbedSource;
  readonly fileKind: (id: string) => FileKind | null;
};

type Nested = (source: string, depth: number) => Root;

const DEEPEST_EMBED = 2;
const WIKI = /!?\[\[([^\][\n]+)\]\]/g;
const literal = new Set(['code', 'pre', 'a']);
const headings: Readonly<Record<string, number>> = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 };

function element(
  tagName: string,
  properties: Element['properties'],
  children: ElementContent[],
): Element {
  return { type: 'element', tagName, properties, children };
}

const text = (value: string): Text => ({ type: 'text', value });

function pageLink(id: string, shown: string): Element {
  return element('a', { href: `/pages/${id}` }, [text(shown)]);
}

function wikiLink(match: RegExpMatchArray, hooks: RenderHooks): ElementContent {
  const parts = wikiParts(match[1] ?? '');
  if (parts === null) return text(match[0]);
  const page = hooks.wiki(parts.target);
  if (page !== null) return pageLink(page.id, parts.label ?? page.title);
  const create = `/wiki/new?title=${encodeURIComponent(parts.target)}`;
  return element('a', { href: create, dataWikiMissing: '' }, [text(parts.label ?? parts.target)]);
}

function withWikiLinks(node: Text, hooks: RenderHooks): ElementContent[] {
  const parts: ElementContent[] = [];
  let from = 0;
  for (const match of node.value.matchAll(WIKI)) {
    if (match.index > from) parts.push(text(node.value.slice(from, match.index)));
    parts.push(wikiLink(match, hooks));
    from = match.index + match[0].length;
  }
  if (from < node.value.length) parts.push(text(node.value.slice(from)));
  return parts;
}

function refreshTitle(link: Element, hooks: RenderHooks): void {
  const href = link.properties['href'];
  const address = typeof href === 'string' ? pageAddress(href) : null;
  const only = link.children.length === 1 ? link.children[0] : undefined;
  if (address === null || only?.type !== 'text') return;
  const current = hooks.linkTitle(address.id, only.value);
  if (current !== null) only.value = current;
}

export function pageLinks(hooks: RenderHooks) {
  return () =>
    (tree: Root): void => {
      visit(tree, 'element', (node) => {
        if (node.tagName === 'a') refreshTitle(node, hooks);
        if (literal.has(node.tagName)) return SKIP;
        node.children = node.children.flatMap((child) =>
          child.type === 'text' && child.value.includes('[[')
            ? withWikiLinks(child, hooks)
            : [child],
        );
        return undefined;
      });
    };
}

function sectionOf(tree: Root, fragment: string | null): RootContent[] | null {
  if (fragment === null) return tree.children;
  const slugger = new GithubSlugger();
  let from = -1;
  let level = 0;
  for (const [index, node] of tree.children.entries()) {
    const depth = node.type === 'element' ? headings[node.tagName] : undefined;
    if (depth === undefined) continue;
    if (from >= 0 && depth <= level) return tree.children.slice(from, index);
    if (from < 0 && slugger.slug(toString(node)) === fragment) {
      from = index;
      level = depth;
    }
  }
  return from < 0 ? null : tree.children.slice(from);
}

function notice(words: string): Element {
  return element('p', { dataEmbedNotice: '' }, [text(words)]);
}

type Embedding = {
  readonly hooks: RenderHooks;
  readonly nested: Nested;
  readonly depth: number;
};

function embedded(image: Element, embedding: Embedding): Element | null {
  const src = image.properties['src'];
  const address = typeof src === 'string' ? pageAddress(src) : null;
  if (address === null) return null;
  const source = embedding.hooks.embed(address.id);
  if (source.kind === 'denied') return notice('You do not have access to this section.');
  if (source.kind === 'missing') return notice('This section no longer exists.');
  const origin = element('p', { dataEmbedSource: '' }, [pageLink(address.id, source.title)]);
  if (embedding.depth >= DEEPEST_EMBED) return origin;
  const tree = embedding.nested(source.bodyMd, embedding.depth + 1);
  claimPanels(tree, address.id);
  const section = sectionOf(tree, address.fragment);
  if (section === null) return notice('This section no longer exists.');
  const body = section.filter((node): node is ElementContent => node.type !== 'doctype');
  return element('section', { dataEmbed: address.id }, [origin, ...body]);
}

function soleImage(paragraph: Element): Element | null {
  const meaningful = paragraph.children.filter(
    (child) => child.type !== 'text' || child.value.trim() !== '',
  );
  const only = meaningful.length === 1 ? meaningful[0] : undefined;
  return only?.type === 'element' && only.tagName === 'img' ? only : null;
}

export function pageEmbeds(embedding: Embedding) {
  return () =>
    (tree: Root): void => {
      visit(tree, 'element', (node, index, parent) => {
        if (parent === undefined || index === undefined) return undefined;
        const image = node.tagName === 'p' ? soleImage(node) : node.tagName === 'img' ? node : null;
        const block = image === null ? null : embedded(image, embedding);
        if (block === null) return undefined;
        const inline = node.tagName === 'img' && block.tagName === 'section';
        const shown = inline ? (block.children[0] ?? block) : block;
        parent.children.splice(index, 1, shown);
        return [SKIP, index + 1];
      });
    };
}
