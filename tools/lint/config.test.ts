import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint({ cwd: process.cwd() });

async function ruleIds(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((message) => message.ruleId ?? 'parse-error');
}

const longFunction = `export function long(): number {\n${'  const step = 1;\n'.repeat(58)}  return step;\n}\n`;

describe('the ESLint config', () => {
  it('fails a function of 60 lines', async () => {
    expect(await ruleIds('packages/core/long.ts', longFunction)).toContain(
      'max-lines-per-function',
    );
  });

  it.each([
    ['max-statements', `export function f(): void {\n${'  void 1;\n'.repeat(26)}}\n`],
    [
      'complexity',
      `export function f(a: number): number {\n${'  if (a === 1) { return 1; }\n'.repeat(10)}  return 0;\n}\n`,
    ],
    [
      'max-depth',
      'export function f(a: number): void { if (a) { if (a) { if (a) { if (a) { if (a) { void a; } } } } } }\n',
    ],
    [
      'max-nested-callbacks',
      'export const f = (): void => { [1].map(() => [1].map(() => [1].map(() => [1].map(() => 1)))); };\n',
    ],
    [
      'max-params',
      'export function f(a: number, b: number, c: number, d: number, e: number, g: number): number { return a + b + c + d + e + g; }\n',
    ],
  ])('enforces %s', async (rule, code) => {
    expect(await ruleIds('packages/core/f.ts', code)).toContain(rule);
  });
});

describe('the ESLint config gates', () => {
  it('fails a comment under apps, packages, sim and tests', async () => {
    for (const path of ['apps/uw-app/a.ts', 'packages/core/a.ts', 'sim/a.ts', 'tests/a.ts']) {
      expect(await ruleIds(path, '// note\nexport const a = 1;\n')).toContain('uw/no-comments');
    }
  });

  it('fails a directive comment and a ts-ignore', async () => {
    const ids = await ruleIds('packages/core/a.ts', '// @ts-ignore\nexport const a: number = 1;\n');
    expect(ids).toContain('uw/no-comments');
  });

  it('fails a vendor SDK import outside an engine directory and allows it inside one', async () => {
    const code = "import OpenAI from 'openai';\nexport const client = OpenAI;\n";
    expect(await ruleIds('apps/uw-app/a.ts', code)).toContain('no-restricted-imports');
    expect(await ruleIds('apps/uw-app/engines/openrouter-messages/a.ts', code)).not.toContain(
      'no-restricted-imports',
    );
  });

  it('keeps packages/harness free of Workers, Drizzle, the network and their globals', async () => {
    expect(
      await ruleIds(
        'packages/harness/a.ts',
        "import { Hono } from 'hono';\nexport const a = Hono;\n",
      ),
    ).toContain('no-restricted-imports');
    expect(await ruleIds('packages/harness/a.ts', "import 'node:https';\n")).toContain(
      'no-restricted-imports',
    );
    expect(await ruleIds('packages/harness/a.ts', "export const a = fetch('x');\n")).toContain(
      'no-restricted-globals',
    );
  });

  it('bans any', async () => {
    expect(await ruleIds('packages/core/a.ts', 'export const a: any = 1;\n')).toContain(
      '@typescript-eslint/no-explicit-any',
    );
  });

  it('enables eslint-plugin-security', async () => {
    expect(
      await ruleIds('packages/core/a.ts', 'export const a = (s: string) => eval(s);\n'),
    ).toContain('security/detect-eval-with-expression');
  });
});
