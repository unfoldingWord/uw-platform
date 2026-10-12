import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { engineSchema } from '../../packages/contracts/index.ts';
import { repoFiles } from '../repo-files.ts';
import { leaf, removePlanted, violations } from './planted-cruise.ts';

afterEach(removePlanted);

const scannedRoot = /^(?:apps\/uw-app|packages\/harness)\/.*\.ts$/;
const engineRoot = 'apps/uw-app/engines/';

function branchForms(key: string): readonly string[] {
  return [`=== '${key}'`, `!== '${key}'`, `case '${key}'`, `'${key}' ===`, `'${key}' !==`];
}

function branchesOn(path: string, source: string): string[] {
  return engineSchema.options.flatMap((key) =>
    branchForms(key)
      .filter((form) => source.includes(form))
      .map((form) => `${path}: ${form}`),
  );
}

function scanned(path: string): boolean {
  return scannedRoot.test(path) && !path.endsWith('.test.ts') && !path.startsWith(engineRoot);
}

const engineFile = 'apps/uw-app/engines/claude-messages/turn.ts';
const platform = {
  'apps/uw-app/kernel.ts': leaf,
  'apps/uw-app/database.ts': leaf,
  'apps/uw-app/deps.ts': "import './kernel.ts';\nimport './database.ts';",
  'apps/uw-app/env.ts':
    'export type Bindings = { readonly value: string };\nexport const value = 1;',
  'apps/uw-app/ports/store.ts': leaf,
  'apps/uw-app/ports/model-engine.ts': "import '../engines/registry.ts';",
  'apps/uw-app/github/client.ts': leaf,
  'apps/uw-app/mcp/server.ts': leaf,
  'apps/uw-app/engines/registry.ts': "import './claude-messages/index.ts';",
  'apps/uw-app/engines/seam.ts': leaf,
  'apps/uw-app/engines/config.ts': leaf,
  'apps/uw-app/engines/tool-schemas.ts': leaf,
  'apps/uw-app/engines/gateway/spend.ts': leaf,
  'apps/uw-app/engines/claude-messages/index.ts': "import './turn.ts';",
  'apps/uw-app/engines/claude-messages/prices.ts': leaf,
  'apps/uw-app/engines/codex-sandbox/index.ts': leaf,
  'apps/uw-app/engines/sandbox/run.ts': leaf,
  'apps/uw-app/engines/sandbox/classes.ts': "import '@cloudflare/containers';",
  'apps/uw-app/index.ts': "import './engines/sandbox/classes.ts';",
  'node_modules/@cloudflare/containers/index.js': 'export default 1;',
  'node_modules/@cloudflare/containers/package.json': JSON.stringify({
    name: '@cloudflare/containers',
    main: 'index.js',
  }),
  'packages/db/index.ts': leaf,
};

const toolCaller = 'engines-reach-only-the-tool-caller';

const reaches: [string, string, string, string][] = [
  ['the kernel', engineFile, "import '../../kernel.ts';", toolCaller],
  ['the database', engineFile, "import '../../database.ts';", toolCaller],
  ['a port', engineFile, "import '../../ports/store.ts';", toolCaller],
  ['GitHub', engineFile, "import '../../github/client.ts';", toolCaller],
  ['the MCP surface', engineFile, "import '../../mcp/server.ts';", toolCaller],
  ['@uw/db by its package name', engineFile, "import '@uw/db/client';", toolCaller],
  [
    'a module that holds the kernel and the database',
    engineFile,
    "import '../../deps.ts';",
    toolCaller,
  ],
  [
    'the environment as a value',
    engineFile,
    "import { value } from '../../env.ts';",
    'engines-read-the-environment-as-types-only',
  ],
  [
    'a module that holds the kernel, from the seam',
    'apps/uw-app/engines/seam.ts',
    "import '../deps.ts';",
    'engine-seam-reaches-only-the-engines',
  ],
  [
    'another engine',
    engineFile,
    "import '../codex-sandbox/index.ts';",
    'engines-never-import-another-engine',
  ],
  [
    'an engine from outside the registry',
    'apps/uw-app/runs/run-core.ts',
    "import '../engines/claude-messages/index.ts';",
    'engines-only-from-the-seam',
  ],
  [
    'a vendor SDK outside the six engine directories',
    'apps/uw-app/engines/gateway/spend.ts',
    "import '@anthropic-ai/sdk';",
    'vendor-sdk-only-in-engines',
  ],
];

const sandboxCases: [string, string, string, string][] = [
  [
    'the containers package outside the sandbox directory',
    'apps/uw-app/engines/codex-sandbox/index.ts',
    "import '@cloudflare/containers';",
    'containers-only-in-the-sandbox',
  ],
  [
    'the sandbox from the run host',
    'apps/uw-app/runs/run-core.ts',
    "import '../engines/sandbox/run.ts';",
    'sandbox-only-from-the-sandbox-engines',
  ],
  [
    'the sandbox classes from outside the Worker entry',
    'apps/uw-app/engines/sandbox/run.ts',
    "import './classes.ts';",
    'sandbox-classes-only-in-the-worker-entry',
  ],
];

const allowedEngine = [
  "import '@uw/harness';",
  "import '@uw/contracts';",
  "import 'zod';",
  "import '../seam.ts';",
  "import '../config.ts';",
  "import '../tool-schemas.ts';",
  "import type { Bindings } from '../../env.ts';",
  "import './prices.ts';",
].join('\n');

describe('the engine seam', () => {
  it('HE-2 no file outside apps/uw-app/engines/ names an engine key in a branch', () => {
    const found = repoFiles()
      .filter(scanned)
      .flatMap((path) => branchesOn(path, readFileSync(path, 'utf8')));
    expect(found).toEqual([]);
    const planted = "if (persona.engine === 'codex-sandbox') return;";
    expect(branchesOn('apps/uw-app/runs/planted.ts', planted)).toEqual([
      "apps/uw-app/runs/planted.ts: === 'codex-sandbox'",
    ]);
    expect(scanned('apps/uw-app/runs/planted.ts')).toBe(true);
    expect(scanned('apps/uw-app/engines/codex-sandbox/index.ts')).toBe(false);
  });

  it.each(reaches)(
    'HE-2 an engine reaches the platform only through the MCP tool caller: refuses %s',
    async (_name, path, source, rule) => {
      const found = await violations({ ...platform, [path]: source });
      expect(found.map((violation) => violation.rule)).toContain(rule);
    },
  );

  it('allows the registry, the port adapter and an engine reaching its own files', async () => {
    expect(await violations({ ...platform, [engineFile]: leaf })).toEqual([]);
  });

  it('allows an engine the harness, the contracts, zod, the seam files, its own directory and the environment as types', async () => {
    expect(await violations({ ...platform, [engineFile]: allowedEngine })).toEqual([]);
  });

  it.each(sandboxCases)('refuses %s', async (_name, path, source, rule) => {
    const found = await violations({ ...platform, [path]: source });
    expect(found.map((violation) => violation.rule)).toContain(rule);
  });

  it('allows a sandbox engine the shared sandbox files', async () => {
    const engine = 'apps/uw-app/engines/codex-sandbox/index.ts';
    const files = { ...platform, [engineFile]: leaf, [engine]: "import '../sandbox/run.ts';" };
    const found = await violations(files);
    expect(found).toEqual([]);
  });

  it('refuses the spend reader from outside the roots', async () => {
    const found = await violations({
      ...platform,
      'apps/uw-app/mcp/verbs/get-health.ts': "import '../../engines/gateway/spend.ts';",
    });
    expect(found.map((violation) => violation.rule)).toContain(
      'engines-gateway-only-from-the-roots',
    );
  });
});
