import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { repoFiles } from '../repo-files.ts';

const kernelHosts = [
  ['apps/uw-platform/commands/routes.ts', 'hubOf(c.env'],
  [
    'apps/uw-platform/commands/dispatch.ts',
    'hubWiring(scope.hub, { runs: scope.runs, notifier: scope.notifier })',
  ],
  ['apps/uw-platform/mcp/routes.ts', 'hubWiring(hubOf(c.env'],
  ['apps/uw-platform/queue/worker.ts', 'unitHub(hubOf(env'],
  ['apps/uw-platform/cron/github-sweep.ts', 'unitHub(hubOf(env'],
  ['apps/uw-platform/cron/minute.ts', 'unitHub(hubOf(env'],
] as const;

const notifierHosts = [
  'apps/uw-platform/commands/routes.ts',
  'apps/uw-platform/mcp/routes.ts',
  'apps/uw-platform/queue/worker.ts',
  'apps/uw-platform/cron/github-sweep.ts',
  'apps/uw-platform/cron/minute.ts',
  'apps/uw-platform/runs/deps.ts',
] as const;

const hubBinding = /\bHARNESS_HUB\b/;
const bindingReaders = [
  'apps/uw-platform/env.ts',
  'apps/uw-platform/ports/hub.ts',
  'apps/uw-platform/live/connect.ts',
  'apps/uw-platform/health/hub.ts',
];
const socketPath = /\/connect\b(?!\.ts)/;
const socketOpener = 'apps/uw-platform/live/connect.ts';
const hubCore = 'apps/uw-platform/live/hub-core.ts';

function isAppSource(file: string): boolean {
  return (
    file.startsWith('apps/') &&
    /\.tsx?$/.test(file) &&
    !/\.test\.tsx?$/.test(file) &&
    !file.includes('node_modules')
  );
}

function bindingStrays(files: readonly string[], read: (file: string) => string): string[] {
  return files
    .filter(isAppSource)
    .filter((file) => !bindingReaders.includes(file))
    .filter((file) => hubBinding.test(read(file)));
}

function socketStrays(files: readonly string[], read: (file: string) => string): string[] {
  return files
    .filter(isAppSource)
    .filter((file) => file !== socketOpener && file !== hubCore)
    .filter((file) => socketPath.test(read(file)));
}

describe('WB-3 the command, MCP, queue and cron kernels are wired with the hub of their environment', () => {
  it.each(kernelHosts)('%s builds its hub with hubOf', (file, call) => {
    const source = readFileSync(file, 'utf8');
    expect(source).toContain(call);
    expect(source).not.toContain('hubNotWired');
  });
});

describe('every kernel that appends events is wired with the notifier of its environment', () => {
  it.each(notifierHosts)('%s builds its notifier with notifierOf', (file) => {
    const source = readFileSync(file, 'utf8');
    expect(source).toContain('notifierOf(');
    expect(source).not.toContain('notifierNotWired');
  });

  it('the dispatcher and the gate kernel pass the scope notifier on', () => {
    expect(readFileSync('apps/uw-platform/commands/person/gate-kernel.ts', 'utf8')).toContain(
      'notifier: live.notifier',
    );
  });
});

describe('the hub Durable Object is reached only through the platform Hub adapter', () => {
  it('finds the HARNESS_HUB binding named only in env.ts and the adapter', () => {
    expect(bindingStrays(repoFiles(), (file) => readFileSync(file, 'utf8'))).toEqual([]);
  });

  it('flags a planted binding read outside the adapter', () => {
    const planted = new Map([
      ['apps/uw-platform/commands/routes.ts', 'c.env.HARNESS_HUB.get(id);'],
      ['apps/uw-platform/ports/hub.ts', 'env.HARNESS_HUB'],
      ['apps/uw-platform/ports/hub.test.ts', 'HARNESS_HUB'],
    ]);
    expect(bindingStrays([...planted.keys()], (file) => planted.get(file) ?? '')).toEqual([
      'apps/uw-platform/commands/routes.ts',
    ]);
  });
});

describe('only the live route opens a socket to the hub', () => {
  it('finds the hub connect path named only by the live route and the hub itself', () => {
    expect(socketStrays(repoFiles(), (file) => readFileSync(file, 'utf8'))).toEqual([]);
  });

  it('flags a planted connect outside the live route', () => {
    const planted = new Map([
      ['apps/uw-platform/health/hub.ts', "stub.fetch('https://hub.internal/connect');"],
      ['apps/uw-platform/live/connect.ts', "stub.fetch('https://hub.internal/connect');"],
      ['apps/uw-platform/live/connect.pg.test.ts', "'/connect'"],
      ['apps/uw-platform/commands/routes.ts', "import { connectLive } from '../live/connect.ts';"],
    ]);
    expect(socketStrays([...planted.keys()], (file) => planted.get(file) ?? '')).toEqual([
      'apps/uw-platform/health/hub.ts',
    ]);
  });
});

const cloudflareImport = /(?:from\s*|import\s*\(?\s*)['"](cloudflare[^'"]*)['"]/g;
const runtimeModuleHosts: ReadonlySet<string> = new Set([
  'apps/uw-platform/live/harness-hub.ts',
  'apps/uw-platform/runs/workflow.ts',
  'apps/uw-platform/pdf/workflow.ts',
  'apps/uw-platform/measures/workflow.ts',
]);

function isSource(file: string): boolean {
  return (
    ['apps/', 'packages/', 'sim/', 'tools/'].some((root) => file.startsWith(root)) &&
    /\.(?:tsx?|m?js)$/.test(file) &&
    !file.includes('node_modules')
  );
}

function cloudflareStrays(files: readonly string[], read: (file: string) => string): string[] {
  return files.filter(isSource).flatMap((file) =>
    [...read(file).matchAll(cloudflareImport)]
      .map((match) => match[1] ?? '')
      .filter((specifier) => !runtimeModuleHosts.has(file) || specifier !== 'cloudflare:workers')
      .map((specifier) => `${file} imports ${specifier}`),
  );
}

describe('the Workers runtime module is imported only by the hub Durable Object and the HarnessRun and PdfExportRun Workflows', () => {
  it('finds cloudflare imported only as cloudflare:workers and only from the HarnessHub, HarnessRun and PdfExportRun files', () => {
    const others = repoFiles().filter((file) => file !== 'tools/architecture/hub-wiring.test.ts');
    expect(cloudflareStrays(others, (file) => readFileSync(file, 'utf8'))).toEqual([]);
  });

  it('flags the cloudflare package, and the runtime module outside the hub file', () => {
    const planted = new Map([
      [
        'apps/uw-platform/live/harness-hub.ts',
        "import { DurableObject } from 'cloudflare:workers';",
      ],
      [
        'apps/uw-platform/runs/workflow.ts',
        "import { WorkflowEntrypoint } from 'cloudflare:workers';\nimport { NonRetryableError } from 'cloudflare:workflows';",
      ],
      ['apps/uw-platform/live/other.ts', "import { DurableObject } from 'cloudflare:workers';"],
      ['apps/uw-platform/ports/sdk.ts', "import Cloudflare from 'cloudflare';"],
      ['apps/uw-platform/ports/lazy.ts', "const sdk = await import('cloudflare/resources');"],
    ]);
    expect(cloudflareStrays([...planted.keys()], (file) => planted.get(file) ?? '')).toEqual([
      'apps/uw-platform/runs/workflow.ts imports cloudflare:workflows',
      'apps/uw-platform/live/other.ts imports cloudflare:workers',
      'apps/uw-platform/ports/sdk.ts imports cloudflare',
      'apps/uw-platform/ports/lazy.ts imports cloudflare/resources',
    ]);
  });
});

describe('#198 the PdfExportRun Workflow hosts the Workers runtime module', () => {
  it('#198 lets the PDF export Workflow file import cloudflare:workers and nothing else from cloudflare', () => {
    const planted = new Map([
      [
        'apps/uw-platform/pdf/workflow.ts',
        "import { WorkflowEntrypoint } from 'cloudflare:workers';",
      ],
      [
        'apps/uw-platform/pdf/renderer.ts',
        "import { WorkflowEntrypoint } from 'cloudflare:workers';",
      ],
      [
        'apps/uw-platform/pdf/steps.ts',
        "import { NonRetryableError } from 'cloudflare:workflows';",
      ],
    ]);
    expect(cloudflareStrays([...planted.keys()], (file) => planted.get(file) ?? '')).toEqual([
      'apps/uw-platform/pdf/renderer.ts imports cloudflare:workers',
      'apps/uw-platform/pdf/steps.ts imports cloudflare:workflows',
    ]);
  });
});

describe('the MeasureRun Workflow hosts the Workers runtime module', () => {
  it('lets the measure run Workflow file import cloudflare:workers and nothing else from cloudflare', () => {
    const planted = new Map([
      [
        'apps/uw-platform/measures/workflow.ts',
        "import { WorkflowEntrypoint } from 'cloudflare:workers';\nimport { NonRetryableError } from 'cloudflare:workflows';",
      ],
      [
        'apps/uw-platform/measures/run-steps.ts',
        "import { WorkflowEntrypoint } from 'cloudflare:workers';",
      ],
    ]);
    expect(cloudflareStrays([...planted.keys()], (file) => planted.get(file) ?? '')).toEqual([
      'apps/uw-platform/measures/workflow.ts imports cloudflare:workflows',
      'apps/uw-platform/measures/run-steps.ts imports cloudflare:workers',
    ]);
  });
});
