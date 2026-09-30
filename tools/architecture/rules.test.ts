import { cruise } from 'dependency-cruiser';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import config from '../../.dependency-cruiser.mjs';

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
  ];
  for (const name of stubs) {
    files[`node_modules/${name}/index.js`] = 'export default 1;';
    files[`node_modules/${name}/package.json`] = JSON.stringify({ name, main: 'index.js' });
  }
  for (const directory of ['apps', 'packages', 'sim']) {
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
    ['apps', 'packages', 'sim'],
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

  it('accepts a vendor SDK inside an engine directory', async () => {
    expect(
      await violations({
        'apps/uw-app/engines/claude-messages/a.ts': "import '@anthropic-ai/sdk';",
      }),
    ).toEqual([]);
  });
});
