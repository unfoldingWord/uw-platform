import { cruise } from 'dependency-cruiser';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import config from '../../.dependency-cruiser.mjs';
import { architectureRoots, presentRoots } from './roots.ts';

const roots: string[] = [];

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'uw-architecture-'));
  roots.push(root);
  const stubs = [
    'hono',
    'drizzle-orm',
    'openai',
    '@anthropic-ai/sdk',
    '@openrouter/sdk',
    'wrangler',
    'eslint',
    'vitest',
    'zod',
    'yaml',
    '@electric-sql/pglite',
    '@block65/webcrypto-web-push',
  ];
  for (const name of stubs) {
    files[`node_modules/${name}/index.js`] = 'export default 1;';
    files[`node_modules/${name}/package.json`] = JSON.stringify({ name, main: 'index.js' });
  }
  files['node_modules/typed/index.js'] = 'export default 1;';
  files['node_modules/typed/index.d.ts'] = 'export default 1;';
  files['node_modules/typed/package.json'] = JSON.stringify({
    name: 'typed',
    exports: { '.': { types: './index.d.ts', default: './index.js' } },
  });
  for (const directory of architectureRoots) {
    mkdirSync(join(root, directory), { recursive: true });
  }
  for (const [path, source] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), source);
  }
  return root;
}

async function violations(files: Record<string, string>): Promise<string[]> {
  const root = tree(files);
  const result = await cruise(
    architectureRoots,
    { ...config.options, baseDir: root, validate: true, ruleSet: config },
    undefined,
  );
  if (typeof result.output === 'string') {
    throw new Error('expected structured output');
  }
  return result.output.summary.violations.map((violation) => violation.rule.name);
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

const leaf = 'export const value = 1;';

const refusals: [string, string, string, string][] = [
  [
    'harness into apps',
    'packages/harness/a.ts',
    "import '../../apps/uw-app/b.ts';",
    'harness-imports-contracts-and-core-only',
  ],
  [
    'harness into db',
    'packages/harness/a.ts',
    "import '../db/b.ts';",
    'harness-imports-contracts-and-core-only',
  ],
  [
    'harness into a root dependency',
    'packages/harness/a.ts',
    "import 'eslint';",
    'harness-imports-contracts-and-core-only',
  ],
  [
    'harness into a dependency that resolves to its types',
    'packages/harness/a.ts',
    "import 'typed';",
    'harness-imports-contracts-and-core-only',
  ],
  [
    'harness into a declaration file in apps',
    'packages/harness/a.ts',
    "import type { Value } from '../../apps/uw-app/types.d.ts'; export type Local = Value;",
    'harness-imports-contracts-and-core-only',
  ],
  [
    'a harness test into a root dependency',
    'packages/harness/a.test.ts',
    "import 'eslint';",
    'harness-tests-import-contracts-core-and-vitest-only',
  ],
  [
    'contracts into the network',
    'packages/contracts/a.ts',
    "import 'node:https';",
    'contracts-imports-zod-only',
  ],
  [
    'contracts into node:fs',
    'packages/contracts/a.ts',
    "import 'node:fs';",
    'contracts-imports-zod-only',
  ],
  [
    'contracts into Hono',
    'packages/contracts/a.ts',
    "import 'hono';",
    'contracts-imports-zod-only',
  ],
  [
    'a contracts test into the network',
    'packages/contracts/a.test.ts',
    "import 'node:https';",
    'contracts-tests-import-zod-vitest-and-fixture-reads-only',
  ],
  [
    'a contracts test into apps',
    'packages/contracts/a.test.ts',
    "import '../../apps/uw-app/b.ts';",
    'contracts-imports-nothing',
  ],
  ['harness into Hono', 'packages/harness/a.ts', "import 'hono';", 'harness-is-pure'],
  ['harness into Drizzle', 'packages/harness/a.ts', "import 'drizzle-orm';", 'harness-is-pure'],
  ['harness into a Workers tool', 'packages/harness/a.ts', "import 'wrangler';", 'harness-is-pure'],
  ['harness into the network', 'packages/harness/a.ts', "import 'node:https';", 'harness-is-pure'],
  ['harness into a vendor SDK', 'packages/harness/a.ts', "import 'openai';", 'harness-is-pure'],
  [
    'contracts into apps',
    'packages/contracts/a.ts',
    "import '../../apps/uw-app/b.ts';",
    'contracts-imports-nothing',
  ],
  [
    'db into apps',
    'packages/db/a.ts',
    "import '../../apps/uw-app/b.ts';",
    'db-imports-contracts-and-core',
  ],
  ['core into db', 'packages/core/a.ts', "import '../db/b.ts';", 'core-imports-contracts-only'],
  [
    'sim into core',
    'sim/a.ts',
    "import '../packages/core/b.ts';",
    'sim-imports-harness-contracts-and-db-only',
  ],
  [
    'sim into apps',
    'sim/a.ts',
    "import '../apps/uw-app/b.ts';",
    'sim-imports-harness-contracts-and-db-only',
  ],
  [
    'sim into an npm package',
    'sim/a.ts',
    "import 'zod';",
    'sim-imports-harness-contracts-db-and-node-only',
  ],
  [
    'sim into Drizzle',
    'sim/a.ts',
    "import 'drizzle-orm';",
    'sim-imports-harness-contracts-db-and-node-only',
  ],
  [
    'a sim adapter into node:os',
    'sim/adapters/a.ts',
    "import 'node:os';",
    'sim-os-and-child-process-only-in-tests-cli-and-runner',
  ],
  [
    'a sim adapter into node:child_process',
    'sim/adapters/a.ts',
    "import 'node:child_process';",
    'sim-os-and-child-process-only-in-tests-cli-and-runner',
  ],
  [
    'a sim non-test file into Vitest',
    'sim/a.ts',
    "import 'vitest';",
    'sim-non-test-files-never-import-vitest',
  ],
  [
    'a port contract into a root dependency',
    'packages/harness/port-contracts/a.ts',
    "import 'eslint';",
    'harness-port-contracts-import-the-harness-and-vitest-only',
  ],
  [
    'a non-test package file into a port contract',
    'packages/harness/index.ts',
    "import './port-contracts/b.ts';",
    'port-contracts-only-in-tests',
  ],
  [
    'a non-test app file into a port contract',
    'apps/uw-app/a.ts',
    "import '../../packages/harness/port-contracts/b.ts';",
    'port-contracts-only-in-tests',
  ],
  [
    'a non-test app file into the in-process host',
    'apps/uw-app/a.ts',
    "import './mcp/in-process.ts';",
    'in-process-host-only-in-run-steps',
  ],
  [
    'the run core into the in-process host past the run steps',
    'apps/uw-app/runs/run-core.ts',
    "import '../mcp/in-process.ts';",
    'in-process-host-only-in-run-steps',
  ],
  [
    'an app module into the run host',
    'apps/uw-app/cron/a.ts',
    "import '../runs/b.ts';",
    'run-host-only-from-the-workflow',
  ],
  [
    'the MCP surface into the run host',
    'apps/uw-app/mcp/a.test.ts',
    "import '../runs/b.ts';",
    'mcp-never-imports-the-run-host',
  ],
  [
    'an app module into the verb server',
    'apps/uw-app/commands/a.ts',
    "import '../mcp/server.ts';",
    'verb-server-only-in-the-hosts',
  ],
  [
    'ingest into the kernel',
    'apps/uw-ingest/a.ts',
    "import '../../packages/harness/b.ts';",
    'ingest-never-touches-the-kernel',
  ],
  [
    'an island into the kernel',
    'apps/uw-app/islands/a.ts',
    "import '../../../packages/harness/b.ts';",
    'islands-never-call-the-kernel',
  ],
  [
    'a browser island into the database',
    'apps/uw-app/islands/browser/a.ts',
    "import '../../../../packages/db/b.ts';",
    'islands-never-call-the-kernel',
  ],
  [
    'the service worker into a route module',
    'apps/uw-app/islands/worker/a.ts',
    "import '../../commands/routes.ts';",
    'islands-never-call-the-kernel',
  ],
  [
    'a route module into the built islands bundle',
    'apps/uw-app/commands/a.ts',
    "import '../generated/islands.ts';",
    'islands-bundle-only-in-assets-and-views',
  ],
  [
    'a Worker file into the embedded database',
    'apps/uw-app/a.ts',
    "import '../../packages/db/embedded.ts';",
    'apps-never-import-the-embedded-database',
  ],
  [
    'a Worker file into PGlite',
    'apps/uw-app/a.ts',
    "import '@electric-sql/pglite';",
    'apps-never-import-the-embedded-database',
  ],
  [
    'a vendor SDK outside an engine',
    'apps/uw-app/a.ts',
    "import '@anthropic-ai/sdk';",
    'vendor-sdk-only-in-engines',
  ],
  [
    'OpenAI outside an engine',
    'packages/core/a.ts',
    "import 'openai';",
    'vendor-sdk-only-in-engines',
  ],
  [
    'OpenRouter outside an engine',
    'sim/a.ts',
    "import '@openrouter/sdk';",
    'vendor-sdk-only-in-engines',
  ],
  [
    'the web push library outside the push transport',
    'apps/uw-app/notify/push/send.ts',
    "import '@block65/webcrypto-web-push';",
    'web-push-only-in-push-transport',
  ],
];

describe('the islands rules', () => {
  it('lets an island import another island, the contracts and the ui text, and the assets import the bundle', async () => {
    expect(
      await violations({
        'packages/contracts/index.ts': leaf,
        'packages/ui/components/text.ts': leaf,
        'apps/uw-app/islands/live/session.ts': leaf,
        'apps/uw-app/generated/islands.ts': leaf,
        'apps/uw-app/islands/browser/a.ts':
          "import '../live/session.ts'; import '../../../../packages/contracts/index.ts'; import '../../../../packages/ui/components/text.ts';",
        'apps/uw-app/assets/routes.ts': "import '../generated/islands.ts';",
        'apps/uw-app/views/parts/frame.tsx': "import '../../generated/islands.ts';",
      }),
    ).toEqual([]);
  });
});

describe('the dependency rules', () => {
  it('accepts an import that follows the DAG', async () => {
    expect(
      await violations({
        'packages/contracts/index.ts': leaf,
        'packages/core/index.ts':
          "import { value } from '../contracts/index.ts'; export const core = value;",
        'packages/harness/index.ts':
          "import { core } from '../core/index.ts'; export const kernel = core;",
      }),
    ).toEqual([]);
  });

  it.each(refusals)('refuses %s', async (_name, path, source, rule) => {
    expect(
      await violations({
        [path]: source,
        'apps/uw-app/b.ts': leaf,
        'packages/db/b.ts': leaf,
        'packages/db/embedded.ts': leaf,
        'packages/core/b.ts': leaf,
        'packages/harness/b.ts': leaf,
        'packages/harness/port-contracts/b.ts': leaf,
        'apps/uw-app/mcp/in-process.ts': leaf,
        'apps/uw-app/mcp/server.ts': leaf,
        'apps/uw-app/runs/b.ts': leaf,
        'apps/uw-app/commands/routes.ts': leaf,
        'apps/uw-app/generated/islands.ts': leaf,
        'apps/uw-app/types.d.ts': 'export type Value = number;',
      }),
    ).toContain(rule);
  });

  it('refuses a circular import', async () => {
    expect(
      await violations({
        'packages/core/a.ts': "import './b.ts'; export const a = 1;",
        'packages/core/b.ts': "import './a.ts'; export const b = 1;",
      }),
    ).toContain('no-circular');
  });
});

describe('the dependency rules allow', () => {
  it('the harness on yaml, and nothing else from npm', async () => {
    expect(await violations({ 'packages/harness/a.ts': "import 'yaml';" })).toEqual([]);
    expect(await violations({ 'packages/harness/a.ts': "import 'zod';" })).toContain(
      'harness-imports-contracts-and-core-only',
    );
  });

  it('a harness test that imports Vitest and core', async () => {
    expect(
      await violations({
        'packages/core/index.ts': leaf,
        'packages/harness/a.test.ts': "import 'vitest'; import '../core/index.ts';",
      }),
    ).toEqual([]);
  });

  it('contracts on zod and a contracts test reading its fixtures', async () => {
    expect(
      await violations({
        'packages/contracts/index.ts': "import 'zod'; export const value = 1;",
        'packages/contracts/a.test.ts':
          "import 'vitest'; import 'node:fs'; import 'node:path'; import 'zod'; import './index.ts';",
      }),
    ).toEqual([]);
  });

  it('the sim on the harness, the contracts and the db', async () => {
    expect(
      await violations({
        'packages/contracts/index.ts': leaf,
        'packages/db/index.ts': leaf,
        'packages/harness/index.ts': leaf,
        'sim/a.ts':
          "import '../packages/harness/index.ts'; import '../packages/contracts/index.ts'; import '../packages/db/index.ts';",
      }),
    ).toEqual([]);
  });
});

describe('the run host dependency rules allow', () => {
  it('the run steps on the in-process host, the Worker entry on the run host, and the hosts on the verb server', async () => {
    expect(
      await violations({
        'apps/uw-app/mcp/server.ts': leaf,
        'apps/uw-app/mcp/in-process.ts': "import './server.ts';",
        'apps/uw-app/mcp/routes.ts': "import './server.ts';",
        'apps/uw-app/runs/steps.ts': "import '../mcp/in-process.ts';",
        'apps/uw-app/runs/workflow.ts': "import './steps.ts';",
        'apps/uw-app/index.ts': "import './runs/workflow.ts';",
      }),
    ).toEqual([]);
  });

  it('a test that connects the in-process host', async () => {
    expect(
      await violations({
        'apps/uw-app/mcp/in-process.ts': leaf,
        'apps/uw-app/mcp/a.test.ts': "import './in-process.ts';",
      }),
    ).toEqual([]);
  });

  it('the web push library inside the push transport', async () => {
    expect(
      await violations({
        'apps/uw-app/notify/push/transport.ts': "import '@block65/webcrypto-web-push';",
      }),
    ).toEqual([]);
  });

  it('a vendor SDK inside an engine directory', async () => {
    expect(
      await violations({
        'apps/uw-app/engines/claude-messages/a.ts': "import '@anthropic-ai/sdk';",
      }),
    ).toEqual([]);
  });
});

describe('the dependency rules allow the sim and port contracts', () => {
  it('a port contract on Vitest and the ports', async () => {
    expect(
      await violations({
        'packages/harness/index.ts': leaf,
        'packages/harness/port-contracts/a.ts': "import 'vitest'; import '../index.ts';",
      }),
    ).toEqual([]);
  });

  it('the sim on Node built-ins, and a sim test on Vitest', async () => {
    expect(
      await violations({
        'sim/a.ts':
          "import 'node:fs'; import 'node:path'; import 'node:url'; import 'node:assert/strict'; import 'node:fs/promises'; import 'fs/promises';",
        'sim/a.test.ts': "import 'vitest'; import 'node:os'; import './a.ts';",
      }),
    ).toEqual([]);
  });

  it('node:os and node:child_process in the sim cli and runner', async () => {
    expect(
      await violations({
        'sim/cli/a.ts': "import 'node:os'; import 'node:child_process';",
        'sim/runner/a.ts': "import 'node:os'; import 'node:child_process';",
      }),
    ).toEqual([]);
  });
});

describe('the store executor rule', () => {
  const store = 'export const executorOf = 1;';

  it('refuses an import of the store module from outside packages/db/store', async () => {
    expect(
      await violations({
        'packages/db/store/store.ts': store,
        'apps/uw-app/x.ts': "import '../../packages/db/store/store.ts';",
      }),
    ).toContain('store-executor-stays-in-the-store');
  });

  it('allows a sibling inside packages/db/store', async () => {
    expect(
      await violations({
        'packages/db/store/store.ts': store,
        'packages/db/store/y.ts': "import './store.ts';",
      }),
    ).not.toContain('store-executor-stays-in-the-store');
  });
});

describe('the architecture roots', () => {
  it('cruise the sim and the tests alongside apps and packages', () => {
    expect(architectureRoots).toEqual(['apps', 'packages', 'sim', 'tests']);
  });

  it('skip a root that does not exist yet', () => {
    expect(presentRoots((root) => root !== 'sim')).toEqual(['apps', 'packages', 'tests']);
  });
});
