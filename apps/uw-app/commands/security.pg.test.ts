import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { revokeSeededGrant } from '@uw/db/test-seed';
import { agentOf, kernelOn, personOn } from '../testing/kernel.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { commandHandler, type CommandContext } from './handler.ts';
import { commandRegistryOf } from './registry.ts';
import {
  accepted,
  callerOf,
  command,
  dispatchAs,
  dispatchScope,
  enqueued,
  eventCount,
  eventsNamed,
  ian,
  softwareHarness,
} from '../testing/commands.ts';

function enqueueBody(requestId: string) {
  return { requestId, title: 'Draw the board', pageId: null, due: null };
}

async function contextWithoutEnv(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const itemId = await enqueued(db, scene.harnessId, 'Gate the board');
  const contexts = new Map<string, CommandContext>();
  const capture = (context: CommandContext, name: string) => {
    contexts.set(name, context);
    return Promise.resolve({ ok: true } as const);
  };
  const registry = commandRegistryOf([
    commandHandler({ name: 'enqueue', action: 'write', run: (c) => capture(c, 'enqueue') }),
    commandHandler({ name: 'approve', action: 'admin', run: (c) => capture(c, 'approve') }),
  ]);
  const client = { app: null, transport: null };
  const scope = dispatchScope(db, { registry, gateGitHub: () => client as never });
  const admin = await ian(db);
  await dispatchAs(admin, scene.harnessId, 'enqueue', enqueueBody(randomUUID()), scope);
  const approve = { requestId: randomUUID(), itemId, head: null };
  await dispatchAs(admin, scene.harnessId, 'approve', approve, scope);
  const enqueue = contexts.get('enqueue');
  expect(enqueue).toBeDefined();
  expect(Object.keys(enqueue ?? {})).not.toContain('env');
  expect(enqueue?.gateGitHub()).toBeNull();
  expect(contexts.get('approve')?.gateGitHub()).toBe(client);
}

async function newHarnessScope(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  let runs = 0;
  const registry = commandRegistryOf([
    commandHandler({
      name: 'activate_template',
      action: 'admin',
      scope: 'new_harness',
      run: async (context) => {
        runs += 1;
        expect(context.harness).toBeNull();
        return { ok: true };
      },
    }),
  ]);
  const scope = dispatchScope(db, { registry });
  const body = {
    requestId: randomUUID(),
    harnessKey: 'bml',
    jdArea: '80-89',
    template: 'bml',
    repository: null,
  };
  const editor = await personOn(db, scene.editor.id, scene.editor.email, new Date());
  const fresh = randomUUID();
  const refused = await dispatchAs(editor, fresh, 'activate_template', body, scope);
  expect(refused).toMatchObject({ reason: 'not_permitted' });
  const admitted = await dispatchAs(await ian(db), fresh, 'activate_template', body, scope);
  expect(admitted).toEqual({ status: 'accepted', requestId: body.requestId });
  expect(runs).toBe(1);
}

async function revokedNotReplayed(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const body = enqueueBody(randomUUID());
  const first = await command(db, scene.editor, scene.harnessId, 'enqueue', body);
  expect(first.body).toEqual({ status: 'accepted', requestId: body.requestId });
  await revokeSeededGrant(db, scene.editor.grantId, new Date(Date.now() - 1000));
  const again = await command(db, scene.editor, scene.harnessId, 'enqueue', body);
  expect(again.status).toBe(404);
  expect(again.body).toEqual({
    status: 'error',
    requestId: body.requestId,
    reason: 'harness_not_found',
  });
}

async function foreignItem(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const elsewhere = await enqueued(db, scene.otherHarnessId, 'Not this board');
  const requestId = randomUUID();
  const events = await eventCount(db, scene.otherHarnessId);
  const foreign = await command(db, scene.editor, scene.harnessId, 'claim', {
    requestId,
    itemId: elsewhere,
  });
  const missing = await command(db, scene.editor, scene.harnessId, 'claim', {
    requestId,
    itemId: randomUUID(),
  });
  expect(foreign.status).toBe(404);
  expect(foreign.body).toEqual({ status: 'error', requestId, reason: 'item_not_found' });
  expect(foreign.text).toBe(missing.text);
  expect(await eventCount(db, scene.otherHarnessId)).toBe(events);
}

async function foreignDelegation(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const kernel = kernelOn(db, { now: () => new Date() });
  const grant = { persona: 'agent:iterate', capability: 'iterate' as const };
  const delegation = accepted(
    await kernel.delegations.grant(callerOf(await ian(db)), {
      ...grant,
      harnessId: scene.otherHarnessId,
      expiresAt: null,
      supersedes: null,
    }),
  );
  const requestId = randomUUID();
  const admin = { email: 'ian.lindsley@unfoldingword.org' };
  const revoke = (harnessId: string, delegationId: string) =>
    command(db, admin, harnessId, 'revoke_delegation', { requestId, delegationId });
  const foreign = await revoke(scene.harnessId, delegation.id);
  const missing = await revoke(scene.harnessId, randomUUID());
  expect(foreign.status).toBe(404);
  expect(foreign.body).toEqual({
    status: 'error',
    requestId,
    reason: 'delegation_not_found',
  });
  expect(foreign.text).toBe(missing.text);
  const own = await command(db, admin, scene.otherHarnessId, 'revoke_delegation', {
    requestId: randomUUID(),
    delegationId: delegation.id,
  });
  expect(own.body).toMatchObject({ reason: 'not_wired' });
}

async function malformedHarnessId(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const body = enqueueBody(randomUUID());
  const malformed = await command(db, scene.editor, 'not-a-uuid', 'enqueue', body);
  const missing = await command(db, scene.editor, randomUUID(), 'enqueue', body);
  expect(malformed.status).toBe(404);
  expect(malformed.body).toMatchObject({ reason: 'harness_not_found' });
  expect(malformed.text).toBe(missing.text);
}

async function agentRefused(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const itemId = await enqueued(db, scene.harnessId, 'Hold the board');
  const owner = await personOn(db, scene.editor.id, scene.editor.email, new Date());
  const agent = agentOf(owner, 'builder');
  const scope = dispatchScope(db);
  const events = await eventCount(db, scene.harnessId);
  const enqueue = await dispatchAs(
    agent,
    scene.harnessId,
    'enqueue',
    enqueueBody(randomUUID()),
    scope,
  );
  const claimRequestId = randomUUID();
  const claim = await dispatchAs(
    agent,
    scene.harnessId,
    'claim',
    { requestId: claimRequestId, itemId },
    scope,
  );
  expect(enqueue).toMatchObject({ status: 'error', reason: 'not_permitted' });
  expect(claim).toEqual({
    status: 'error',
    requestId: claimRequestId,
    reason: 'not_permitted',
  });
  expect(await eventCount(db, scene.harnessId)).toBe(events);
  expect(await eventsNamed(db, scene.harnessId, 'item_claimed')).toEqual([]);
}

describe.skipIf(!testServer)(
  'WB-1 the command API resolves scope and can() before the ledger',
  () => {
    it('WB-1 a settled request is not replayed to a caller whose grant was revoked: the refusal answers', () =>
      withAppDatabase(revokedNotReplayed));

    it('WB-1 an item of another harness answers item_not_found, byte-identical to a missing item', () =>
      withAppDatabase(foreignItem));

    it('WB-1 a delegation of another harness answers delegation_not_found, byte-identical to a missing one', () =>
      withAppDatabase(foreignDelegation));

    it('WB-1 a harness id that is not a uuid answers harness_not_found, byte-identical to a missing one', () =>
      withAppDatabase(malformedHarnessId));

    it('WB-1 an agent principal is refused not_permitted on the item commands and nothing is appended', () =>
      withAppDatabase(agentRefused));
  },
);

describe.skipIf(!testServer)('the command context', () => {
  it('carries no environment, and opens the gate GitHub client only for a gate command', () =>
    withAppDatabase(contextWithoutEnv));

  it('resolves a new harness scope from the body area and calls can() on it', () =>
    withAppDatabase(newHarnessScope));
});
