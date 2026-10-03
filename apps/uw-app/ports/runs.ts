import { RunTransitionError, type RunAction, type Runs, type RunState } from '@uw/harness';
import type { Bindings, WorkflowBinding, WorkflowInstance } from '../env.ts';
import { runsNotWired } from './runs.not-wired.ts';

const RESUMED_EVENT = 'run-resumed';

const states: ReadonlyMap<string, RunState> = new Map<string, RunState>([
  ['queued', 'running'],
  ['running', 'running'],
  ['unknown', 'running'],
  ['paused', 'hibernated'],
  ['waiting', 'hibernated'],
  ['waitingForPause', 'hibernated'],
  ['terminated', 'stopped'],
  ['complete', 'completed'],
  ['errored', 'failed'],
]);

type Found = {
  readonly instance: WorkflowInstance;
  readonly status: string;
  readonly state: RunState;
};

async function find(binding: WorkflowBinding, runId: string): Promise<Found | null> {
  let instance: WorkflowInstance;
  try {
    instance = await binding.get(runId);
  } catch {
    return null;
  }
  const { status } = await instance.status();
  return { instance, status, state: states.get(status) ?? 'running' };
}

async function requireState(
  binding: WorkflowBinding,
  runId: string,
  action: RunAction,
  from: readonly RunState[],
): Promise<Found> {
  const found = await find(binding, runId);
  if (found === null || !from.includes(found.state)) {
    throw new RunTransitionError(runId, found?.state ?? null, action);
  }
  return found;
}

export function platformRuns(binding: WorkflowBinding): Runs {
  return {
    start: async (run) => {
      const found = await find(binding, run.runId);
      if (found !== null) throw new RunTransitionError(run.runId, found.state, 'start');
      await binding.create({ id: run.runId, params: run });
    },
    hibernate: async (runId) => {
      const { instance } = await requireState(binding, runId, 'hibernate', ['running']);
      await instance.pause();
    },
    resume: async (runId) => {
      const found = await requireState(binding, runId, 'resume', ['running', 'hibernated']);
      if (found.status === 'paused') {
        await found.instance.resume();
        return;
      }
      await found.instance.sendEvent({ type: RESUMED_EVENT, payload: {} });
    },
    stop: async (runId) => {
      const { instance } = await requireState(binding, runId, 'stop', ['running', 'hibernated']);
      await instance.terminate();
    },
    status: async (runId) => (await find(binding, runId))?.state ?? null,
  };
}

export function runsOf(env: Bindings): Runs {
  return env.HARNESS_RUN ? platformRuns(env.HARNESS_RUN) : runsNotWired;
}
