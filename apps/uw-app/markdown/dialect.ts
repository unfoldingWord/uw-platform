import type { Element, ElementContent, Root, Text } from 'hast';
import { SKIP, visit } from 'unist-util-visit';

export const calloutKinds = ['note', 'tip', 'important', 'warning', 'caution'] as const;

const CALLOUT = /^\[!([A-Za-z]+)\]\s*/;
const HIGHLIGHT = /==([^=\n]+)==/g;
const OUTSIDE = /^https?:\/\//i;
const literal = new Set(['code', 'pre']);

function isElement(node: ElementContent | undefined, tag: string): node is Element {
  return node?.type === 'element' && node.tagName === tag;
}

function calloutKind(word: string): string | null {
  const kind = word.toLowerCase();
  return (calloutKinds as readonly string[]).includes(kind) ? kind : null;
}

function markCallout(quote: Element): void {
  const first = quote.children.find((child) => child.type === 'element');
  if (!isElement(first, 'p')) return;
  const lead = first.children[0];
  if (lead?.type !== 'text') return;
  const found = CALLOUT.exec(lead.value);
  const kind = found === null ? null : calloutKind(found[1] ?? '');
  if (found === null || kind === null) return;
  lead.value = lead.value.slice(found[0].length);
  quote.properties = { ...quote.properties, dataCallout: kind };
}

function highlighted(text: Text): ElementContent[] {
  const parts: ElementContent[] = [];
  let from = 0;
  for (const found of text.value.matchAll(HIGHLIGHT)) {
    if (found.index > from)
      parts.push({ type: 'text', value: text.value.slice(from, found.index) });
    parts.push({
      type: 'element',
      tagName: 'mark',
      properties: {},
      children: [{ type: 'text', value: found[1] ?? '' }],
    });
    from = found.index + found[0].length;
  }
  if (from < text.value.length) parts.push({ type: 'text', value: text.value.slice(from) });
  return parts;
}

export function dialect() {
  return (tree: Root): void => {
    visit(tree, 'element', (node) => {
      if (literal.has(node.tagName)) return SKIP;
      if (node.tagName === 'blockquote') markCallout(node);
      node.children = node.children.flatMap((child) =>
        child.type === 'text' && child.value.includes('==') ? highlighted(child) : [child],
      );
      return undefined;
    });
  };
}

export function outsideLinks() {
  return (tree: Root): void => {
    visit(tree, 'element', (node) => {
      const href = node.properties['href'];
      if (node.tagName !== 'a' || typeof href !== 'string' || !OUTSIDE.test(href)) return;
      node.properties = { ...node.properties, rel: ['noopener', 'noreferrer'] };
    });
  };
}
