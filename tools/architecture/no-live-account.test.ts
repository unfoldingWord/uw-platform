import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { repoFiles } from '../repo-files.ts';

const allowed = new Set(['TEST_DATABASE_URL', 'CI', 'PATH']);
const envRead = /process\.env(?:\[['"]([A-Z0-9_]+)['"]\]|\.([A-Z0-9_]+))/g;
const testCode = /(?:\.test\.ts$|^sim\/|^packages\/db\/test-[a-z-]+\.ts$|^apps\/[^/]+\/testing\/)/;
const platformAdapterFile = /^apps\/uw-app\/ports\/[^/]+\.ts$/;
const wiredWithoutService = /\/(clock|ids)\.ts$/;

function forbiddenEnvReads(path: string, source: string): string[] {
  return [...source.matchAll(envRead)]
    .map((match) => match[1] ?? match[2] ?? '')
    .filter((name) => !allowed.has(name))
    .map((name) => `${path} reads ${name}`);
}

function waitingSection(): string {
  const tracker = readFileSync('docs/progress_tracker.md', 'utf8');
  const start = tracker.indexOf('## Waiting on a person');
  if (start === -1) throw new Error('the tracker has no "Waiting on a person" section');
  return tracker.slice(start);
}

function platformAdapters(): string[] {
  return repoFiles().filter((path) => platformAdapterFile.test(path) && !path.endsWith('.test.ts'));
}

function unlisted(paths: readonly string[]): string[] {
  const waiting = waitingSection();
  return paths.filter((path) => !waiting.includes(path));
}

describe('DX-8 no test, helper or scenario needs a live account or a secret', () => {
  it('reads no environment variable but TEST_DATABASE_URL, CI and PATH', () => {
    const found = repoFiles()
      .filter((path) => testCode.test(path) && path.endsWith('.ts'))
      .flatMap((path) => forbiddenEnvReads(path, readFileSync(path, 'utf8')));
    expect(found).toEqual([]);
  });

  it('fails on a planted read of a secret', () => {
    const planted = 'const key = ' + 'process' + ".env['NEON_API_KEY'];";
    expect(forbiddenEnvReads('x.test.ts', planted)).toEqual(['x.test.ts reads NEON_API_KEY']);
  });

  it('fails on a planted read through a property', () => {
    const planted = 'const key = ' + 'process' + '.env.GITHUB_TOKEN;';
    expect(forbiddenEnvReads('x.test.ts', planted)).toEqual(['x.test.ts reads GITHUB_TOKEN']);
  });

  it('allows the three variables the tests may read', () => {
    const planted =
      'process' +
      '.env.CI; ' +
      'process' +
      ".env['TEST_DATABASE_URL']; " +
      'process' +
      '.env.PATH;';
    expect(forbiddenEnvReads('x.test.ts', planted)).toEqual([]);
  });
});

describe('DX-8 every platform adapter is accounted for in the tracker', () => {
  it('lists each wired adapter that reaches a live service under Waiting on a person', () => {
    const live = platformAdapters().filter(
      (path) => !path.endsWith('.not-wired.ts') && !wiredWithoutService.test(path),
    );
    expect(live.length).toBeGreaterThan(0);
    expect(unlisted(live)).toEqual([]);
  });

  it('lists each not-wired adapter under Waiting on a person', () => {
    const notWired = platformAdapters().filter((path) => path.endsWith('.not-wired.ts'));
    expect(notWired.length).toBeGreaterThan(0);
    expect(unlisted(notWired)).toEqual([]);
  });
});
