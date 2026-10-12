import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { repoFiles } from '../repo-files.ts';

const allowed = ['TEST_DATABASE_URL', 'CI', 'PATH'];
const allowedRead =
  /^(?:\.(?:TEST_DATABASE_URL|CI|PATH)\b|\[['"](?:TEST_DATABASE_URL|CI|PATH)['"]\])/;
const envAccess = /process\.env/g;
const viteEnv = /import\.meta\.env/;
const testCode =
  /(?:\.test\.(?:ts|tsx|mts)$|^packages\/harness\/port-contracts\/|^sim\/|^tools\/|^packages\/db\/test-[a-z-]+\.ts$|^apps\/[^/]+\/testing\/|^vitest\.config\.ts$)/;
const codeFile = /\.(?:ts|tsx|mts)$/;
const platformAdapterFile = /^apps\/uw-app\/ports\/[^/]+\.ts$/;
const wiredWithoutService = /\/(clock|ids)\.ts$/;
const testRunningJobs = ['lint', 'typecheck', 'architecture', 'test', 'build'];

function forbiddenEnvReads(path: string, source: string): string[] {
  const reads = [...source.matchAll(envAccess)]
    .filter((match) => !allowedRead.test(source.slice(match.index + match[0].length)))
    .map(() => `${path} reads the environment beyond ${allowed.join(', ')}`);
  return viteEnv.test(source) ? [...reads, `${path} reads import meta env`] : reads;
}

function jobsReferencingSecrets(workflow: string, jobs: readonly string[]): string[] {
  const sections = workflow.split(/^ {2}(?=[a-z][a-z-]*:$)/m);
  return sections
    .filter((section) => jobs.includes(section.split(':')[0] ?? ''))
    .filter((section) => section.includes('secrets' + '.'))
    .map((section) => `${section.split(':')[0]} references a secret`);
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
  return paths.filter((path) => !waiting.includes(`\`${path}\``));
}

describe('DX-8 no test, helper or scenario needs a live account or a secret', () => {
  it('reads no environment variable but TEST_DATABASE_URL, CI and PATH', () => {
    const found = repoFiles()
      .filter((path) => testCode.test(path) && codeFile.test(path))
      .flatMap((path) => forbiddenEnvReads(path, readFileSync(path, 'utf8')));
    expect(found).toEqual([]);
  });

  it.each([
    ['a named read', 'const key = ' + 'process' + ".env['NEON_API_KEY'];"],
    ['a property read', 'const key = ' + 'process' + '.env.GITHUB_TOKEN;'],
    ['a destructure', 'const { TOKEN } = ' + 'process' + '.env;'],
    ['an alias', 'const e = ' + 'process' + '.env;'],
    ['a dynamic key', 'const k = ' + 'process' + '.env[name];'],
    ['a spread', 'const all = { ...' + 'process' + '.env };'],
    ['a prefix of an allowed name', 'const k = ' + 'process' + '.env.CI_TOKEN;'],
    ['a Vite env read', 'const k = ' + 'import' + '.meta.env.VITE_KEY;'],
  ])('fails on a planted %s', (_name, planted) => {
    expect(forbiddenEnvReads('x.test.ts', planted)).toHaveLength(1);
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

  it('scans the helpers, contracts, sim and config a test runs through', () => {
    const scanned = repoFiles().filter((path) => testCode.test(path) && codeFile.test(path));
    expect(scanned).toContain('vitest.config.ts');
    expect(scanned.some((path) => path.startsWith('packages/harness/port-contracts/'))).toBe(true);
    expect(scanned.some((path) => /^tools\/[^/]+\.ts$/.test(path))).toBe(true);
    expect(scanned.some((path) => path.startsWith('sim/'))).toBe(true);
  });
});

describe('DX-8 no job that runs the tests references a secret', () => {
  it('has none in the lint, typecheck, architecture, test and build jobs of ci.yml', () => {
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
    expect(jobsReferencingSecrets(workflow, testRunningJobs)).toEqual([]);
  });

  it('finds a planted secret reference in a test job only', () => {
    const planted = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - run: x',
      '        env:',
      '          K: ${{ secrets' + '.K }}',
      '  deploy:',
      '    steps:',
      '      - run: y ${{ secrets' + '.K }}',
    ].join('\n');
    expect(jobsReferencingSecrets(planted, testRunningJobs)).toEqual(['test references a secret']);
  });

  it('finds every test-running job in the real workflow', () => {
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
    for (const job of testRunningJobs) expect(workflow.split('\n')).toContain(`  ${job}:`);
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
