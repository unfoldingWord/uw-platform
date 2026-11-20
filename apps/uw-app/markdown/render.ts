import type { Root } from 'hast';
import { toString } from 'hast-util-to-string';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema, type Options as Schema } from 'rehype-sanitize';
import rehypeSlug from 'rehype-slug';
import rehypeStringify from 'rehype-stringify';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';
import { calloutKinds, dialect, outsideLinks } from './dialect.ts';

export type Heading = { readonly depth: 2 | 3; readonly id: string; readonly text: string };
export type Rendered = { readonly html: string; readonly headings: readonly Heading[] };

const screenOwned = new Set(['id', 'className', 'name']);

type Attribute = NonNullable<NonNullable<Schema['attributes']>[string]>[number];

const withoutIdsAndClasses = (names: readonly Attribute[] = []): Attribute[] =>
  names.filter((name) => !screenOwned.has(String(typeof name === 'string' ? name : name[0])));

const schema: Schema = {
  ...defaultSchema,
  clobber: [],
  tagNames: [...(defaultSchema.tagNames ?? []), 'mark'],
  attributes: {
    ...defaultSchema.attributes,
    '*': withoutIdsAndClasses(defaultSchema.attributes?.['*']),
    a: withoutIdsAndClasses(defaultSchema.attributes?.['a']),
    code: [],
    h2: [],
    li: [],
    ol: [],
    section: [],
    ul: [],
    blockquote: [['dataCallout', ...calloutKinds]],
  },
  protocols: { ...defaultSchema.protocols, href: ['http', 'https', 'mailto'] },
};

const levels: Readonly<Record<string, 2 | 3>> = { h2: 2, h3: 3 };

function collectHeadings(into: Heading[]) {
  return () =>
    (tree: Root): void => {
      visit(tree, 'element', (node) => {
        const depth = levels[node.tagName];
        const id = node.properties['id'];
        if (depth === undefined || typeof id !== 'string') return;
        into.push({ depth, id, text: toString(node) });
      });
    };
}

export function renderMarkdown(source: string): Rendered {
  const headings: Heading[] = [];
  const file = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(dialect)
    .use(rehypeSanitize, schema)
    .use(outsideLinks)
    .use(rehypeSlug)
    .use(collectHeadings(headings))
    .use(rehypeStringify)
    .processSync(source);
  return { html: String(file), headings };
}
