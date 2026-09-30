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
    'sim into db',
    'sim/a.ts',
    "import '../packages/db/b.ts';",
    'sim-imports-harness-and-contracts-only',
  ],
  [
    'sim into apps',
    'sim/a.ts',
    "import '../apps/uw-app/b.ts';",
    'sim-imports-harness-and-contracts-only',
  ],
  [
    'ingest into the engine',
    'apps/uw-ingest/a.ts',
    "import '../../packages/harness/b.ts';",
    'ingest-never-touches-the-engine',
  ],
  [
    'an island into the engine',
    'apps/uw-app/islands/a.ts',
    "import '../../../packages/harness/b.ts';",
    'islands-never-call-the-engine',
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
];

describe('the dependency rules', () => {
  it('accepts an import that follows the DAG', async () => {
    expect(
      await violations({
        'packages/contracts/index.ts': leaf,
        'packages/core/index.ts':
          "import { value } from '../contracts/index.ts'; export const core = value;",
        'packages/harness/index.ts':
          "import { core } from '../core/index.ts'; export const engine = core;",
      }),
    ).toEqual([]);
  });

  it.each(refusals)('refuses %s', async (_name, path, source, rule) => {
    expect(
      await violations({
        [path]: source,
        'apps/uw-app/b.ts': leaf,
        'packages/db/b.ts': leaf,
        'packages/harness/b.ts': leaf,
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

  it('a vendor SDK inside an engine directory', async () => {
    expect(
      await violations({
        'apps/uw-app/engines/claude-messages/a.ts': "import '@anthropic-ai/sdk';",
      }),
    ).toEqual([]);
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
