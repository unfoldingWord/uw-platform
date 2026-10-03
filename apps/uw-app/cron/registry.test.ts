import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Bindings } from '../env.ts';
import worker from '../index.ts';
import { sweepGitHubJob } from './github-sweep.ts';
import type { CronDeps } from './job.ts';
import { cronJobs, GITHUB_SWEEP_CRON } from './registry.ts';
import { runScheduled } from './scheduled.ts';

type Line = Record<string, unknown>;

const database: Bindings = { HYPERDRIVE: { connectionString: 'postgres://cron@127.0.0.1:1/none' } };

function controller(cron: string): ScheduledController {
  return { cron, scheduledTime: Date.UTC(2026, 9, 3, 3, 17), noRetry: () => undefined };
}

function logged(spy: { mock: { calls: unknown[][] } }): Line[] {
  return spy.mock.calls.map(([line]) => JSON.parse(String(line)) as Line);
}

function recordingDeps(): { readonly deps: CronDeps; readonly lines: Line[]; sent: number } {
  const lines: Line[] = [];
  const state = {
    lines,
    sent: 0,
    deps: {
      now: () => new Date('2026-10-03T03:17:00.000Z'),
      fetch: () => {
        state.sent += 1;
        return Promise.resolve(new Response(null, { status: 500 }));
      },
      sink: (line: string) => lines.push(JSON.parse(line) as Line),
      newId: () => '00000000-0000-4000-8000-000000000001',
      commit: 'c',
    },
  };
  return state;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GH-2 the sweep is registered as a nightly cron', () => {
  it('registers exactly the nightly cron', () => {
    expect([...cronJobs.keys()]).toEqual([GITHUB_SWEEP_CRON]);
  });

  it('exports the scheduled handler from the worker entry', () => {
    expect(worker.scheduled).toBe(runScheduled);
  });

  it('runs the request retention and then the sweep, each logging database_not_configured as the system principal when there is no database', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await runScheduled(controller(GITHUB_SWEEP_CRON), {});
    const skipped = { outcome: 'database_not_configured', principal: 'agent:system' };
    expect(logged(spy)).toEqual([
      expect.objectContaining({ ...skipped, route: 'cron request retention' }),
      expect.objectContaining({ ...skipped, route: 'cron github sweep' }),
    ]);
  });

  it('logs github_not_configured and sends no request without the GitHub secrets', async () => {
    const recording = recordingDeps();
    await sweepGitHubJob(database, recording.deps);
    expect(recording.lines).toEqual([
      expect.objectContaining({ outcome: 'github_not_configured', principal: 'agent:system' }),
    ]);
    expect(recording.sent).toBe(0);
  });

  it('logs unknown_cron for a cron nothing registered', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await runScheduled(controller('0 0 * * *'), database);
    expect(logged(spy)).toEqual([
      expect.objectContaining({ outcome: 'unknown_cron', cron: '0 0 * * *' }),
    ]);
  });
});
