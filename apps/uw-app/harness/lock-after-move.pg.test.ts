import { defaultCiChecks } from '@uw/contracts';
import type { ItemState, Principal } from '@uw/contracts';
import { ingestPrincipal } from '@uw/core/principal';
import { createClient, type Database } from '@uw/db/client';
import { lockWaiters } from '@uw/db/store';
import { createMigratedDatabase, testServer } from '@uw/db/test-database';
import { software, type Caller, type Clock, type Kernel, type KernelOutcome } from '@uw/harness';
import { describe, expect, it } from 'vitest';
import { awaitBlocked } from '../../../packages/harness/port-contracts/lock-wait.ts';
import { listForDispatch } from '../testing/dispatch.ts';
import { agentOf, kernelOn, personOn } from '../testing/kernel.ts';

const ianId = '00000000-0000-4000-8000-000000000001';
const instant = new Date();
const clock: Clock = { now: () => instant };
const issue = { repo: 'unfoldingWord/uw-platform', number: 31, githubId: 9100000031 };

type Scene = {
  readonly actor: Database;
  readonly mover: Database;
  readonly observer: Database;
  readonly kernel: Kernel;
  readonly ian: Principal;
  readonly harnessId: string;
};

function caller(actor: Principal): Caller {
  return { actor, traceId: crypto.randomUUID() };
}

function accepted<T>(outcome: KernelOutcome<T>, what: string): T {
  if (outcome.status !== 'accepted') throw new Error(`${what} was refused: ${outcome.reason}`);
  return outcome.value;
}

async function sceneOn(actor: Database, mover: Database, observer: Database): Promise<Scene> {
  const ian = await personOn(actor, ianId, 'ian.lindsley@unfoldingword.org', instant);
  const kernel = kernelOn(actor, clock);
  const harnessId = crypto.randomUUID();
  accepted(
    await kernel.stages.activate(caller(ian), {
      harnessId,
      harnessKey: 'software',
      jdArea: '80-89',
      template: software,
      repository: 'unfoldingWord/uw-platform',
      requiredChecks: [...defaultCiChecks],
    }),
    'activate',
  );
  await listForDispatch(actor, 'unfoldingWord/uw-platform');
  return { actor, mover, observer, kernel, ian, harnessId };
}

async function inScene(work: (scene: Scene) => Promise<void>): Promise<void> {
  const database = await createMigratedDatabase(testServer ?? '');
  const [actor, mover, observer] = [1, 2, 3].map(() => createClient(database.connectionString));
  if (actor === undefined || mover === undefined || observer === undefined) return;
  try {
    await work(await sceneOn(actor, mover, observer));
  } finally {
    await Promise.all([actor, mover, observer].map((db) => db.$client.end()));
    await database.drop();
  }
}

async function enqueued(scene: Scene): Promise<ItemState> {
  return accepted(
    await scene.kernel.items.enqueue(caller(scene.ian), {
      harnessId: scene.harnessId,
      title: 'Show the board',
      pageId: null,
      priority: 1,
      due: null,
      delegationId: null,
    }),
    'enqueue',
  );
}

async function claimedByIan(scene: Scene): Promise<ItemState> {
  const item = await enqueued(scene);
  accepted(
    await scene.kernel.items.claim(caller(scene.ian), { itemId: item.itemId, delegationId: null }),
    'claim',
  );
  return item;
}

async function atScope(scene: Scene): Promise<ItemState> {
  const item = await claimedByIan(scene);
  const submitted = await scene.kernel.items.submit(caller(scene.ian), {
    itemId: item.itemId,
    to: null,
    evidence: {},
    change: null,
  });
  expect(accepted(submitted, 'submit').item.stageKey).toBe('scope');
  return item;
}

async function heldMove(scene: Scene, itemId: string, to: string): Promise<() => Promise<void>> {
  let release: () => void = () => undefined;
  let moved: () => void = () => undefined;
  const released = new Promise<void>((resolve) => void (release = resolve));
  const ready = new Promise<void>((resolve) => void (moved = resolve));
  const done = scene.mover.$client.begin(async (sql) => {
    await sql`
      UPDATE harness_items SET stage_id = (
        SELECT s.id FROM harness_stages s WHERE s.harness_id = ${scene.harnessId} AND s.key = ${to}
      ) WHERE id = ${itemId}`;
    moved();
    await released;
  });
  await ready;
  return async () => {
    release();
    await done;
  };
}

async function againstAMove<T>(
  scene: Scene,
  move: { readonly itemId: string; readonly to: string },
  command: () => Promise<T>,
): Promise<T> {
  const release = await heldMove(scene, move.itemId, move.to);
  const pending = command();
  await awaitBlocked(() => lockWaiters(scene.observer));
  await release();
  return pending;
}

async function eventCount(scene: Scene, itemId: string, name: string): Promise<number> {
  const rows = await scene.observer.$client`
    SELECT count(*)::int AS n FROM harness_events WHERE item_id = ${itemId} AND name = ${name}`;
  return Number(rows[0]?.['n']);
}

function decideAs(scene: Scene, who: Principal, itemId: string) {
  return scene.kernel.gates.decide(caller(who), {
    itemId,
    decision: who.kind === 'agent' ? 'approve' : 'take_over',
    reason: null,
    findings: [],
  });
}

const serverIt = (title: string, work: (scene: Scene) => Promise<void>) =>
  it(title, () => inScene(work));

describe.skipIf(!testServer)('an item lock that waited on a stage move finds the item', () => {
  serverIt('labelRemoved records label_removed after a concurrent stage move', async (scene) => {
    const imported = accepted(
      await scene.kernel.items.importIssue(
        { actor: ingestPrincipal(), traceId: crypto.randomUUID() },
        { harnessId: scene.harnessId, issue, title: 'Wire the board', pageId: null },
      ),
      'import',
    );
    const { itemId } = imported.item;
    const removed = await againstAMove(scene, { itemId, to: 'scope' }, () =>
      scene.kernel.items.labelRemoved(
        { actor: ingestPrincipal(), traceId: crypto.randomUUID() },
        { githubId: issue.githubId, label: 'harness', githubUpdatedAt: instant.toISOString() },
      ),
    );
    expect(accepted(removed, 'labelRemoved').recorded).toBe(true);
    expect(await eventCount(scene, itemId, 'label_removed')).toBe(1);
  });

  serverIt('decide answers that the item moved', async (scene) => {
    const { itemId } = await enqueued(scene);
    const outcome = await againstAMove(scene, { itemId, to: 'scope' }, () =>
      decideAs(scene, scene.ian, itemId),
    );
    expect(outcome).toMatchObject({ status: 'error', reason: 'item_not_at_gate' });
    expect(outcome.status === 'error' && outcome.detail).toMatchObject({ why: 'moved' });
  });

  serverIt('an agent decide is refused and its audit event recorded', async (scene) => {
    const { itemId } = await enqueued(scene);
    const agent = agentOf(scene.ian, 'builder');
    const outcome = await againstAMove(scene, { itemId, to: 'scope' }, () =>
      decideAs(scene, agent, itemId),
    );
    expect(outcome).toMatchObject({ status: 'error', reason: 'gate_refused_to_agent' });
    expect(await eventCount(scene, itemId, 'gate_refused_to_agent')).toBe(1);
  });
});

describe.skipIf(!testServer)('an item verb that waited on a stage move answers it', () => {
  serverIt('claim answers not_permitted moved', async (scene) => {
    const { itemId } = await atScope(scene);
    const agent = agentOf(scene.ian, 'builder');
    const outcome = await againstAMove(scene, { itemId, to: 'plan' }, () =>
      scene.kernel.items.claim(caller(agent), { itemId, delegationId: null }),
    );
    expect(outcome).toMatchObject({ status: 'error', reason: 'not_permitted' });
    expect(outcome.status === 'error' && outcome.detail).toMatchObject({ why: 'moved' });
  });

  serverIt('release releases the moved item', async (scene) => {
    const { itemId } = await claimedByIan(scene);
    const outcome = await againstAMove(scene, { itemId, to: 'scope' }, () =>
      scene.kernel.items.release(caller(scene.ian), { itemId, delegationId: null }),
    );
    expect(accepted(outcome, 'release')).toMatchObject({ stageKey: 'scope', holder: null });
  });

  serverIt('submit submits from the stage the item moved to', async (scene) => {
    const { itemId } = await claimedByIan(scene);
    const outcome = await againstAMove(scene, { itemId, to: 'scope' }, () =>
      scene.kernel.items.submit(caller(scene.ian), {
        itemId,
        to: null,
        evidence: {},
        change: null,
      }),
    );
    expect(outcome).toMatchObject({ status: 'accepted', value: { item: { stageKey: 'plan' } } });
  });

  serverIt('a learning verb answers for the moved item', async (scene) => {
    const { itemId } = await claimedByIan(scene);
    const outcome = await againstAMove(scene, { itemId, to: 'scope' }, () =>
      scene.kernel.items.markNothingLearned(caller(scene.ian), { itemId, reason: 'a dry run' }),
    );
    expect(outcome).toMatchObject({ status: 'accepted', value: { stageKey: 'scope' } });
  });

  serverIt('renew renews the lease on the moved item', async (scene) => {
    const { itemId } = await atScope(scene);
    const agent = agentOf(scene.ian, 'builder');
    accepted(
      await scene.kernel.items.claim(caller(agent), { itemId, delegationId: null }),
      'claim',
    );
    const outcome = await againstAMove(scene, { itemId, to: 'plan' }, () =>
      scene.kernel.items.renewLease(caller(agent), { itemId }),
    );
    expect(outcome.status).toBe('accepted');
  });
});
