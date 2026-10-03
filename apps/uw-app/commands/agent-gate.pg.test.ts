import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  commandNameSchema,
  delegatedIdentity,
  principalSchema,
  type Principal,
} from '@uw/contracts';
import { createLogger } from '@uw/core/log';
import type { Database } from '@uw/db/client';
import { decisionRows } from '../github/testing/ship-rig.ts';
import { parkedAtShip, type ParkedAtShip } from '../github/testing/gate-rig.ts';
import {
  accepted,
  allEvents,
  callerOf,
  dispatchAs,
  dispatchScope,
  eventCount,
  itemState,
} from '../testing/commands.ts';
import { agentOf, kernelOn } from '../testing/kernel.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { hubNotWired } from '../ports/hub.not-wired.ts';
import { commandRegistry } from './registry.ts';

function agent(
  identity: string,
  owner: Principal,
  personId: string | null,
  interactive: boolean,
): Principal {
  return principalSchema.parse({
    identity,
    kind: 'agent',
    personId,
    email: null,
    grants: owner.grants,
    interactive,
  });
}

async function readingAgents(db: Database, parked: ParkedAtShip): Promise<Principal[]> {
  const owner = parked.ian;
  const kernel = kernelOn(db, { now: () => new Date() });
  const input = {
    harnessId: parked.item.harnessId,
    persona: 'agent:builder',
    capability: 'iterate' as const,
  };
  const delegation = accepted(
    await kernel.delegations.grant(callerOf(owner), {
      ...input,
      expiresAt: null,
      supersedes: null,
    }),
  );
  const device = `agent:${owner.personId}/laptop`;
  return [
    agentOf(owner, 'laptop'),
    agent('agent:builder', owner, owner.personId, false),
    agent(delegatedIdentity(device, 'builder', delegation.id), owner, owner.personId, false),
  ];
}

function hiddenFromAgents(owner: Principal): Principal[] {
  return [
    agent('agent:system', { ...owner, grants: [] }, null, false),
    agent('agent:ingest', owner, null, false),
    agent('agent:reviewer', owner, owner.personId, false),
    agent(`agent:${owner.personId}/runner`, owner, owner.personId, false),
    { ...agentOf(owner, 'laptop'), grants: [] },
  ];
}

function gateAttempts(
  head: string | null,
): ReadonlyArray<readonly [string, Record<string, unknown>]> {
  return [
    ['approve', { head }],
    ['reject', { findings: ['Looks wrong'] }],
    ['take_over', {}],
    ['override', { head, reason: 'urgent' }],
  ];
}

type Opener = { readonly opened: () => number; readonly scope: ReturnType<typeof dispatchScope> };

function countingOpener(db: Database): Opener {
  let calls = 0;
  const scope = dispatchScope(db, {
    gateGitHub: () => {
      calls += 1;
      return null;
    },
  });
  return { opened: () => calls, scope };
}

async function attempt(
  parked: ParkedAtShip,
  actor: Principal,
  opener: Opener,
  [name, extra]: readonly [string, Record<string, unknown>],
) {
  const requestId = randomUUID();
  const body = { requestId, itemId: parked.item.itemId, ...extra };
  const outcome = await dispatchAs(actor, parked.item.harnessId, name, body, opener.scope);
  return { requestId, outcome };
}

async function agentsRecorded(db: Database): Promise<void> {
  const parked = await parkedAtShip(db);
  const opener = countingOpener(db);
  const expected: Array<{ actor: string; requestId: string; decision: string }> = [];
  for (const actor of await readingAgents(db, parked)) {
    for (const command of gateAttempts(parked.item.expectedHead)) {
      const { requestId, outcome } = await attempt(parked, actor, opener, command);
      expect(outcome).toEqual({ status: 'error', requestId, reason: 'gate_refused_to_agent' });
      expected.push({ actor: actor.identity, requestId, decision: command[0] });
    }
  }
  const refusals = (await allEvents(db, parked.item.harnessId)).filter(
    (event) => event.name === 'gate_refused_to_agent',
  );
  expect(
    refusals.map((event) => ({
      actor: event.actor,
      requestId: event.requestId,
      decision: (event.evidence as { decision: string }).decision,
    })),
  ).toEqual(expected);
  expect(await decisionRows(db, parked.item)).toBe(0);
  expect(opener.opened()).toBe(0);
  expect(await itemState(db, parked.item.itemId)).toMatchObject({
    gateStatus: 'parked',
    holder: null,
  });
}

function otherAttempts(itemId: string): ReadonlyArray<readonly [string, Record<string, unknown>]> {
  return [
    ['recover_connectors', {}],
    ['enqueue', { title: 'Sneak an item', pageId: null, due: null }],
    ['claim', { itemId }],
    ['release', { itemId }],
    ['submit_to_gate', { itemId, to: null, pullRequest: null, head: null }],
    ['pause', { stageKey: null }],
    ['revoke_delegation', { delegationId: randomUUID() }],
  ];
}

async function agentsRefusedElsewhere(db: Database): Promise<void> {
  const parked = await parkedAtShip(db);
  const opener = countingOpener(db);
  const actors = await readingAgents(db, parked);
  const before = await eventCount(db, parked.item.harnessId);
  for (const actor of [...actors, ...hiddenFromAgents(parked.ian)]) {
    for (const [name, extra] of otherAttempts(parked.item.itemId)) {
      const requestId = randomUUID();
      const body = { requestId, ...extra };
      const outcome = await dispatchAs(actor, parked.item.harnessId, name, body, opener.scope);
      expect(outcome).toMatchObject({ status: 'error', requestId });
      expect(['not_permitted', 'harness_not_found']).toContain(
        outcome.status === 'error' ? outcome.reason : null,
      );
      if (actors.includes(actor)) expect(outcome).toMatchObject({ reason: 'not_permitted' });
    }
  }
  expect(await eventCount(db, parked.item.harnessId)).toBe(before);
  expect(opener.opened()).toBe(0);
  const ledger = await db.$client`SELECT count(*)::int AS n FROM command_requests`;
  expect(Number(ledger[0]?.n)).toBe(0);
}

async function unreadableHarness(db: Database): Promise<void> {
  const parked = await parkedAtShip(db);
  const opener = countingOpener(db);
  const before = await eventCount(db, parked.item.harnessId);
  for (const actor of hiddenFromAgents(parked.ian)) {
    for (const command of gateAttempts(parked.item.expectedHead)) {
      const { requestId, outcome } = await attempt(parked, actor, opener, command);
      expect(outcome).toEqual({ status: 'error', requestId, reason: 'harness_not_found' });
    }
  }
  expect(await eventCount(db, parked.item.harnessId)).toBe(before);
  expect(await decisionRows(db, parked.item)).toBe(0);
  expect(opener.opened()).toBe(0);
}

function directContext(db: Database, parked: ParkedAtShip, opened: () => void) {
  const clock = { now: () => new Date() };
  return {
    kernel: kernelOn(db, clock),
    harnessId: parked.item.harnessId,
    harness: null,
    stages: [],
    database: { db, ping: async () => undefined, release: async () => undefined },
    gateGitHub: () => {
      opened();
      return null;
    },
    hub: hubNotWired,
    clock,
    logger: createLogger(
      { traceId: randomUUID(), commit: 'test', route: 'direct', principal: null },
      () => undefined,
    ),
  };
}

function handlerOf(name: string) {
  const parsed = commandNameSchema.parse(name);
  const handler = commandRegistry.get(parsed);
  if (handler === undefined) throw new Error(`no handler for ${name}`);
  return handler;
}

async function handlersOpenNothingForAgents(db: Database): Promise<void> {
  const parked = await parkedAtShip(db);
  let calls = 0;
  const context = directContext(db, parked, () => (calls += 1));
  const commands = [...gateAttempts(parked.item.expectedHead), ['recover_connectors', {}] as const];
  for (const actor of await readingAgents(db, parked)) {
    for (const [name, extra] of commands) {
      const requestId = randomUUID();
      const caller = { actor, traceId: randomUUID(), requestId };
      const body = { command: name, requestId, itemId: parked.item.itemId, ...extra };
      const run = name === 'recover_connectors' ? { command: name, requestId } : body;
      const result = await handlerOf(name).run({ ...context, caller }, run);
      expect(result).toMatchObject({ ok: false });
    }
  }
  expect(calls).toBe(0);
  expect(await decisionRows(db, parked.item)).toBe(0);
  const caller = { actor: parked.kim, traceId: randomUUID(), requestId: randomUUID() };
  const body = { command: 'take_over', requestId: caller.requestId, itemId: parked.item.itemId };
  expect(await handlerOf('take_over').run({ ...context, caller }, body)).toEqual({ ok: true });
  expect(calls).toBe(1);
}

describe.skipIf(!testServer)(
  'the gate commands build a kernel with GitHub only for a person',
  () => {
    it('never opens the gate GitHub for an agent caller, even when the context offers it', () =>
      withAppDatabase(handlersOpenNothingForAgents));
  },
);

describe.skipIf(!testServer)('WB-1 an agent principal on the command API decides no gate', () => {
  it('WB-1 an agent principal on a gate command reaches the kernel, which records gate_refused_to_agent and decides nothing', () =>
    withAppDatabase(agentsRecorded));

  it('WB-1 an agent principal on any other command is not_permitted and appends nothing', () =>
    withAppDatabase(agentsRefusedElsewhere));

  it('WB-1 an agent that cannot read the harness gets harness_not_found and nothing is recorded', () =>
    withAppDatabase(unreadableHarness));
});
