import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { repoFiles } from '../repo-files.ts';

const properNouns: ReadonlySet<string> = new Set([
  'GitHub',
  'Zulip',
  'unfoldingWord',
  'Access',
  'Cloudflare',
]);
const emoji = /\p{Extended_Pictographic}/u;
const scannedFiles = [
  /^apps\/uw-app\/views\/.+\.tsx?$/,
  /^apps\/uw-app\/auth\/[^/]+\.tsx?$/,
  /^apps\/uw-app\/health\/[^/]+\.tsx?$/,
  /^packages\/ui\/components\/[^/]+\.tsx?$/,
];
const scriptSources: ReadonlySet<string> = new Set(['packages/ui/components/inline-scripts.ts']);

function scanned(path: string): boolean {
  if (scriptSources.has(path) || /\.test\.tsx?$/.test(path)) return false;
  return scannedFiles.some((pattern) => pattern.test(path));
}

function isModuleSpecifier(node: ts.Node): boolean {
  const parent = node.parent;
  return ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent);
}

function copyOf(node: ts.Node): string | null {
  if (ts.isJsxText(node)) return node.text.trim() === '' ? null : node.text;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return isModuleSpecifier(node) ? null : node.text;
  }
  if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
    return node.text;
  }
  return null;
}

const markup = /^<!DOCTYPE html>/;

function copyIn(path: string, source: string): readonly string[] {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    const copy = copyOf(node);
    if (copy !== null && !markup.test(copy)) found.push(copy);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

function titleCase(text: string): boolean {
  const words = text.split(/[\s,.:;()]+/).filter((word) => /^[A-Za-z]/.test(word));
  const lower = words.filter((word) => /^[a-z]/.test(word) && !properNouns.has(word));
  const titled = words.filter((word) => /^[A-Z][a-z]/.test(word) && !properNouns.has(word));
  return lower.length === 0 && titled.length >= 2;
}

function problemsIn(text: string): readonly string[] {
  const problems: string[] = [];
  if (text.includes('!')) problems.push('an exclamation mark');
  if (emoji.test(text)) problems.push('an emoji');
  for (const match of text.matchAll(/unfolding\s*word/gi)) {
    if (match[0] !== 'unfoldingWord') problems.push(`unfoldingWord written ${match[0]}`);
  }
  if (titleCase(text)) problems.push('Title Case');
  for (const match of text.matchAll(/\b(?:I|[Ww]e|[Oo]urs?|[Uu]s|[Mm]y|[Mm]e|the user)\b/g)) {
    problems.push(`first or third person: ${match[0]}`);
  }
  return problems;
}

function copyProblems(path: string, source: string): readonly string[] {
  return copyIn(path, source).flatMap((text) =>
    problemsIn(text).map((problem) => `${path}: ${problem}: ${text.trim()}`),
  );
}

const planted: readonly (readonly [string, string])[] = [
  ['Approve now!', 'an exclamation mark'],
  ['Gates 🎉', 'an emoji'],
  ['Unfoldingword admins', 'unfoldingWord written Unfoldingword'],
  ['UnfoldingWord admins', 'unfoldingWord written UnfoldingWord'],
  ['Waiting On You', 'Title Case'],
  ['We sent the gate', 'first or third person: We'],
  ['Your gate is in our queue', 'first or third person: our'],
  ['Tell the user it lapsed', 'first or third person: the user'],
];

describe('the screen copy', () => {
  it('WB-12 screen copy is sentence case with no exclamation marks, no emoji and no first person or "the user", and unfoldingWord is camelCase', () => {
    const files = repoFiles().filter(scanned);
    expect(files.length).toBeGreaterThan(20);
    const problems = files.flatMap((path) => copyProblems(path, readFileSync(path, 'utf8')));
    expect(problems).toEqual([]);
  });

  it.each(planted)('flags planted copy %s', (text, problem) => {
    const source = `export const Planted = () => <h1>${text}</h1>;`;
    expect(copyProblems('apps/uw-app/views/screens/planted.tsx', source)).toEqual([
      `apps/uw-app/views/screens/planted.tsx: ${problem}: ${text}`,
    ]);
  });

  it('reads the copy in the .ts parts beside the screens, and never a test file or an inline script', () => {
    const parts = [
      'apps/uw-app/views/parts/health-words.ts',
      'apps/uw-app/views/parts/play-evidence.ts',
      'apps/uw-app/views/parts/costs.ts',
      'packages/ui/components/text.ts',
    ];
    expect(parts.filter(scanned)).toEqual(parts);
    const skipped = [
      'packages/ui/components/text.test.ts',
      'packages/ui/components/inline-scripts.ts',
    ];
    expect(skipped.filter(scanned)).toEqual([]);
  });

  it('lets a heading of proper nouns stand, and reads string literals as well as JSX text', () => {
    const source =
      "export const label = 'Cloudflare Access';\nexport const P = () => <p>GitHub Zulip</p>;";
    expect(copyProblems('apps/uw-app/views/screens/planted.tsx', source)).toEqual([]);
    const quoted = "export const lede = 'Waiting On You';";
    expect(copyProblems('apps/uw-app/views/screens/planted.tsx', quoted)).toHaveLength(1);
  });
});
