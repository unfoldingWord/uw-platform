import type { Code, Root } from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';
import { parse, stringify } from 'yaml';
import type { z } from 'zod';
import { panelSchema, type AuthoringProblem, type Panel } from '@uw/contracts';

export type PanelBlock =
  | { readonly index: number; readonly panel: Panel }
  | { readonly index: number; readonly problems: readonly AuthoringProblem[] };

const PANEL_LANGUAGE = 'panel';
const FENCE = '```';

function panelBlock(panel: Panel): string {
  return `${FENCE}${PANEL_LANGUAGE}\n${stringify(panel)}${FENCE}\n`;
}

export function dashboardBody(intro: string, panels: readonly Panel[]): string {
  const blocks = panels.map(panelBlock).join('\n');
  const lead = intro.trim();
  return lead === '' ? blocks : `${lead}\n\n${blocks}`;
}

function fences(bodyMd: string): readonly string[] {
  const tree: Root = unified().use(remarkParse).use(remarkGfm).parse(bodyMd);
  const found: string[] = [];
  visit(tree, 'code', (node: Code) => {
    if (node.lang === PANEL_LANGUAGE) found.push(node.value);
  });
  return found;
}

function yamlOf(text: string): { readonly value: unknown } | null {
  try {
    return { value: parse(text, { uniqueKeys: true }) as unknown };
  } catch {
    return null;
  }
}

function problemsOf(error: z.ZodError, prefix: readonly (string | number)[]): AuthoringProblem[] {
  return error.issues.map((issue) => ({
    path: [...prefix, ...issue.path.map(String)].join('.'),
    message: issue.message.slice(0, 500),
  }));
}

function blockOf(text: string, index: number): PanelBlock {
  const read = yamlOf(text);
  if (read === null) {
    return { index, problems: [{ path: `panels.${index}`, message: 'the block is not YAML' }] };
  }
  const checked = panelSchema.safeParse(read.value);
  if (checked.success) return { index, panel: checked.data };
  return { index, problems: problemsOf(checked.error, ['panels', index]) };
}

export function panelBlocks(bodyMd: string): readonly PanelBlock[] {
  return fences(bodyMd).map(blockOf);
}
