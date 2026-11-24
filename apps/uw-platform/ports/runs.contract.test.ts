import { describe, expect, it } from 'vitest';
import { describeRunsContract } from '@uw/harness/port-contracts/runs';
import type { RunStart } from '@uw/harness';
import { fakeWorkflowBinding, type FakeWorkflowBinding } from '../runs/testing.ts';
import { platformRuns } from './runs.ts';

const finishedStatus = { completed: 'complete', failed: 'errored' } as const;

describeRunsContract('platform', async () => {
  const binding = fakeWorkflowBinding();
  return {
    runs: platformRuns(binding),
    finish: async (runId, state) => {
      const instance = binding.instances.get(runId);
      if (instance === undefined) throw new Error(`run ${runId} was never started`);
      instance.state = finishedStatus[state];
    },
  };
});

const start: RunStart = {
  runId: 'b5000000-0000-4000-8000-0000000000c1',
  harnessId: 'b5000000-0000-4000-8000-000000000001',
  itemId: 'b5000000-0000-4000-8000-000000000002',
  persona: 'agent:builder',
  runShape: 'workflow-run',
  engine: 'openrouter-messages',
  traceId: 'b5000000-0000-4000-8000-000000000003',
};

async function startedAt(state: string): Promise<FakeWorkflowBinding> {
  const binding = fakeWorkflowBinding();
  await platformRuns(binding).start(start);
  const instance = binding.instances.get(start.runId);
  if (instance === undefined) throw new Error('the run was not created');
  instance.state = state;
  binding.calls.length = 0;
  return binding;
}

describe('the platform Runs adapter over Cloudflare Workflows', () => {
  it('HE-1 resume sends run-resumed to a Workflow waiting at a gate and resumes a paused one', async () => {
    const waiting = await startedAt('waiting');
    await platformRuns(waiting).resume(start.runId);
    expect(waiting.calls).toEqual([`sendEvent ${start.runId} run-resumed`]);
    expect(waiting.instances.get(start.runId)?.events).toEqual([
      { type: 'run-resumed', payload: {} },
    ]);
    const paused = await startedAt('paused');
    await platformRuns(paused).resume(start.runId);
    expect(paused.calls).toEqual([`resume ${start.runId}`]);
    expect(await platformRuns(paused).status(start.runId)).toBe('running');
  });

  it('sends run-resumed to a Workflow still running toward its gate, so the wake-up is not lost', async () => {
    const running = await startedAt('running');
    await platformRuns(running).resume(start.runId);
    expect(running.calls).toEqual([`sendEvent ${start.runId} run-resumed`]);
  });

  it('creates the instance under the run id with the run as its parameters', async () => {
    const binding = fakeWorkflowBinding();
    await platformRuns(binding).start(start);
    expect(binding.instances.get(start.runId)?.params).toEqual(start);
  });

  it.each([
    ['queued', 'running'],
    ['unknown', 'running'],
    ['waitingForPause', 'hibernated'],
    ['terminated', 'stopped'],
    ['complete', 'completed'],
    ['errored', 'failed'],
  ])('maps the Workflow status %s to %s', async (status, state) => {
    const binding = await startedAt(status);
    expect(await platformRuns(binding).status(start.runId)).toBe(state);
  });
});
