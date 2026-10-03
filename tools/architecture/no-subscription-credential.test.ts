import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { repoFiles } from '../repo-files.ts';

const subscriptionNames: readonly string[] = [
  'CLAUDE_CODE_OAUTH_TOKEN',
  'ANTHROPIC_AUTH_TOKEN',
  'OAUTH',
  'setup-token',
  'CODEX_API_KEY',
  'CODEX_HOME',
  'CHATGPT',
  'OPENAI_ACCESS_TOKEN',
];

const configurationFiles: readonly string[] = [
  'apps/uw-app/env.ts',
  'infra/uw-app/wrangler.toml',
  'infra/uw-app/wrangler.go-live.toml',
];

function scanned(path: string): boolean {
  if (configurationFiles.includes(path)) return true;
  return path.startsWith('apps/uw-app/engines/') && !path.endsWith('.test.ts');
}

function namedIn(path: string, source: string): string[] {
  const upper = source.toUpperCase();
  return subscriptionNames
    .filter((name) => upper.includes(name.toUpperCase()))
    .map((name) => `${path}: ${name}`);
}

describe('no subscription credential on the platform', () => {
  it("HE-3 no hosted engine's configuration names a subscription credential", () => {
    const paths = repoFiles().filter(scanned);
    expect(paths).toEqual(expect.arrayContaining([...configurationFiles]));
    expect(paths.some((path) => path.startsWith('apps/uw-app/engines/'))).toBe(true);
    const found = paths.flatMap((path) => namedIn(path, readFileSync(path, 'utf8')));
    expect(found).toEqual([]);
  });

  it.each([
    ['a Claude Code login token', 'CLAUDE_CODE_OAUTH_TOKEN?: string;'],
    ['a ChatGPT sign-in', 'CHATGPT_SESSION = "x"'],
    ['a Codex home', 'env.CODEX_HOME'],
    ['a setup token command', 'claude setup-token'],
  ])('refuses a planted %s', (_name, source) => {
    expect(namedIn('apps/uw-app/engines/planted.ts', source).length).toBeGreaterThan(0);
    expect(scanned('apps/uw-app/engines/planted.ts')).toBe(true);
  });
});
