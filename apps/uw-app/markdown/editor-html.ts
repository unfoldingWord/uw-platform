import type { Element, ElementContent, Root } from 'hast';
import type { Root as MdastRoot } from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import rehypeStringify from 'rehype-stringify';
import { unified } from 'unified';
import { SKIP, visit } from 'unist-util-visit';
import { fileIdOf, type KindOf } from './file-video.ts';
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

const noKind: KindOf = () => null;

function markVideo(image: Element, kindOf: KindOf): void {
  const src = image.properties['src'];
  const id = typeof src === 'string' ? fileIdOf(src) : null;
  if (id !== null && kindOf(id) === 'video') image.properties['dataFileKind'] = 'video';
}

function forEditor(kindOf: KindOf) {
  return (tree: Root): void => {
    visit(tree, 'element', (node, index, parent) => {
      if (node.tagName === 'img') markVideo(node, kindOf);
      if (node.tagName === 'ul') taskList(node);
      if (node.tagName === 'details') detailsContent(node);
      const embed = node.tagName === 'p' ? embedOf(node) : null;
      if (embed === null || parent === undefined || index === undefined) return undefined;
      parent.children.splice(index, 1, embed);
      return [SKIP, index + 1];
    });
  };
}

export function editorHtml(markdown: string, kindOf: KindOf = noKind): string {
  const finish = unified().use(forEditor, kindOf).use(rehypeStringify);
  const tree = sanitisedTree(markdown);
  finish.runSync(tree);
  return finish.stringify(tree);
}

const RAW_HTML_KEPT = new Set(['<details>', '</details>', '<br>', '<br/>', '<br />']);
const SUMMARY_OPEN = '<summary>';
const SUMMARY_CLOSE = '</summary>';

const EDITOR_TAGS = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'strong',
  'em',
  'del',
  's',
  'a',
  'ul',
  'ol',
  'li',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'br',
  'code',
  'pre',
  'blockquote',
  'details',
  'summary',
  'div',
  'mark',
  'img',
  'hr',
  'input',
]);

function keptRawHtml(value: string): boolean {
  const raw = value.trim().toLowerCase();
  if (RAW_HTML_KEPT.has(raw)) return true;
  if (raw.startsWith(SUMMARY_OPEN) && raw.endsWith(SUMMARY_CLOSE)) {
    const inner = raw.slice(SUMMARY_OPEN.length, -SUMMARY_CLOSE.length);
    return !inner.includes('<');
  }
  return raw.startsWith('<details>') && raw.endsWith('</summary>') && !raw.includes('<!--');
}

function rawHtmlIsKept(markdown: string): boolean {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown) as MdastRoot;
  let kept = true;
  visit(tree, 'html', (node) => {
    if (!keptRawHtml(node.value)) kept = false;
  });
  return kept;
}

function elementsAreKept(markdown: string): boolean {
  const tree = sanitisedTree(markdown);
  let kept = true;
  visit(tree, 'element', (node) => {
    if (!EDITOR_TAGS.has(node.tagName)) kept = false;
  });
  return kept;
}

export function editorCanShow(markdown: string): boolean {
  return rawHtmlIsKept(markdown) && elementsAreKept(markdown);
}
