import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { declarationOf } from './declarations.ts';
import { closeEmbeddedTemplate } from './embedded.ts';
import { pgConstraint, pgErrorCode } from './errors.ts';
import { commandRequests } from './schema.ts';
import { databaseTargets, type DatabaseTarget, type OpenedDatabase } from './test-targets.ts';

afterAll(closeEmbeddedTemplate);

const at = new Date('2026-10-03T09:00:00.000Z');
const requestId = '00000000-0000-4000-8000-0000000000a1';
const harnessId = '00000000-0000-4000-8000-0000000000b1';
const traceId = '00000000-0000-4000-8000-0000000000e1';

type Claim = typeof commandRequests.$inferInsert;

const claimed: Claim = {
  actor: 'human:00000000-0000-4000-8000-000000000001',
  requestId,
  command: 'approve',
  harnessId,
  outcome: null,
  traceId,
  claimedAt: at,
  settledAt: null,
};

async function refusal(
  work: PromiseLike<unknown>,
): Promise<{ code: string | null; constraint: string | null }> {
  try {
    await work;
  } catch (error) {
    return { code: pgErrorCode(error), constraint: pgConstraint(error) };
  }
  throw new Error('expected the database to refuse');
}

type Insert = (row: Partial<Claim>) => PromiseLike<unknown>;

function describeOutcomeBound(insert: Insert): void {
  it('stores a settled outcome of 16384 bytes and refuses one a byte longer', async () => {
    const settled = (n: number, reason: string) =>
      insert({
        requestId: `00000000-0000-4000-8000-0000000000${n}`,
        settledAt: at,
        outcome: { reason },
      });
    const frame = JSON.stringify({ reason: '' }).length + 1;
    await settled(10, 'x'.repeat(16_384 - frame));
    expect(await refusal(settled(11, 'x'.repeat(16_385 - frame)))).toEqual({
      code: '23514',
      constraint: 'command_requests_outcome_bounded',
    });
  });
}

function describeTarget(target: DatabaseTarget): void {
  let opened: OpenedDatabase | undefined;
  beforeAll(async () => {
    opened = await target.open();
  }, 60_000);
  afterAll(() => opened?.close());
  const insert = (row: Partial<Claim>) => {
    if (!opened) throw new Error('the database did not open');
    return opened.db.insert(commandRequests).values({ ...claimed, ...row });
  };
  describeOutcomeBound(insert);

  it('keeps one row per actor and requestId, and lets another actor use the same requestId', async () => {
    await insert({});
    expect(await refusal(insert({}))).toEqual({
      code: '23505',
      constraint: 'command_requests_pkey',
    });
    await insert({ actor: 'human:00000000-0000-4000-8000-000000000002' });
  });

  it('refuses a command outside the command names', async () => {
    const unknown = insert({ requestId: '00000000-0000-4000-8000-0000000000a2', command: 'merge' });
    expect(await refusal(unknown)).toEqual({
      code: '23514',
      constraint: 'command_requests_command_known',
    });
  });

  it('refuses an outcome without a settled instant, and a settled instant without an outcome', async () => {
    const outcomeOnly = insert({
      requestId: '00000000-0000-4000-8000-0000000000a3',
      outcome: { status: 'accepted', requestId },
    });
    const settledOnly = insert({
      requestId: '00000000-0000-4000-8000-0000000000a4',
      settledAt: at,
    });
    const named = { code: '23514', constraint: 'command_requests_settled_with_outcome' };
    expect(await refusal(outcomeOnly)).toEqual(named);
    expect(await refusal(settledOnly)).toEqual(named);
  });

  it('refuses an actor that is not an identity', async () => {
    const forged = insert({ requestId: '00000000-0000-4000-8000-0000000000a5', actor: 'ian' });
    expect(await refusal(forged)).toEqual({
      code: '23514',
      constraint: 'command_requests_actor_is_identity',
    });
  });
}

describe('the command_requests ledger', () => {
  it('is internal and never offline', () => {
    expect(declarationOf(commandRequests)).toEqual({
      classification: 'internal',
      offlineEligibility: 'never',
    });
  });

  describe.each(databaseTargets)('on the $name database', describeTarget);
});
