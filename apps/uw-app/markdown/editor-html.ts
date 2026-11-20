import type { Element, ElementContent, Root } from 'hast';
import rehypeStringify from 'rehype-stringify';
import { unified } from 'unified';
import { SKIP, visit } from 'unist-util-visit';
import { sanitisedTree } from './render.ts';
import { pageAddress } from './wiki-syntax.ts';

function element(
  tagName: string,
  properties: Element['properties'],
  children: ElementContent[],
): Element {
  return { type: 'element', tagName, properties, children };
}

function tagged(node: ElementContent | undefined, tagName: string): Element | null {
  return node?.type === 'element' && node.tagName === tagName ? node : null;
}

function isTag(node: ElementContent | undefined, tagName: string): boolean {
  return tagged(node, tagName) !== null;
}

function checkboxOf(item: Element): Element | null {
  const first = item.children.find((child) => child.type !== 'text' || child.value.trim() !== '');
  return tagged(first, 'input') ?? tagged(tagged(first, 'p')?.children[0], 'input');
}

function withoutCheckbox(item: Element, box: Element): ElementContent[] {
  return item.children
    .filter((child) => child !== box)
    .map((child) => {
      const paragraph = tagged(child, 'p');
      if (paragraph === null) return child;
      const kept = paragraph.children.filter((inner) => inner !== box);
      return { ...paragraph, children: trimmedLead(kept) };
    });
}

function trimmedLead(children: ElementContent[]): ElementContent[] {
  const [first, ...rest] = children;
  if (first?.type !== 'text') return children;
  return [{ ...first, value: first.value.replace(/^\s+/, '') }, ...rest];
}

function taskList(list: Element): void {
  const items = list.children.flatMap((child) => tagged(child, 'li') ?? []);
  const boxes = items.map(checkboxOf);
  if (items.length === 0 || boxes.some((box) => box === null)) return;
  list.properties = { dataType: 'taskList' };
  for (const [index, item] of items.entries()) {
    const box = boxes.at(index);
    if (box === null || box === undefined) continue;
    const checked = box.properties['checked'] === true || box.properties['checked'] === '';
    item.properties = { dataType: 'taskItem', dataChecked: checked ? 'true' : 'false' };
    item.children = withoutCheckbox(item, box);
  }
}

function detailsContent(details: Element): void {
  const summary = details.children.find((child) => isTag(child, 'summary'));
  const rest = details.children.filter(
    (child) => child !== summary && (child.type !== 'text' || child.value.trim() !== ''),
  );
  const content = element('div', { dataType: 'detailsContent' }, rest);
  details.children = [summary ?? element('summary', {}, []), content];
}

function embedOf(paragraph: Element): Element | null {
  const meaningful = paragraph.children.filter(
    (child) => child.type !== 'text' || child.value.trim() !== '',
  );
  const only = tagged(meaningful.length === 1 ? meaningful[0] : undefined, 'img');
  if (only === null) return null;
  const src = only.properties['src'];
  if (typeof src !== 'string' || pageAddress(src) === null) return null;
  const alt = only.properties['alt'];
  return element('div', { dataPageEmbed: src, dataTitle: typeof alt === 'string' ? alt : '' }, []);
}

function forEditor() {
  return (tree: Root): void => {
    visit(tree, 'element', (node, index, parent) => {
      if (node.tagName === 'ul') taskList(node);
      if (node.tagName === 'details') detailsContent(node);
      const embed = node.tagName === 'p' ? embedOf(node) : null;
      if (embed === null || parent === undefined || index === undefined) return undefined;
      parent.children.splice(index, 1, embed);
      return [SKIP, index + 1];
    });
  };
}

export function editorHtml(markdown: string): string {
  const finish = unified().use(forEditor).use(rehypeStringify);
  const tree = sanitisedTree(markdown);
  finish.runSync(tree);
  return finish.stringify(tree);
}
