import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { principalSchema, type Principal } from '@uw/contracts';
import { createLogger } from '@uw/core/log';
import { createClient, type Database } from '@uw/db/client';
import { createMigratedDatabase, testServer } from '@uw/db/test-database';
import { seedGrant, seedPage, seedPerson } from '@uw/db/test-seed';
import { DEFAULT_SPEND_CAP, software, type Caller, type Kernel } from '@uw/harness';
import { kernelOn, personOn } from '../testing/kernel.ts';
import { callVerb } from './dispatch.ts';
import { verbHandlers } from './verbs/index.ts';

const IAN = { id: '00000000-0000-4000-8000-000000000001', email: 'ian.lindsley@unfoldingword.org' };
const EDITOR = { id: '00000000-0000-4000-8000-000000002901', email: 'attach@unfoldingword.org' };
const LEARNING = '00000000-0000-4000-8000-000000002911';
const REVISION = '00000000-0000-4000-8000-000000002912';
const clock = { now: () => new Date() };

type Rig = {
  readonly db: Database;
  readonly kernel: Kernel;
  readonly drop: () => Promise<void>;
};

let current: Rig | null = null;

function caller(actor: Principal): Caller {
  return { actor, traceId: crypto.randomUUID() };
}

function value<T>(outcome: { status: 'accepted'; value: T } | { status: 'error'; reason: string }) {
  if (outcome.status !== 'accepted') throw new Error(`refused: ${outcome.reason}`);
  return outcome.value;
}

async function seedWorld(db: Database): Promise<void> {
  await seedPerson(db, EDITOR);
  await seedGrant(db, {
    id: '00000000-0000-4000-8000-000000002902',
    personId: EDITOR.id,
    role: 'editor',
    scopeKind: 'jd_area',
    scopeArea: '80-89',
    grantedAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: null,
  });
  const page = { status: 'suggested' as const, jdArea: '80-89', title: 'Attached' };
  await seedPage(db, {
    ...page,
    id: LEARNING,
    type: 'learning',
    slug: 'attach-learning',
    bodyMd: '- [observed] readers return on Mondays',
  });
  await seedPage(db, {
    ...page,
    id: REVISION,
    type: 'product_strategy',
    slug: 'attach-revision',
    bodyMd: '- readers want shorter guides',
  });
}

async function itemAtClose(kernel: Kernel, ian: Principal): Promise<{ h: string; i: string }> {
  const harnessId = crypto.randomUUID();
  const activation = {
    harnessId,
    harnessKey: 'attach',
    jdArea: '80-89',
    template: software,
    repository: null,
  };
  value(await kernel.stages.activate(caller(ian), activation));
  const change = { feeds: ['close'] };
  value(await kernel.stages.updateStage(caller(ian), { harnessId, stageKey: 'package', change }));
  const input = { harnessId, title: 'Tune', pageId: null, priority: 1, due: null };
  const { itemId } = value(
    await kernel.items.enqueue(caller(ian), { ...input, delegationId: null }),
  );
  value(await kernel.items.claim(caller(ian), { itemId, delegationId: null }));
  const moved = { itemId, to: 'close', evidence: {}, change: null };
  value(await kernel.items.submit(caller(ian), moved));
  return { h: harnessId, i: itemId };
}

async function laptopOf(r: Rig): Promise<Principal> {
  const human = await personOn(r.db, EDITOR.id, EDITOR.email, new Date());
  return principalSchema.parse({
    ...human,
    identity: `agent:${EDITOR.id}/laptop`,
    kind: 'agent',
    email: null,
  });
}

async function submitAs(r: Rig, principal: Principal, args: Record<string, unknown>) {
  const context = {
    principal,
    host: 'external' as const,
    at: new Date(),
    traceId: crypto.randomUUID(),
    kernel: r.kernel,
    db: r.db,
    commit: 'test-commit',
    cap: DEFAULT_SPEND_CAP,
    logger: createLogger(
      { traceId: 'trace', commit: 'test-commit', route: 'POST /mcp', principal: null },
      () => undefined,
    ),
  };
  const [block] = (await callVerb(context, 'submit_to_gate', args, verbHandlers)).content;
  return JSON.parse(block?.type === 'text' ? block.text : '{}') as Record<string, unknown>;
}

beforeAll(async () => {
  if (!testServer) return;
  const database = await createMigratedDatabase(testServer);
  const db = createClient(database.connectionString);
  await seedWorld(db);
  const drop = async () => {
    await db.$client.end();
    await database.drop();
  };
  current = { db, kernel: kernelOn(db, clock), drop };
});

afterAll(async () => {
  await current?.drop();
});

describe.skipIf(!testServer)('submit_to_gate attachments', () => {
  it('PE-7 submit_to_gate attaches pages before its validators run', async () => {
    if (current === null) throw new Error('the rig is not open');
    const r = current;
    const ian = await personOn(r.db, IAN.id, IAN.email, new Date());
    const { h, i } = await itemAtClose(r.kernel, ian);
    const laptop = await laptopOf(r);
    value(await r.kernel.items.claim(caller(laptop), { itemId: i, delegationId: null }));
    const submitted = await submitAs(r, laptop, {
      itemId: i,
      evidence: {},
      to: 'scope',
      pullRequest: null,
      head: null,
      attach: [LEARNING, REVISION],
    });
    expect(submitted).toEqual({
      itemId: i,
      result: 'checks_failed',
      failures: [
        `learning_attached: revision ${REVISION} has a claim without an evidence label: readers want shorter guides`,
      ],
    });
    const events = await r.kernel.events.read(caller(ian), {
      harnessId: h,
      itemId: i,
      after: 0,
      limit: 100,
    });
    const names = value(events).events.map((event) => event.name);
    expect(names.slice(-4)).toEqual([
      'learning_attached',
      'learning_attached',
      'submitted_to_gate',
      'checks_failed',
    ]);
  });
});
