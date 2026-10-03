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
  'merge',
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
    'the cron sweep root reaching the read client',
    'apps/uw-app/cron/github-sweep.ts',
    "import '../github/client.ts';",
    'github-reads-only-in-github-and-composition-roots',
  ],
  [
    'the scheduled root reaching the App configuration',
    'apps/uw-app/cron/scheduled.ts',
    "import '../github/app-config.ts';",
    'github-app-config-only-in-github-and-composition-roots',
  ],
  [
    'the kernel root reaching the transport',
    'apps/uw-app/kernel.ts',
    "import './github/transport.ts';",
    'github-reads-only-in-github-and-composition-roots',
  ],
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
    'the queue root building the merge connector',
    'apps/uw-app/queue/worker.ts',
    "import '../github/merge.ts';",
    'merge-handler-only-in-the-connectors-adapter',
  ],
  [
    'the kernel root building the merge connector itself',
    'apps/uw-app/kernel.ts',
    "import './github/merge.ts';",
    'merge-handler-only-in-the-connectors-adapter',
  ],
  [
    'another GitHub module building the merge connector',
    'apps/uw-app/github/sweep.ts',
    "import './merge.ts';",
    'merge-handler-only-in-the-connectors-adapter',
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

const moduleRefusals: [string, string, string][] = [
  [
    'a route reaching the read client factory',
    'apps/uw-app/http/a.ts',
    "import '../github/deps.ts';",
  ],
  ['a route reaching the sweep', 'apps/uw-app/http/a.ts', "import '../github/sweep.ts';"],
  ['a page module reaching the import', 'apps/uw-app/pages/a.ts', "import '../github/import.ts';"],
  [
    'the scheduled root reaching the sweep',
    'apps/uw-app/cron/scheduled.ts',
    "import '../github/sweep.ts';",
  ],
];

const gateKernelFile = 'apps/uw-app/commands/person/gate-kernel.ts';
const gateGitHubFile = 'apps/uw-app/commands/person/gate-github.ts';
const personSurface = {
  [gateKernelFile]: leaf,
  [gateGitHubFile]: leaf,
  'apps/uw-app/commands/person-deps.ts': leaf,
  'apps/uw-app/commands/person/x.ts': leaf,
  'apps/uw-app/commands/dispatch.ts': leaf,
};

const surfaceRefusals: [string, string, string, string][] = [
  [
    'the dispatcher building the gate kernel',
    'apps/uw-app/commands/dispatch.ts',
    "import './person/gate-kernel.ts';",
    'gate-kernel-only-in-gate-commands',
  ],
  [
    'the person deps building the gate kernel',
    'apps/uw-app/commands/person-deps.ts',
    "import './person/gate-kernel.ts';",
    'gate-kernel-only-in-gate-commands',
  ],
  [
    'another person command opening the gate GitHub',
    'apps/uw-app/commands/person/stages.ts',
    "import './gate-github.ts';",
    'gate-kernel-only-in-gate-commands',
  ],
  [
    'the MCP routes building the gate kernel',
    'apps/uw-app/mcp/routes.ts',
    "import '../commands/person/gate-kernel.ts';",
    'gate-kernel-only-in-gate-commands',
  ],
  [
    'a non-gate person command reaching the person deps',
    'apps/uw-app/commands/person/stages.ts',
    "import { platformPersonDeps } from '../person-deps.ts';",
    'person-deps-only-in-app-and-routes',
  ],
  [
    'a page module reaching the person deps',
    'apps/uw-app/pages/a.ts',
    "import { platformPersonDeps } from '../commands/person-deps.ts';",
    'person-deps-only-in-app-and-routes',
  ],
  [
    'the dispatcher reaching the person deps',
    'apps/uw-app/commands/dispatch.ts',
    "import type { PersonDeps } from './person-deps.ts';",
    'person-deps-only-in-app-and-routes',
  ],
  [
    'a page module opening the gate GitHub',
    'apps/uw-app/pages/a.ts',
    "import { platformGateGitHub } from '../commands/person/gate-github.ts';",
    'gate-kernel-only-in-gate-commands',
  ],
  [
    'a type-only import of the gate kernel from another person command',
    'apps/uw-app/commands/person/stages.ts',
    "import type { gateKernel } from './gate-kernel.ts';",
    'gate-kernel-only-in-gate-commands',
  ],
  [
    'a dynamic import of the gate GitHub from the dispatcher',
    'apps/uw-app/commands/dispatch.ts',
    "export const opener = () => import('./person/gate-github.ts');",
    'gate-kernel-only-in-gate-commands',
  ],
  [
    'a route reaching the person surface',
    'apps/uw-app/http/a.ts',
    "import '../commands/person/x.ts';",
    'person-surface-only-from-commands',
  ],
  [
    'the MCP routes reaching the person surface',
    'apps/uw-app/mcp/routes.ts',
    "import '../commands/person/x.ts';",
    'person-surface-only-from-commands',
  ],
  [
    'the MCP routes reaching the command API',
    'apps/uw-app/mcp/routes.ts',
    "import '../commands/dispatch.ts';",
    'agent-hosts-never-import-commands',
  ],
  [
    'an MCP test reaching the gate kernel',
    'apps/uw-app/mcp/a.test.ts',
    "import '../commands/person/gate-kernel.ts';",
    'agent-hosts-never-import-commands',
  ],
  [
    'an engine reaching the command API',
    'apps/uw-app/engines/e/a.ts',
    "import '../../commands/dispatch.ts';",
    'agent-hosts-never-import-commands',
  ],
  [
    'the queue root reaching the command API',
    'apps/uw-app/queue/worker.ts',
    "import '../commands/dispatch.ts';",
    'agent-hosts-never-import-commands',
  ],
  [
    'the cron root reaching the gate GitHub',
    'apps/uw-app/cron/github-sweep.ts',
    "import '../commands/person/gate-github.ts';",
    'agent-hosts-never-import-commands',
  ],
];

describe('the person gate kernel and the person surface', () => {
  it.each(surfaceRefusals)('refuse %s', async (_name, path, source, rule) => {
    const found = await violations({ ...personSurface, [path]: source });
    expect(found.map((violation) => violation.rule)).toContain(rule);
  });

  it('allow the gate commands, the person deps on the gate GitHub, the command API and tests', async () => {
    const found = await violations({
      ...personSurface,
      'apps/uw-app/commands/person/gates.ts':
        "import './gate-kernel.ts'; import './gate-github.ts'; import './x.ts';",
      'apps/uw-app/commands/person-deps.ts': "import './person/gate-github.ts';",
      'apps/uw-app/commands/routes.ts': "import './person/x.ts'; import './person-deps.ts';",
      'apps/uw-app/commands/person/gate-kernel.test.ts': "import './gate-kernel.ts';",
      'apps/uw-app/testing/commands.ts':
        "import '../commands/person/x.ts'; import '../commands/person-deps.ts';",
      'apps/uw-app/app.tsx': "import './commands/person-deps.ts';",
    });
    expect(found).toEqual([]);
  });

  it('allow the gate kernel on the read client, and the gate GitHub on the transport and the App configuration', async () => {
    const found = await violations({
      [gateKernelFile]: "import '../../github/client.ts';",
      [gateGitHubFile]: "import '../../github/transport.ts'; import '../../github/app-config.ts';",
      'apps/uw-app/kernel.ts': "import './github/refresh.ts';",
      'apps/uw-app/github/refresh.ts': leaf,
    });
    expect(found).toEqual([]);
  });
});

describe('the GitHub module is imported only by the platform adapters and the queue and cron roots', () => {
  it.each(moduleRefusals)('refuses %s', async (_name, path, source) => {
    const found = await violations({
      'apps/uw-app/github/deps.ts': leaf,
      'apps/uw-app/github/sweep.ts': leaf,
      'apps/uw-app/github/import.ts': leaf,
      [path]: source,
    });
    expect(found.map((violation) => violation.rule)).toContain(
      'github-module-only-in-ports-and-roots',
    );
  });

  it('allows the adapters, the queue and cron sweep roots, the module itself and tests', async () => {
    const found = await violations({
      'apps/uw-app/github/deps.ts': leaf,
      'apps/uw-app/github/sweep.ts': "import './deps.ts';",
      'apps/uw-app/ports/github-facts.ts': "import '../github/sweep.ts';",
      'apps/uw-app/queue/worker.ts': "import '../github/deps.ts';",
      'apps/uw-app/cron/github-sweep.ts': "import '../github/sweep.ts';",
      'apps/uw-app/http/a.test.ts': "import '../github/deps.ts';",
    });
    expect(found.map((violation) => violation.rule)).not.toContain(
      'github-module-only-in-ports-and-roots',
    );
  });
});

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
  it('the queue root on the read client, its transport and the App configuration', async () => {
    const reads =
      "import '../github/client.ts'; import '../github/transport.ts'; import '../github/app-config.ts';";
    expect(await violations({ 'apps/uw-app/queue/worker.ts': reads })).toEqual([]);
  });

  it('the cron sweep root on the App configuration', async () => {
    expect(
      await violations({ 'apps/uw-app/cron/github-sweep.ts': "import '../github/app-config.ts';" }),
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

  it('the connectors adapter, a GitHub test helper and a test on the merge connector', async () => {
    expect(
      await violations({
        'apps/uw-app/ports/connectors.ts': "import '../github/merge.ts';",
        'apps/uw-app/github/testing/merge-rig.ts': "import '../merge.ts';",
        'apps/uw-app/github/b.test.ts': "import './merge.ts';",
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
