import { InitReady, remarkPluginsCtx, remarkStringifyOptionsCtx } from '@milkdown/kit/core';
import type { Ctx, MilkdownPlugin } from '@milkdown/kit/ctx';
import { InputRule } from '@milkdown/kit/prose/inputrules';
import type { EditorState } from '@milkdown/kit/prose/state';
import { $inputRule, $node } from '@milkdown/kit/utils';
import type { Parent, PhrasingContent, Root, Text } from 'mdast';
import { visitParents } from 'unist-util-visit-parents';

const WIKI = /!?\[\[[^\][\n]+\]\]/g;
const WRITTEN = /(\\?)(!?)(\\?)\[(\\?)\[((?:\\.|[^\]\\\n])+)\]\]/g;
const CALLOUT = /^\[![A-Za-z]+\][+-]?/;
const TYPED = /(!?\[\[[^\][\n]+\]\])$/;
const KIND = 'wikiText';

type Kept = { readonly type: typeof KIND; readonly value: string };
type Source = { readonly value?: unknown };
type Written = { readonly live: boolean; readonly bangEscaped: boolean };

function kept(value: string): Kept {
  return { type: KIND, value };
}

function rawOf(node: Text, source: string): string {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return start === undefined || end === undefined ? '' : source.slice(start, end);
}

function writtenLinks(raw: string, count: number): readonly Written[] | null {
  const found = [...raw.matchAll(WRITTEN)].map((match) => {
    const [, lead = '', bang = '', first = '', second = ''] = match;
    const openEscaped = (lead !== '' && bang === '') || first !== '' || second !== '';
    return { live: !openEscaped, bangEscaped: lead !== '' && bang !== '' };
  });
  return found.length === count ? found : null;
}

function piecesFor(match: string, written: Written | undefined): readonly (Text | Kept)[] {
  if (written !== undefined && !written.live) return [{ type: 'text', value: match }];
  if (written?.bangEscaped === true && match.startsWith('!')) {
    return [{ type: 'text', value: '!' }, kept(match.slice(1))];
  }
  return [kept(match)];
}

function wikiPieces(value: string, raw: string): readonly (Text | Kept)[] {
  const matches = [...value.matchAll(WIKI)];
  const written = writtenLinks(raw, matches.length);
  const pieces: (Text | Kept)[] = [];
  let from = 0;
  for (const [index, match] of matches.entries()) {
    if (match.index > from) pieces.push({ type: 'text', value: value.slice(from, match.index) });
    pieces.push(...piecesFor(match[0], written?.at(index)));
    from = match.index + match[0].length;
  }
  if (from < value.length) pieces.push({ type: 'text', value: value.slice(from) });
  return merged(pieces);
}

function merged(pieces: readonly (Text | Kept)[]): (Text | Kept)[] {
  const out: (Text | Kept)[] = [];
  for (const piece of pieces) {
    const last = out.at(-1);
    if (last?.type === 'text' && piece.type === 'text') {
      out[out.length - 1] = { type: 'text', value: last.value + piece.value };
    } else out.push(piece);
  }
  return out;
}

function opensACallout(node: Text, ancestors: readonly Parent[]): boolean {
  const [quote, paragraph] = ancestors.slice(-2);
  return (
    quote?.type === 'blockquote' &&
    paragraph?.type === 'paragraph' &&
    quote.children[0] === paragraph &&
    paragraph.children[0] === node
  );
}

function piecesOf(node: Text, ancestors: readonly Parent[], source: string) {
  const raw = rawOf(node, source);
  const marker = opensACallout(node, ancestors) ? CALLOUT.exec(node.value) : null;
  if (marker === null || raw.startsWith('\\')) return wikiPieces(node.value, raw);
  const rest = node.value.slice(marker[0].length);
  return [kept(marker[0]), ...wikiPieces(rest, raw.slice(marker[0].length))];
}

function keepWikiText() {
  return (tree: Root, file: Source): void => {
    const source = typeof file.value === 'string' ? file.value : '';
    visitParents(tree, 'text', (node, ancestors) => {
      const parent = ancestors.at(-1);
      if (parent === undefined) return undefined;
      const pieces = piecesOf(node, ancestors, source);
      if (pieces.length === 1 && pieces[0]?.type === 'text') return undefined;
      const index = (parent.children as readonly unknown[]).indexOf(node);
      parent.children.splice(index, 1, ...(pieces as unknown as PhrasingContent[]));
      return index + pieces.length;
    });
  };
}

const remarkWikiTextFirst: MilkdownPlugin = (ctx) => async () => {
  await ctx.wait(InitReady);
  const entry = { plugin: keepWikiText, options: {} };
  ctx.update(remarkPluginsCtx, (plugins) => [entry, ...plugins]);
  return () => {
    ctx.update(remarkPluginsCtx, (plugins) => plugins.filter((plugin) => plugin !== entry));
  };
};

type Writer = {
  readonly stack: string[];
  safe(value: string, config: Record<string, unknown>): string;
};
type Siblings = { readonly children?: readonly { readonly type: string }[] };

function writeWikiText(node: Source, _parent: unknown, state: Writer): string {
  const raw = typeof node.value === 'string' ? node.value : '';
  return state.stack.includes('tableCell') ? raw.replace(/\|/g, '\\|') : raw;
}

function beforeWikiText(node: Source, parent: Siblings | undefined): boolean {
  const children = parent?.children ?? [];
  const index = children.indexOf(node as { readonly type: string });
  return children.at(index + 1)?.type === KIND;
}

function writeText(node: Source, parent: Siblings | undefined, state: Writer, info: object) {
  const value = typeof node.value === 'string' ? node.value : '';
  if (!beforeWikiText(node, parent) && /^[^*_\\]*\s+$/.test(value)) return value;
  return state.safe(value, { ...info, encode: [] });
}

export function writesWikiText(ctx: Ctx): void {
  ctx.update(remarkStringifyOptionsCtx, (options) => ({
    ...options,
    handlers: {
      ...options.handlers,
      ...({ [KIND]: writeWikiText, text: writeText } as unknown as typeof options.handlers),
    },
  }));
}

export const wikiTextNode = $node('wiki_text', () => ({
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  attrs: { raw: { default: '' } },
  parseDOM: [
    {
      tag: 'span[data-wiki-text]',
      getAttrs: (dom) => ({ raw: (dom as HTMLElement).textContent ?? '' }),
    },
  ],
  toDOM: (node) => ['span', { 'data-wiki-text': '' }, String(node.attrs['raw'])],
  parseMarkdown: {
    match: (node) => node.type === KIND,
    runner: (state, node, type) => {
      state.addNode(type, { raw: String(node['value']) });
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'wiki_text',
    runner: (state, node) => {
      state.addNode(KIND, undefined, String(node.attrs['raw']));
    },
  },
}));

function inCode(state: EditorState, start: number, end: number): boolean {
  let found = state.selection.$from.marks().some((mark) => mark.type.spec.code === true);
  state.doc.nodesBetween(start, end, (node) => {
    if (node.marks.some((mark) => mark.type.spec.code === true)) found = true;
  });
  return found;
}

const typedWikiLink = $inputRule(
  (ctx) =>
    new InputRule(TYPED, (state, match, start, end) => {
      if (inCode(state, start, end)) return null;
      const node = wikiTextNode.type(ctx).create({ raw: match[1] ?? '' });
      return state.tr.replaceWith(start, end, node);
    }),
);

export const wikiText: readonly MilkdownPlugin[] = [
  remarkWikiTextFirst,
  wikiTextNode,
  typedWikiLink,
].flat();
