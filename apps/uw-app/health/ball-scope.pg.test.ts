import { describe, expect, it } from 'vitest';
import type { HealthIndicator } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { rewriteItem, seedGrant, seedHarness, seedItem, seedPerson } from '@uw/db/test-seed';
import { DEFAULT_SPEND_CAP, type Clock } from '@uw/harness';
import { platformKernel } from '../kernel.ts';
import { personOn } from '../testing/kernel.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { agentPlaneIndicators } from './agent-plane.ts';

const at = new Date('2026-10-15T12:00:00.000Z');
const clock: Clock = { now: () => at };
const HARNESS = '00000000-0000-4000-8000-000000005501';
const ITEM = '00000000-0000-4000-8000-000000005502';
const READER = {
  id: '00000000-0000-4000-8000-000000005511',
  email: 'ball-reader@unfoldingword.org',
};
const STRANGER = {
  id: '00000000-0000-4000-8000-000000005512',
  email: 'ball-stranger@unfoldingword.org',
};

async function seedHeld(db: Database): Promise<void> {
  await seedPerson(db, READER);
  await seedPerson(db, STRANGER);
  await seedGrant(db, {
    id: '00000000-0000-4000-8000-000000005513',
    personId: READER.id,
    role: 'viewer',
    scopeKind: 'jd_area',
    scopeArea: '80-89',
    grantedAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: null,
  });
  await seedHarness(db, { id: HARNESS, key: 'ball-scope', jdArea: '80-89' });
  await seedItem(db, {
    id: ITEM,
    harnessId: HARNESS,
    stageId: '00000000-0000-4000-8000-000000005503',
  });
  await rewriteItem(db, ITEM, {
    gateStatus: 'parked',
    heldSince: new Date(at.getTime() - 25 * 3_600_000),
  });
}

async function heldFor(db: Database, person: typeof READER): Promise<HealthIndicator | undefined> {
  const handle = { db, ping: async () => undefined, release: async () => undefined };
  const caller = { actor: await personOn(db, person.id, person.email, at), traceId: ITEM };
  const kernel = platformKernel(handle, clock);
  const indicators = await agentPlaneIndicators({ kernel, caller, db, at, cap: DEFAULT_SPEND_CAP });
  return indicators.find((indicator) => indicator.name === 'held_by_person');
}

async function scopedToReadable(db: Database): Promise<void> {
  await seedHeld(db);
  expect(await heldFor(db, READER)).toEqual({
    name: 'held_by_person',
    status: 'amber',
    detail: '1 item with a person over 24 hours',
  });
  expect(await heldFor(db, STRANGER)).toEqual({
    name: 'held_by_person',
    status: 'ok',
    detail: 'None over 24 hours',
  });
}

describe.skipIf(!testServer)('the ball indicators on /health', () => {
  it('OB-2 count only the harnesses the viewer may read', () => withAppDatabase(scopedToReadable));
});
