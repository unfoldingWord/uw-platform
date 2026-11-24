import type { Element, ElementContent, Root } from 'hast';
import { SKIP, visit } from 'unist-util-visit';

const VIEW =
  /^\/collections\/([a-z][a-z0-9_]{0,39})\/views\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

export type ViewAddress = { readonly collection: string; readonly viewId: string };

export function viewAddress(url: string): ViewAddress | null {
  const match = VIEW.exec(url);
  if (match === null) return null;
  return { collection: match[1] ?? '', viewId: match[2] ?? '' };
}

function soleImage(node: Element): Element | null {
  if (node.tagName !== 'p') return null;
  const meaningful = node.children.filter(
    (child) => child.type !== 'text' || child.value.trim() !== '',
  );
  const only = meaningful.length === 1 ? meaningful[0] : undefined;
  return only?.type === 'element' && only.tagName === 'img' ? only : null;
}

function placeholder(address: ViewAddress, src: string, alt: string): Element {
  const link: ElementContent = {
    type: 'element',
    tagName: 'a',
    properties: { href: src },
    children: [{ type: 'text', value: alt === '' ? 'Saved view' : alt }],
  };
  return {
    type: 'element',
    tagName: 'div',
    properties: { dataViewEmbed: address.viewId, dataCollection: address.collection },
    children: [link],
  };
}

export function viewEmbeds() {
  return () =>
    (tree: Root): void => {
      visit(tree, 'element', (node, index, parent) => {
        if (parent === undefined || index === undefined) return undefined;
        const image = soleImage(node);
        const src = image?.properties['src'];
        const address = typeof src === 'string' ? viewAddress(src) : null;
        if (image === null || address === null || typeof src !== 'string') return undefined;
        const alt = typeof image.properties['alt'] === 'string' ? image.properties['alt'] : '';
        parent.children.splice(index, 1, placeholder(address, src, alt));
        return [SKIP, index + 1];
      });
    };
}

const PLACEHOLDER =
  /<div data-view-embed="([0-9a-f-]{36})" data-collection="([a-z][a-z0-9_]{0,39})">[\s\S]*?<\/div>/g;

export type Placed = {
  readonly viewId: string;
  readonly collection: string;
  readonly start: number;
  readonly end: number;
};

export function placedViews(html: string): readonly Placed[] {
  return [...html.matchAll(PLACEHOLDER)].map((match) => ({
    viewId: match[1] ?? '',
    collection: match[2] ?? '',
    start: match.index,
    end: match.index + match[0].length,
  }));
}
