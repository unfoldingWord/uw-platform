import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { repoFiles } from '../repo-files.ts';

const kernelHosts = [
  ['apps/uw-app/commands/routes.ts', 'hubOf(c.env'],
  ['apps/uw-app/commands/dispatch.ts', 'hubWiring(scope.hub)'],
  ['apps/uw-app/mcp/routes.ts', 'hubWiring(hubOf(c.env'],
  ['apps/uw-app/queue/worker.ts', 'unitHub(hubOf(env'],
  ['apps/uw-app/cron/github-sweep.ts', 'unitHub(hubOf(env'],
] as const;

const hubBinding = /\bHARNESS_HUB\b/;
const bindingReaders = ['apps/uw-app/env.ts', 'apps/uw-app/ports/hub.ts'];

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
