import { principalSchema } from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import type { Caller } from '../caller.ts';
import { refused, type KernelOutcome } from '../outcome.ts';
import type { Ports } from '../ports.ts';
import { createRunCommands, type RunCommands } from './commands.ts';

type HostCall = (commands: RunCommands, caller: Caller) => Promise<KernelOutcome<unknown>>;

const runId = 'c1000000-0000-4000-8000-000000000001';

const hostCalls: Readonly<Record<string, HostCall>> = {
  scene: (commands, caller) => commands.scene(caller, runId),
  hibernateAtGate: (commands, caller) => commands.hibernateAtGate(caller, runId),
  complete: (commands, caller) =>
    commands.complete(caller, runId, { result: 'decided', review: null }),
  fail: (commands, caller) =>
    commands.fail(caller, runId, { step: 'work', why: 'retries_exhausted', detail: '\u0000' }),
  holdPremise: (commands, caller) => commands.holdPremise(caller, runId, { reason: '' }),
  halt: (commands, caller) => commands.halt(caller, runId, 'lease_expired'),
  beat: (commands, caller) => commands.beat(caller, { limit: 0 }),
  reviewDiff: (commands, caller) => commands.reviewDiff(caller, runId),
  postReview: (commands, caller) =>
    commands.postReview(caller, runId, {
      verdict: 'approve',
      findings: [],
      resolvedProvider: null,
      resolvedModel: '',
    }),
};

const personReachable = ['start', 'stop', 'prompt'];

const persona = principalSchema.parse({
  identity: 'agent:builder',
  kind: 'agent',
  personId: '00000000-0000-4000-8000-000000000004',
  email: null,
  grants: [],
  interactive: false,
});

const admin = principalSchema.parse({
  identity: 'human:00000000-0000-4000-8000-000000000004',
  kind: 'person',
  personId: '00000000-0000-4000-8000-000000000004',
  email: 'owner@example.org',
  grants: [
    {
      grantId: '00000000-0000-4000-8000-000000000101',
      role: 'admin',
      scopeKind: 'org',
      scopeArea: null,
      expiresAt: null,
    },
  ],
  interactive: true,
});

const callers: readonly Caller[] = [persona, admin].map((actor) => ({
  actor,
  traceId: 'c1000000-0000-4000-8000-0000000000e1',
}));

function touchingPorts(touched: string[]): Ports {
  const touch = (name: string) => (): never => {
    touched.push(name);
    throw new Error(`${name} was called`);
  };
  return {
    clock: { now: touch('clock.now') },
    ids: { next: touch('ids.next') },
    store: { transaction: touch('store.transaction'), appliedMigrations: touch('store') },
    grants: {
      resolve: touch('grants'),
      resolveIn: touch('grants'),
      lockAndReread: touch('grants'),
    },
    githubFacts: { pullRequest: touch('facts'), refresh: touch('facts'), diff: touch('facts') },
    connectors: { run: touch('connectors'), outcomeOf: touch('connectors'), review: touch('c') },
    modelEngine: { turn: touch('modelEngine'), spend: touch('modelEngine') },
    hub: { wake: touch('hub') },
    notifier: { notify: touch('notifier') },
    runs: {
      start: touch('runs'),
      hibernate: touch('runs'),
      resume: touch('runs'),
      stop: touch('runs'),
      status: touch('runs'),
    },
  };
}

async function answer(call: HostCall, commands: RunCommands, caller: Caller) {
  try {
    return await call(commands, caller);
  } catch {
    return null;
  }
}

async function refusesFirst(commands: RunCommands, touched: string[], name: string) {
  const call = hostCalls[name];
  if (call === undefined) return false;
  for (const caller of callers) {
    const outcome = await answer(call, commands, caller);
    const denied = refused('not_permitted', { actor: caller.actor.identity });
    if (touched.length > 0 || JSON.stringify(outcome) !== JSON.stringify(denied)) return false;
  }
  return true;
}

async function ungated(make: (ports: Ports) => RunCommands): Promise<readonly string[]> {
  const touched: string[] = [];
  const commands = make(touchingPorts(touched));
  const found: string[] = [];
  for (const name of Object.keys(hostCalls)) {
    if (!(await refusesFirst(commands, touched, name))) found.push(name);
    touched.length = 0;
  }
  return found;
}

describe('run-host commands', () => {
  it('names every member as host-only or person-reachable', () => {
    const members = Object.keys(createRunCommands(touchingPorts([]))).sort();
    expect(members).toEqual([...Object.keys(hostCalls), ...personReachable].sort());
  });

  it('every host-only member refuses a caller who is not the system principal before it touches a port', async () => {
    expect(await ungated(createRunCommands)).toEqual([]);
  });

  it('flags a planted member that touches a port before the gate', async () => {
    const planted = (ports: Ports): RunCommands => ({
      ...createRunCommands(ports),
      halt: () => {
        ports.clock.now();
        return Promise.resolve(refused('not_permitted', {}));
      },
    });
    expect(await ungated(planted)).toEqual(['halt']);
  });

  it('flags a planted member that answers a non-system caller with anything but not_permitted', async () => {
    const planted = (ports: Ports): RunCommands => ({
      ...createRunCommands(ports),
      complete: () => Promise.resolve(refused('run_not_found', { runId })),
    });
    expect(await ungated(planted)).toEqual(['complete']);
  });
});
