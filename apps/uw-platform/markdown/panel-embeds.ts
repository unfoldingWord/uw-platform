import type { Element, Root } from 'hast';
import { SKIP, visit } from 'unist-util-visit';

const PANEL_CLASS = 'language-panel';

function panelCode(node: Element): boolean {
  if (node.tagName !== 'pre') return false;
  const [code] = node.children;
  if (code?.type !== 'element' || code.tagName !== 'code') return false;
  const classes = code.properties['className'];
  return Array.isArray(classes) && classes.includes(PANEL_CLASS);
}

export function claimPanels(tree: Root, pageId: string): void {
  visit(tree, 'element', (node) => {
    const { properties } = node;
    if (properties['dataPanelBlock'] === undefined || properties['dataPanelPage'] !== undefined)
      return;
    properties['dataPanelPage'] = pageId;
  });
}

export function panelEmbeds() {
  return () =>
    (tree: Root): void => {
      let index = 0;
      visit(tree, 'element', (node, at, parent) => {
        if (parent === undefined || at === undefined || !panelCode(node)) return undefined;
        const holder: Element = {
          type: 'element',
          tagName: 'div',
          properties: { dataPanelBlock: String(index) },
          children: [node],
        };
        index += 1;
        parent.children.splice(at, 1, holder);
        return [SKIP, at + 1];
      });
    };
}

const PLACEHOLDER = /<div data-panel-block="(\d{1,3})"([^>]{0,60})>[\s\S]*?<\/pre><\/div>/g;
const OWNER = /^ data-panel-page="([0-9a-f-]{36})"$/;

export type PlacedPanel = {
  readonly index: number;
  readonly pageId: string | null;
  readonly start: number;
  readonly end: number;
};

export function placedPanels(html: string): readonly PlacedPanel[] {
  return [...html.matchAll(PLACEHOLDER)].map((match) => ({
    index: Number(match[1]),
    pageId: OWNER.exec(match[2] ?? '')?.[1] ?? null,
    start: match.index,
    end: match.index + match[0].length,
  }));
}
