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
import { visitParents } from 'unist-util-visit-parents';
import { calloutKinds, dialect, outsideLinks } from './dialect.ts';
import { fileVideos } from './file-video.ts';
import { pageEmbeds, pageLinks, type RenderHooks } from './page-refs.ts';
import { panelEmbeds } from './panel-embeds.ts';
import { viewEmbeds } from './view-embeds.ts';

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
    code: [['className', /^language-./]],
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

function insideEmbed(ancestors: readonly { readonly type: string }[]): boolean {
  return ancestors.some(
    (node) => node.type === 'element' && 'properties' in node && hasEmbed(node.properties),
  );
}

function hasEmbed(properties: unknown): boolean {
  return typeof properties === 'object' && properties !== null && 'dataEmbed' in properties;
}

function collectHeadings(into: Heading[]) {
  return () =>
    (tree: Root): void => {
      visitParents(tree, 'element', (node, ancestors) => {
        const depth = levels[node.tagName];
        const id = node.properties['id'];
        if (depth === undefined || typeof id !== 'string' || insideEmbed(ancestors)) return;
        into.push({ depth, id, text: toString(node) });
      });
    };
}

const noHooks: RenderHooks = {
  linkTitle: () => null,
  wiki: () => null,
  embed: () => ({ kind: 'missing' }),
  fileKind: () => null,
};

function sanitised(source: string, hooks: RenderHooks, depth: number): Root {
  const pipeline = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(dialect)
    .use(rehypeSanitize, schema)
    .use(outsideLinks)
    .use(pageLinks(hooks))
    .use(viewEmbeds())
    .use(panelEmbeds())
    .use(fileVideos(hooks.fileKind))
    .use(pageEmbeds({ hooks, nested: (inner, level) => sanitised(inner, hooks, level), depth }));
  return pipeline.runSync(pipeline.parse(source));
}

export function renderMarkdown(source: string, hooks: RenderHooks = noHooks): Rendered {
  const headings: Heading[] = [];
  const finish = unified().use(rehypeSlug).use(collectHeadings(headings)).use(rehypeStringify);
  const tree = sanitised(source, hooks, 0);
  finish.runSync(tree);
  return { html: finish.stringify(tree), headings };
}
