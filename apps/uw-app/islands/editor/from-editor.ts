import type { Element, ElementContent, Root as HastRoot } from 'hast';
import type { State } from 'hast-util-to-mdast';
import { toString } from 'hast-util-to-string';
import type { BlockContent, PhrasingContent, Root as MdastRoot, RootContent } from 'mdast';
import rehypeParse from 'rehype-parse';
import rehypeRemark from 'rehype-remark';
import remarkGfm from 'remark-gfm';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';
import { SKIP, visit } from 'unist-util-visit';

const WIKI = /!?\[\[[^\][\n]+\]\]/g;

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

function taskItem(item: Element): void {
  const checked = item.properties['dataChecked'] === 'true';
  const box = element('input', { type: 'checkbox', checked, disabled: true }, []);
  const [first, ...rest] = item.children.filter((child) => !isTag(child, 'label'));
  const inner = tagged(first, 'div')?.children ?? (first === undefined ? [] : [first]);
  const [lead, ...more] = inner;
  const paragraph = tagged(lead, 'p');
  const space: ElementContent = { type: 'text', value: ' ' };
  item.properties = {};
  item.children =
    paragraph === null
      ? [box, space, ...inner, ...rest]
      : [{ ...paragraph, children: [box, space, ...paragraph.children] }, ...more, ...rest];
}

function unwrapped(node: Element, wrapper: (child: ElementContent) => boolean): ElementContent[] {
  return node.children.flatMap((child) =>
    child.type === 'element' && wrapper(child) ? child.children : [child],
  );
}

function isDetailsContent(child: ElementContent): boolean {
  return tagged(child, 'div')?.properties['dataType'] === 'detailsContent';
}

function cellText(cell: Element): void {
  const paragraphs = cell.children.flatMap((child) => tagged(child, 'p') ?? []);
  if (paragraphs.length === 0) return;
  cell.children = paragraphs.flatMap((paragraph, index) =>
    index === 0 ? paragraph.children : [element('br', {}, []), ...paragraph.children],
  );
}

function fromEditor() {
  return (tree: HastRoot): void => {
    visit(tree, 'element', (node, index, parent) => {
      if (node.properties['dataType'] === 'taskItem') taskItem(node);
      if (node.tagName === 'details') node.children = unwrapped(node, isDetailsContent);
      if (node.tagName === 'td' || node.tagName === 'th') cellText(node);
      const embed = node.properties['dataPageEmbed'];
      if (typeof embed !== 'string' || parent === undefined || index === undefined) return;
      const title = node.properties['dataTitle'];
      const image = element('img', { src: embed, alt: typeof title === 'string' ? title : '' }, []);
      parent.children.splice(index, 1, element('p', {}, [image]));
      return [SKIP, index + 1];
    });
  };
}

function raw(value: string): { type: 'html'; value: string } {
  return { type: 'html', value };
}

function calloutOf(state: State, node: Element): BlockContent {
  const children = state.toFlow(state.all(node)) as BlockContent[];
  const kind = node.properties['dataCallout'];
  const [first, ...rest] = children;
  if (typeof kind !== 'string' || first?.type !== 'paragraph') {
    return { type: 'blockquote', children };
  }
  const marked = [raw(`[!${kind.toUpperCase()}]`), { type: 'text' as const, value: '\n' }];
  const lead = { ...first, children: [...marked, ...first.children] };
  return { type: 'blockquote', children: [lead, ...rest] };
}

function detailsOf(state: State, node: Element): RootContent[] {
  const summary = node.children.find((child) => isTag(child, 'summary'));
  const body = node.children.filter((child) => child !== summary);
  const title = summary === undefined ? '' : toString(summary).trim();
  const inner = state.toFlow(state.all({ ...node, children: body })) as BlockContent[];
  return [raw(`<details>\n<summary>${title}</summary>`), ...inner, raw('</details>')];
}

function highlightOf(state: State, node: Element): PhrasingContent[] {
  const inner = state.all(node) as PhrasingContent[];
  return [raw('=='), ...inner, raw('==')];
}

function keepWikiSyntax() {
  return (tree: MdastRoot): void => {
    visit(tree, 'text', (node, index, parent) => {
      if (parent === undefined || index === undefined || !node.value.includes('[[')) return;
      const parts: PhrasingContent[] = [];
      let from = 0;
      for (const match of node.value.matchAll(WIKI)) {
        if (match.index > from)
          parts.push({ type: 'text', value: node.value.slice(from, match.index) });
        parts.push(raw(match[0]));
        from = match.index + match[0].length;
      }
      if (from === 0) return;
      if (from < node.value.length) parts.push({ type: 'text', value: node.value.slice(from) });
      parent.children.splice(index, 1, ...parts);
      return [SKIP, index + parts.length];
    });
  };
}

function breaksInCells() {
  return (tree: MdastRoot): void => {
    visit(tree, 'tableCell', (cell) => {
      cell.children = cell.children.map((child) => (child.type === 'break' ? raw('<br>') : child));
    });
  };
}

function tightLists() {
  return (tree: MdastRoot): void => {
    visit(tree, 'list', (list) => {
      for (const item of list.children) {
        item.spread = item.children.filter((child) => child.type === 'paragraph').length > 1;
      }
      list.spread = list.children.some((item) => item.spread === true);
    });
  };
}

const delimiterCell = new Set(['-', ':-', '-:', ':-:']);

function isDelimiterRow(line: string): boolean {
  if (!line.startsWith('| ') || !line.endsWith(' |')) return false;
  return line
    .slice(2, -2)
    .split(' | ')
    .every((cell) => delimiterCell.has(cell));
}

function widerDelimiters(markdown: string): string {
  return markdown
    .split('\n')
    .map((line) => (isDelimiterRow(line) ? line.replaceAll('-', '---') : line))
    .join('\n');
}

export function markdownFromEditor(html: string): string {
  const file = unified()
    .use(rehypeParse, { fragment: true })
    .use(fromEditor)
    .use(rehypeRemark, {
      handlers: { blockquote: calloutOf, details: detailsOf, mark: highlightOf },
    })
    .use(keepWikiSyntax)
    .use(breaksInCells)
    .use(tightLists)
    .use(remarkGfm, { tablePipeAlign: false })
    .use(remarkStringify, {
      bullet: '-',
      emphasis: '*',
      strong: '*',
      fences: true,
      rule: '-',
      listItemIndent: 'one',
    })
    .processSync(html);
  return widerDelimiters(String(file)).trimEnd();
}
