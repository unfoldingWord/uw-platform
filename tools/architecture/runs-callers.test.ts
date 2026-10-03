import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { repoFiles } from '../repo-files.ts';

const hostMembers =
  /\.runs\s*\??\.\s*(?:scene|hibernateAtGate|complete|fail|holdPremise|halt|reviewDiff|postReview|progress)\s*\(/;
const beatMember = /\.runs\s*\??\.\s*beat\s*\(/;
const hostCallers = ['apps/uw-app/runs/', 'apps/uw-app/mcp/in-process.ts', 'sim/'];
const beatCallers = ['apps/uw-app/cron/', 'sim/'];

function isSource(file: string): boolean {
  return (
    ['apps/', 'packages/', 'sim/'].some((root) => file.startsWith(root)) &&
    /\.(?:tsx?|m?js)$/.test(file) &&
    !/\.test\.(?:tsx?|m?js)$/.test(file) &&
    !file.includes('node_modules')
  );
}

function strays(
  pattern: RegExp,
  allowed: readonly string[],
  files: readonly string[],
  read: (file: string) => string,
): string[] {
  return files
    .filter(isSource)
    .filter((file) => !allowed.some((root) => file.startsWith(root)))
    .filter((file) => pattern.test(read(file)));
}

const fromDisk = (file: string) => readFileSync(file, 'utf8');

describe('the run-host kernel members are called only by the run host', () => {
  it('finds the scene, the run ends, the review members and the progress read called only under the run host, the in-process host and the sim', () => {
    expect(strays(hostMembers, hostCallers, repoFiles(), fromDisk)).toEqual([]);
  });

  it('finds the hosted beat called only by the minute cron and the sim', () => {
    expect(strays(beatMember, beatCallers, repoFiles(), fromDisk)).toEqual([]);
  });

  it('flags a planted host-member call outside the run host, and a planted beat outside the cron', () => {
    const planted = new Map([
      ['apps/uw-app/mcp/verbs/x.ts', 'await context.kernel.runs.complete(caller, runId, input);'],
      [
        'apps/uw-app/commands/handlers/y.ts',
        'await kernel.runs?.postReview(caller, runId, input);',
      ],
      ['apps/uw-app/queue/z.ts', 'await kernel.runs . scene (caller, runId);'],
      ['apps/uw-app/commands/handlers/b.ts', 'await kernel.runs.beat(caller, { limit: 10 });'],
      ['apps/uw-app/runs/steps.ts', 'await deps.runKernel.runs.scene(host, runId);'],
      ['apps/uw-app/cron/minute.ts', 'await kernel.runs.beat(caller, { limit: 10 });'],
      ['apps/uw-app/mcp/x.test.ts', 'await kernel.runs.halt(caller, runId, why);'],
    ]);
    const read = (file: string) => planted.get(file) ?? '';
    const files = [...planted.keys()];
    expect(strays(hostMembers, hostCallers, files, read)).toEqual([
      'apps/uw-app/mcp/verbs/x.ts',
      'apps/uw-app/commands/handlers/y.ts',
      'apps/uw-app/queue/z.ts',
    ]);
    expect(strays(beatMember, beatCallers, files, read)).toEqual([
      'apps/uw-app/commands/handlers/b.ts',
    ]);
  });
});
