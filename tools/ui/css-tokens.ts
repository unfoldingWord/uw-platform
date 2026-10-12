import { readFileSync } from 'node:fs';

export type CssBlock = {
  readonly context: string;
  readonly declarations: Map<string, string>;
};

type ParseState = {
  readonly blocks: CssBlock[];
  readonly open: CssBlock[];
  buffer: string;
};

function addDeclaration(state: ParseState): void {
  const text = state.buffer.trim();
  state.buffer = '';
  const block = state.open.at(-1);
  const colon = text.indexOf(':');
  if (block === undefined || colon <= 0) return;
  block.declarations.set(text.slice(0, colon).trim(), text.slice(colon + 1).trim());
}

function openBlock(state: ParseState): void {
  const prelude = state.buffer.trim().replace(/\s+/g, ' ');
  state.buffer = '';
  const parent = state.open.at(-1);
  const context = parent === undefined ? prelude : `${parent.context} ${prelude}`;
  const block = { context, declarations: new Map<string, string>() };
  state.blocks.push(block);
  state.open.push(block);
}

function closeBlock(state: ParseState): void {
  addDeclaration(state);
  state.open.pop();
}

export function cssBlocks(css: string): CssBlock[] {
  const state: ParseState = { blocks: [], open: [], buffer: '' };
  for (const character of css) {
    if (character === '{') openBlock(state);
    else if (character === '}') closeBlock(state);
    else if (character === ';') addDeclaration(state);
    else state.buffer += character;
  }
  return state.blocks;
}

export function blockAt(blocks: readonly CssBlock[], context: string): Map<string, string> {
  const block = blocks.find((candidate) => candidate.context === context);
  if (block === undefined) throw new Error(`no CSS block ${context}`);
  return block.declarations;
}

const varReference = /^var\(\s*(--[\w-]+)\s*\)$/;

export function referencedToken(value: string): string | undefined {
  return varReference.exec(value)?.[1];
}

export function resolveToken(name: string, tokens: ReadonlyMap<string, string>): string {
  const seen = new Set<string>();
  let current = name;
  for (;;) {
    const value = tokens.get(current);
    if (value === undefined || seen.has(current)) throw new Error(`unresolved token ${name}`);
    seen.add(current);
    const next = referencedToken(value);
    if (next === undefined) return value;
    current = next;
  }
}

const tokenDirectory = new URL('../../packages/ui/tokens/', import.meta.url);

export function tokenFile(name: string): CssBlock[] {
  return cssBlocks(readFileSync(new URL(`${name}.css`, tokenDirectory), 'utf8'));
}

export const themeContexts = {
  light: ':root',
  systemDark: "@media (prefers-color-scheme: dark) :root:not([data-theme='light'])",
  forcedDark: ":root[data-theme='dark']",
} as const;

export type ThemeName = 'light' | 'dark';

export function themeTokens(theme: ThemeName): Map<string, string> {
  const blocks = tokenFile('theme');
  const dark =
    theme === 'dark' ? blockAt(blocks, themeContexts.forcedDark) : new Map<string, string>();
  return new Map([
    ...blockAt(tokenFile('brand'), ':root'),
    ...blockAt(blocks, themeContexts.light),
    ...dark,
  ]);
}
