import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { repoFiles } from '../repo-files.ts';

const kernelHosts = [
  ['apps/uw-app/commands/routes.ts', 'hubOf(c.env'],
  ['apps/uw-app/commands/dispatch.ts', 'hubWiring(scope.hub, { runs: scope.runs })'],
  ['apps/uw-app/mcp/routes.ts', 'hubWiring(hubOf(c.env'],
  ['apps/uw-app/queue/worker.ts', 'unitHub(hubOf(env'],
  ['apps/uw-app/cron/github-sweep.ts', 'unitHub(hubOf(env'],
  ['apps/uw-app/cron/minute.ts', 'unitHub(hubOf(env'],
] as const;

const hubBinding = /\bHARNESS_HUB\b/;
const bindingReaders = [
  'apps/uw-app/env.ts',
  'apps/uw-app/ports/hub.ts',
  'apps/uw-app/live/connect.ts',
  'apps/uw-app/health/hub.ts',
];
const socketPath = /\/connect\b(?!\.ts)/;
const socketOpener = 'apps/uw-app/live/connect.ts';
const hubCore = 'apps/uw-app/live/hub-core.ts';

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

describe('the hub Durable Object is reached only through the platform Hub adapter', () => {
  it('finds the HARNESS_HUB binding named only in env.ts and the adapter', () => {
    expect(bindingStrays(repoFiles(), (file) => readFileSync(file, 'utf8'))).toEqual([]);
  });

  it('flags a planted binding read outside the adapter', () => {
    const planted = new Map([
      ['apps/uw-app/commands/routes.ts', 'c.env.HARNESS_HUB.get(id);'],
      ['apps/uw-app/ports/hub.ts', 'env.HARNESS_HUB'],
      ['apps/uw-app/ports/hub.test.ts', 'HARNESS_HUB'],
    ]);
    expect(bindingStrays([...planted.keys()], (file) => planted.get(file) ?? '')).toEqual([
      'apps/uw-app/commands/routes.ts',
    ]);
  });
});

describe('only the live route opens a socket to the hub', () => {
  it('finds the hub connect path named only by the live route and the hub itself', () => {
    expect(socketStrays(repoFiles(), (file) => readFileSync(file, 'utf8'))).toEqual([]);
  });

  it('flags a planted connect outside the live route', () => {
    const planted = new Map([
      ['apps/uw-app/health/hub.ts', "stub.fetch('https://hub.internal/connect');"],
      ['apps/uw-app/live/connect.ts', "stub.fetch('https://hub.internal/connect');"],
      ['apps/uw-app/live/connect.pg.test.ts', "'/connect'"],
      ['apps/uw-app/commands/routes.ts', "import { connectLive } from '../live/connect.ts';"],
    ]);
    expect(socketStrays([...planted.keys()], (file) => planted.get(file) ?? '')).toEqual([
      'apps/uw-app/health/hub.ts',
    ]);
  });
});

const cloudflareImport = /(?:from\s*|import\s*\(?\s*)['"](cloudflare[^'"]*)['"]/g;
const runtimeModuleHost = 'apps/uw-app/live/harness-hub.ts';

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
      .filter((specifier) => file !== runtimeModuleHost || specifier !== 'cloudflare:workers')
      .map((specifier) => `${file} imports ${specifier}`),
  );
}

describe('the Workers runtime module is imported only by the hub Durable Object', () => {
  it('finds cloudflare imported only as cloudflare:workers and only from the HarnessHub file', () => {
    const others = repoFiles().filter((file) => file !== 'tools/architecture/hub-wiring.test.ts');
    expect(cloudflareStrays(others, (file) => readFileSync(file, 'utf8'))).toEqual([]);
  });

  it('flags the cloudflare package, and the runtime module outside the hub file', () => {
    const planted = new Map([
      [runtimeModuleHost, "import { DurableObject } from 'cloudflare:workers';"],
      ['apps/uw-app/live/other.ts', "import { DurableObject } from 'cloudflare:workers';"],
      ['apps/uw-app/ports/sdk.ts', "import Cloudflare from 'cloudflare';"],
      ['apps/uw-app/ports/lazy.ts', "const sdk = await import('cloudflare/resources');"],
    ]);
    expect(cloudflareStrays([...planted.keys()], (file) => planted.get(file) ?? '')).toEqual([
      'apps/uw-app/live/other.ts imports cloudflare:workers',
      'apps/uw-app/ports/sdk.ts imports cloudflare',
      'apps/uw-app/ports/lazy.ts imports cloudflare/resources',
    ]);
  });
});
