import { RunTransitionError, type RunAction, type Runs, type RunState } from '@uw/harness';

export type SimRuns = Runs & {
  finish(runId: string, state: 'completed' | 'failed'): Promise<void>;
};

type Transition = { readonly from: readonly (RunState | null)[]; readonly to: RunState };

const transitions: ReadonlyMap<RunAction, Transition> = new Map<RunAction, Transition>([
  ['start', { from: [null], to: 'running' }],
  ['hibernate', { from: ['running'], to: 'hibernated' }],
  ['resume', { from: ['hibernated'], to: 'running' }],
  ['stop', { from: ['running', 'hibernated'], to: 'stopped' }],
]);

export function createSimRuns(): SimRuns {
  const states = new Map<string, RunState>();
  const move = async (runId: string, action: RunAction): Promise<void> => {
    const from = states.get(runId) ?? null;
    const transition = transitions.get(action);
    if (!transition?.from.includes(from)) {
      throw new RunTransitionError(runId, from, action);
    }
    states.set(runId, transition.to);
  };
  return {
    start: (run) => move(run.runId, 'start'),
    hibernate: (runId) => move(runId, 'hibernate'),
    resume: (runId) => move(runId, 'resume'),
    stop: (runId) => move(runId, 'stop'),
    status: async (runId) => states.get(runId) ?? null,
    finish: async (runId, state) => {
      if (states.get(runId) !== 'running') throw new Error(`run ${runId} is not running`);
      states.set(runId, state);
    },
  };
}
