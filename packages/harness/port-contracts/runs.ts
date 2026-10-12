import { describe, expect, it } from 'vitest';
import type { RunStart, Runs } from '../ports.ts';
import { describeNotWired } from './not-wired-cases.ts';

export type FinishedRunState = 'completed' | 'failed';

export type RunsSubject = {
  readonly runs: Runs;
  finish(runId: string, state: FinishedRunState): Promise<void>;
};

const finishedStates: readonly FinishedRunState[] = ['completed', 'failed'];

function run(id: string): RunStart {
  return {
    runId: id,
    harnessId: 'b5000000-0000-4000-8000-000000000001',
    itemId: 'b5000000-0000-4000-8000-000000000002',
    persona: 'builder',
    runShape: 'workflow-run',
    engine: 'openrouter-messages',
    traceId: 'b5000000-0000-4000-8000-000000000003',
  };
}

const runId = 'b5000000-0000-4000-8000-0000000000a1';

async function expectRefused(
  attempt: Promise<void>,
  from: string | null,
  action: string,
): Promise<void> {
  await expect(attempt).rejects.toMatchObject({ name: 'RunTransitionError', from, action });
}

function describeLifecycle(open: () => Promise<RunsSubject>): void {
  it('moves a run through start, hibernate, resume and stop', async () => {
    const { runs } = await open();
    await runs.start(run(runId));
    expect(await runs.status(runId)).toBe('running');
    await runs.hibernate(runId);
    expect(await runs.status(runId)).toBe('hibernated');
    await runs.resume(runId);
    expect(await runs.status(runId)).toBe('running');
    await runs.stop(runId);
    expect(await runs.status(runId)).toBe('stopped');
  });

  it('answers null for a run it never started', async () => {
    const { runs } = await open();
    expect(await runs.status(runId)).toBeNull();
  });

  it('keeps one run apart from another', async () => {
    const { runs } = await open();
    const other = 'b5000000-0000-4000-8000-0000000000a2';
    await runs.start(run(runId));
    await runs.start(run(other));
    await runs.stop(other);
    expect(await runs.status(runId)).toBe('running');
    expect(await runs.status(other)).toBe('stopped');
  });
}

function describeRefusals(open: () => Promise<RunsSubject>): void {
  it('refuses to resume a stopped run', async () => {
    const { runs } = await open();
    await runs.start(run(runId));
    await runs.stop(runId);
    await expectRefused(runs.resume(runId), 'stopped', 'resume');
    expect(await runs.status(runId)).toBe('stopped');
  });

  it('refuses to stop a stopped run and to hibernate it', async () => {
    const { runs } = await open();
    await runs.start(run(runId));
    await runs.stop(runId);
    await expectRefused(runs.stop(runId), 'stopped', 'stop');
    await expectRefused(runs.hibernate(runId), 'stopped', 'hibernate');
  });

  it('refuses to start a run id twice', async () => {
    const { runs } = await open();
    await runs.start(run(runId));
    await expectRefused(runs.start(run(runId)), 'running', 'start');
  });

  it('refuses to hibernate a run it never started', async () => {
    const { runs } = await open();
    await expectRefused(runs.hibernate(runId), null, 'hibernate');
  });

  it('takes a resume of a running run as a wake-up and leaves it running', async () => {
    const { runs } = await open();
    await runs.start(run(runId));
    await runs.resume(runId);
    expect(await runs.status(runId)).toBe('running');
  });
}

function describeTerminal(open: () => Promise<RunsSubject>): void {
  it.each(finishedStates)('leaves a %s run with no way out', async (state) => {
    const subject = await open();
    await subject.runs.start(run(runId));
    await subject.finish(runId, state);
    expect(await subject.runs.status(runId)).toBe(state);
    await expectRefused(subject.runs.start(run(runId)), state, 'start');
    await expectRefused(subject.runs.hibernate(runId), state, 'hibernate');
    await expectRefused(subject.runs.resume(runId), state, 'resume');
    await expectRefused(subject.runs.stop(runId), state, 'stop');
    expect(await subject.runs.status(runId)).toBe(state);
  });
}

export function describeRunsContract(adapter: string, open: () => Promise<RunsSubject>): void {
  describe(`DX-3 runs port contract on ${adapter}`, () => {
    describeLifecycle(open);
    describeRefusals(open);
    describeTerminal(open);
  });
}

export function describeRunsNotWired(adapter: string, runs: Runs): void {
  describeNotWired('runs', adapter, runs, {
    start: true,
    hibernate: true,
    resume: true,
    stop: true,
    status: true,
  } satisfies Record<keyof Runs, true>);
}
