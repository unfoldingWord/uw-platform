import { cruise } from 'dependency-cruiser';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import config from '../../.dependency-cruiser.mjs';
import { architectureRoots } from './roots.ts';

const roots: string[] = [];
const leaf = 'export const value = 1;';
const store = 'node_modules/.pnpm/@octokit+core@7.0.8/node_modules/@octokit/core';
const githubFiles = [
  'client',
  'transport',
  'app-config',
  'session',
  'token',
  'ship-writes',
  'comments',
];

function write(root: string, path: string, source: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), source);
}

function pnpmTree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'uw-github-rules-'));
  roots.push(root);
  for (const directory of architectureRoots) mkdirSync(join(root, directory), { recursive: true });
  write(root, `${store}/index.js`, 'export default 1;');
  write(root, `${store}/package.json`, JSON.stringify({ name: '@octokit/core', main: 'index.js' }));
  mkdirSync(join(root, 'apps/uw-app/node_modules/@octokit'), { recursive: true });
  symlinkSync(join(root, store), join(root, 'apps/uw-app/node_modules/@octokit/core'), 'dir');
  for (const name of githubFiles) write(root, `apps/uw-app/github/${name}.ts`, leaf);
  for (const name of ['@octokit/rest', '@octokit/webhooks-methods']) {
    write(root, `node_modules/${name}/index.js`, 'export default 1;');
    write(root, `node_modules/${name}/package.json`, JSON.stringify({ name, main: 'index.js' }));
  }
  for (const [path, source] of Object.entries(files)) write(root, path, source);
  return root;
}

type Violation = { readonly rule: string; readonly to: string };

async function violations(files: Record<string, string>): Promise<Violation[]> {
  const root = pnpmTree(files);
  const result = await cruise(
    architectureRoots,
    { ...config.options, baseDir: root, validate: true, ruleSet: config },
    undefined,
  );
  if (typeof result.output === 'string') throw new Error('expected structured output');
  return result.output.summary.violations.map((violation) => ({
    rule: violation.rule.name,
    to: violation.to,
  }));
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const refusals: [string, string, string, string][] = [
  [
    'a route reaching the read client',
    'apps/uw-app/http/a.ts',
    "import '../github/client.ts';",
    'github-reads-only-in-github-and-composition-roots',
  ],
  [
    'a port adapter reaching the read client',
    'apps/uw-app/ports/connectors.ts',
    "import '../github/client.ts';",
    'github-reads-only-in-github-and-composition-roots',
  ],
  [
    'any other Octokit package outside the session',
    'apps/uw-app/x.ts',
    "import '@octokit/rest';",
    'github-token-and-octokit-only-in-the-session',
  ],
  [
    'the webhook signature package outside uw-ingest',
    'apps/uw-app/x.ts',
    "import '@octokit/webhooks-methods';",
    'octokit-webhooks-methods-only-in-ingest',
  ],
  [
    'a route opening a session',
    'apps/uw-app/http/a.ts',
    "import '../github/session.ts';",
    'github-session-only-in-the-github-clients',
  ],
  [
    'the read client minting a token itself',
    'apps/uw-app/github/client.ts',
    "import './token.ts';",
    'github-token-and-octokit-only-in-the-session',
  ],
  [
    'the kernel root reaching Octokit',
    'apps/uw-app/kernel.ts',
    "import '@octokit/core';",
    'github-token-and-octokit-only-in-the-session',
  ],
  [
    'the queue root taking the merge and tag writes',
    'apps/uw-app/queue/worker.ts',
    "import '../github/ship-writes.ts';",
    'github-merge-writes-only-in-merge',
  ],
  [
    'the cron root taking the merge and tag writes',
    'apps/uw-app/cron/scheduled.ts',
    "import '../github/ship-writes.ts';",
    'github-merge-writes-only-in-merge',
  ],
  [
    'another GitHub module taking the merge and tag writes',
    'apps/uw-app/github/import.ts',
    "import './ship-writes.ts';",
    'github-merge-writes-only-in-merge',
  ],
  [
    'the queue root taking the comment writer',
    'apps/uw-app/queue/worker.ts',
    "import '../github/comments.ts';",
    'github-comments-only-in-github',
  ],
  [
    'an MCP test reaching the transport',
    'apps/uw-app/mcp/a.test.ts',
    "import '../github/transport.ts';",
    'github-never-in-mcp-or-engines',
  ],
  [
    'an engine reaching the read client',
    'apps/uw-app/engines/e/a.ts',
    "import '../../github/client.ts';",
    'github-never-in-mcp-or-engines',
  ],
];

describe('the GitHub dependency rules refuse', () => {
  it.each(refusals)('%s', async (_name, path, source, rule) => {
    const found = await violations({ [path]: source });
    expect(found.map((violation) => violation.rule)).toContain(rule);
  });

  it('Octokit outside the session where pnpm resolves it into its store', async () => {
    const found = await violations({ 'apps/uw-app/x.ts': "import '@octokit/core';" });
    expect(found).toEqual([
      { rule: 'github-token-and-octokit-only-in-the-session', to: `${store}/index.js` },
    ]);
  });
});

describe('the app test helpers', () => {
  it('refuse a module that is not a test', async () => {
    const found = await violations({
      'apps/uw-app/testing/github-facts.ts': leaf,
      'apps/uw-app/http/a.ts': "import '../testing/github-facts.ts';",
    });
    expect(found.map((violation) => violation.rule)).toContain('app-testing-only-in-tests');
  });

  it('allow a test file and another test helper', async () => {
    const found = await violations({
      'apps/uw-app/github/testing/facts-fixtures.ts': leaf,
      'apps/uw-app/testing/github-facts.ts': "import '../github/testing/facts-fixtures.ts';",
      'apps/uw-app/mcp/a.test.ts': "import '../testing/github-facts.ts';",
    });
    expect(found.map((violation) => violation.rule)).not.toContain('app-testing-only-in-tests');
  });
});

describe('the GitHub dependency rules allow', () => {
  it('the composition roots on the read client, its transport and the App configuration', async () => {
    const reads =
      "import '../github/client.ts'; import '../github/transport.ts'; import '../github/app-config.ts';";
    expect(
      await violations({
        'apps/uw-app/queue/worker.ts': reads,
        'apps/uw-app/cron/scheduled.ts': reads,
        'apps/uw-app/cron/github-sweep.ts': reads,
        'apps/uw-app/kernel.ts':
          "import './github/client.ts'; import './github/transport.ts'; import './github/app-config.ts';",
      }),
    ).toEqual([]);
  });

  it('uw-ingest on the webhook signature package', async () => {
    expect(
      await violations({ 'apps/uw-ingest/sources/a.ts': "import '@octokit/webhooks-methods';" }),
    ).toEqual([]);
  });

  it('the session on the token and Octokit, and the clients on the session', async () => {
    expect(
      await violations({
        'apps/uw-app/github/session.ts': "import './token.ts'; import '@octokit/core';",
        'apps/uw-app/github/client.ts': "import './session.ts';",
        'apps/uw-app/github/comments.ts': "import './session.ts';",
        'apps/uw-app/github/ship-writes.ts': "import './session.ts';",
      }),
    ).toEqual([]);
  });

  it('the merge connector on the ship writes, a GitHub module on the comment writer, and tests', async () => {
    expect(
      await violations({
        'apps/uw-app/github/merge.ts': "import './ship-writes.ts'; import './client.ts';",
        'apps/uw-app/github/import.ts': "import './comments.ts'; import './client.ts';",
        'apps/uw-app/github/a.test.ts': "import './ship-writes.ts'; import './token.ts';",
      }),
    ).toEqual([]);
  });
});
