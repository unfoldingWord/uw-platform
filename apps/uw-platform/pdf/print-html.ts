import type { Element, ElementContent, Properties, Root, RootContent } from 'hast';
import rehypeRaw from 'rehype-raw';
import rehypeStringify from 'rehype-stringify';
import { unified } from 'unified';
import { SKIP, visit } from 'unist-util-visit';

export type ImageOf = (src: string) => Promise<string | null>;
export type PrintedBody = {
  readonly nodes: readonly RootContent[];
  readonly links: readonly string[];
  readonly imagesLeftOutForSize: number;
};

export const IMAGE_BUDGET_BYTES = 8 * 1024 * 1024;

type Budget = { left: number; spent: boolean; leftOut: number };

const dropped: ReadonlySet<string> = new Set([
  'script',
  'noscript',
  'form',
  'template',
  'iframe',
  'object',
  'embed',
  'link',
  'meta',
  'video',
  'audio',
  'dialog',
]);

const linkable: ReadonlySet<string> = new Set(['http:', 'https:']);

export function element(
  tagName: string,
  properties: Properties,
  children: readonly ElementContent[] = [],
): Element {
  return { type: 'element', tagName, properties, children: [...children] };
}

export function text(value: string): ElementContent {
  return { type: 'text', value };
}

function parsedHtml(html: string): Root {
  const raw: Root = { type: 'root', children: [{ type: 'raw', value: html }] };
  return unified().use(rehypeRaw).runSync(raw);
}

export function htmlOf(tree: Root): string {
  return unified().use(rehypeStringify, { allowDangerousHtml: true }).stringify(tree);
}

function hidden(node: Element): boolean {
  return dropped.has(node.tagName) || node.properties['dataPdfHidden'] !== undefined;
}

function withoutHidden(tree: Root): void {
  visit(tree, 'element', (node, index, parent) => {
    if (parent === undefined || index === undefined || !hidden(node)) return undefined;
    parent.children.splice(index, 1);
    return [SKIP, index];
  });
}

function images(tree: Root): Element[] {
  const found: Element[] = [];
  visit(tree, 'element', (node) => {
    if (node.tagName === 'img') found.push(node);
  });
  return found;
}

function replaceByAlt(node: Element): void {
  const alt = node.properties['alt'];
  node.tagName = 'span';
  node.properties = { dataPdfMissingImage: '' };
  node.children = typeof alt === 'string' && alt !== '' ? [text(alt)] : [];
}

function sourceBytesOf(data: string): number {
  const payload = data.slice(data.indexOf(',') + 1);
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  return Math.floor((payload.length * 3) / 4) - padding;
}

function leaveOutForSize(node: Element, budget: Budget): void {
  budget.spent = true;
  budget.leftOut += 1;
  replaceByAlt(node);
}

async function inlineImage(node: Element, image: ImageOf, budget: Budget): Promise<void> {
  const src = node.properties['src'];
  if (typeof src === 'string' && src.startsWith('data:')) return;
  if (budget.spent) return leaveOutForSize(node, budget);
  const data = typeof src === 'string' ? await image(src) : null;
  if (data === null) return replaceByAlt(node);
  const bytes = sourceBytesOf(data);
  if (bytes > budget.left) return leaveOutForSize(node, budget);
  budget.left -= bytes;
  node.properties = { ...node.properties, src: data, srcSet: undefined };
}

async function inlineImages(tree: Root, image: ImageOf): Promise<number> {
  const budget: Budget = { left: IMAGE_BUDGET_BYTES, spent: false, leftOut: 0 };
  for (const node of images(tree)) {
    await inlineImage(node, image, budget);
  }
  return budget.leftOut;
}

function addressOf(href: unknown, origin: string): string | null {
  if (typeof href !== 'string' || href.startsWith('#')) return null;
  try {
    const url = new URL(href, origin);
    return linkable.has(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function footnote(number: number): Element {
  return element('sup', { dataFootnote: String(number) }, [text(String(number))]);
}

function footnoted(tree: Root, origin: string): string[] {
  const links: string[] = [];
  visit(tree, 'element', (node, index, parent) => {
    if (node.tagName !== 'a' || parent === undefined || index === undefined) return undefined;
    const address = addressOf(node.properties['href'], origin);
    if (address === null) return undefined;
    node.properties = { ...node.properties, href: address };
    if (!links.includes(address)) links.push(address);
    parent.children.splice(index + 1, 0, footnote(links.indexOf(address) + 1));
    return [SKIP, index + 2];
  });
  return links;
}

export async function printedBody(
  html: string,
  origin: string,
  image: ImageOf,
): Promise<PrintedBody> {
  const tree = parsedHtml(html);
  withoutHidden(tree);
  const imagesLeftOutForSize = await inlineImages(tree, image);
  const links = footnoted(tree, origin);
  return { nodes: tree.children, links, imagesLeftOutForSize };
}
