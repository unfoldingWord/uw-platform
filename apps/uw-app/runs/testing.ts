import type { RunStart } from '@uw/harness';
import type { WorkflowBinding, WorkflowInstance } from '../env.ts';

type Sent = { readonly type: string; readonly payload: unknown };

type FakeInstance = WorkflowInstance & {
  readonly params: RunStart;
  readonly events: Sent[];
  state: string;
};

export type FakeWorkflowBinding = WorkflowBinding & {
  readonly instances: Map<string, FakeInstance>;
  readonly calls: string[];
};

function instanceOf(id: string, params: RunStart, calls: string[]): FakeInstance {
  const instance: FakeInstance = {
    id,
    params,
    events: [],
    state: 'queued',
    status: () => Promise.resolve({ status: instance.state }),
    pause: async () => {
      calls.push(`pause ${id}`);
      instance.state = 'paused';
    },
    resume: async () => {
      calls.push(`resume ${id}`);
      instance.state = 'running';
    },
    terminate: async () => {
      calls.push(`terminate ${id}`);
      instance.state = 'terminated';
    },
    sendEvent: async (event) => {
      calls.push(`sendEvent ${id} ${event.type}`);
      instance.events.push(event);
    },
  };
  return instance;
}

export function fakeWorkflowBinding(): FakeWorkflowBinding {
  const instances = new Map<string, FakeInstance>();
  const calls: string[] = [];
  return {
    instances,
    calls,
    create: async ({ id, params }) => {
      if (instances.has(id)) throw new Error(`instance.already_exists ${id}`);
      calls.push(`create ${id}`);
      const instance = instanceOf(id, params, calls);
      instances.set(id, instance);
      return instance;
    },
    get: async (id) => {
      const instance = instances.get(id);
      if (instance === undefined) throw new Error(`instance.not_found ${id}`);
      return instance;
    },
  };
}
