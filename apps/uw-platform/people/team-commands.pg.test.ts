import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { personCommitments, staffAllocations } from '@uw/db/schema';
import { post } from '../testing/commands.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { teamWorld, type TeamPerson, type TeamWorld } from '../testing/team.ts';

const ENDPOINT = '/api/team/commands';

async function inWorld(work: (world: TeamWorld) => Promise<void>): Promise<void> {
  await withAppDatabase(async (db: Database) => work(await teamWorld(db)));
}

function send(world: TeamWorld, by: TeamPerson, name: string, body: Record<string, unknown>) {
  return post(world.db, by.email, `${ENDPOINT}/${name}`, {
    command: name,
    requestId: randomUUID(),
    ...body,
  });
}

async function commitmentsOf(world: TeamWorld, from: TeamPerson) {
  return world.db
    .select()
    .from(personCommitments)
    .where(eq(personCommitments.fromPersonId, from.id));
}

async function allocationsOf(world: TeamWorld, person: TeamPerson) {
  return world.db.select().from(staffAllocations).where(eq(staffAllocations.personId, person.id));
}

async function selfWritesOwnCommitments(world: TeamWorld): Promise<void> {
  const byId = { fromPersonId: world.lee.id, toPersonId: world.ada.id, toText: null };
  expect((await send(world, world.lee, 'add_commitment', byId)).body).toMatchObject({
    status: 'accepted',
  });
  const byText = { fromPersonId: world.lee.id, toPersonId: null, toText: 'Region One team' };
  expect((await send(world, world.lee, 'add_commitment', byText)).body).toMatchObject({
    status: 'accepted',
  });
  const rows = await commitmentsOf(world, world.lee);
  expect(rows.map((row) => [row.toPersonId, row.toText]).sort()).toEqual(
    [
      [null, 'Region One team'],
      [null, 'Sam'],
      [world.ada.id, null],
    ].sort(),
  );
  expect(rows.every((row) => row.updatedBy.startsWith('human:'))).toBe(true);
  const added = rows.find((row) => row.toPersonId === world.ada.id);
  const removed = await send(world, world.lee, 'remove_commitment', { commitmentId: added?.id });
  expect(removed.body).toMatchObject({ status: 'accepted' });
  expect(await commitmentsOf(world, world.lee)).toHaveLength(2);
}

async function othersCommitmentsRefused(world: TeamWorld): Promise<void> {
  const forAda = { fromPersonId: world.ada.id, toPersonId: world.lee.id, toText: null };
  expect((await send(world, world.lee, 'add_commitment', forAda)).body).toMatchObject({
    status: 'error',
    reason: 'not_permitted',
  });
  const [adas] = await commitmentsOf(world, world.ada);
  const removed = await send(world, world.lee, 'remove_commitment', { commitmentId: adas?.id });
  expect(removed.body).toMatchObject({ status: 'error', reason: 'not_permitted' });
  const toSelf = { fromPersonId: world.lee.id, toPersonId: world.lee.id, toText: null };
  expect((await send(world, world.lee, 'add_commitment', toSelf)).body).toMatchObject({
    status: 'error',
    reason: 'invalid_value',
  });
  const both = { fromPersonId: world.lee.id, toPersonId: world.ada.id, toText: 'Ada' };
  expect((await send(world, world.lee, 'add_commitment', both)).body).toMatchObject({
    reason: 'malformed_command',
  });
}

async function stewardWritesAnyone(world: TeamWorld): Promise<void> {
  const forAda = { fromPersonId: world.ada.id, toPersonId: world.lee.id, toText: null };
  expect((await send(world, world.steward, 'add_commitment', forAda)).body).toMatchObject({
    status: 'accepted',
  });
  const set = {
    personId: world.lee.id,
    target: { kind: 'program', pageId: world.programAlpha },
    percent: 50,
  };
  expect((await send(world, world.steward, 'set_staff_allocation', set)).body).toMatchObject({
    status: 'accepted',
  });
  const again = { ...set, percent: null };
  expect((await send(world, world.steward, 'set_staff_allocation', again)).body).toMatchObject({
    status: 'accepted',
  });
  const [only, ...rest] = await allocationsOf(world, world.lee);
  expect(rest).toEqual([]);
  expect([only?.programPageId, only?.percent]).toEqual([world.programAlpha, null]);
  const removed = await send(world, world.steward, 'remove_staff_allocation', {
    allocationId: only?.id,
  });
  expect(removed.body).toMatchObject({ status: 'accepted' });
  expect(await allocationsOf(world, world.lee)).toEqual([]);
}

async function allocationsGuarded(world: TeamWorld): Promise<void> {
  const set = {
    personId: world.lee.id,
    target: { kind: 'program', pageId: world.programAlpha },
    percent: 30,
  };
  expect((await send(world, world.lee, 'set_staff_allocation', set)).body).toMatchObject({
    status: 'error',
    reason: 'not_permitted',
  });
  const wrongKind = { ...set, target: { kind: 'program', pageId: world.portfolioOne } };
  expect((await send(world, world.steward, 'set_staff_allocation', wrongKind)).body).toMatchObject({
    status: 'error',
    reason: 'invalid_value',
  });
  const retired = { ...set, target: { kind: 'program', pageId: world.programRetired } };
  expect((await send(world, world.steward, 'set_staff_allocation', retired)).body).toMatchObject({
    status: 'error',
    reason: 'page_not_found',
  });
  const over = { ...set, percent: 101 };
  expect((await send(world, world.steward, 'set_staff_allocation', over)).body).toMatchObject({
    reason: 'malformed_command',
  });
  const unknown = { allocationId: randomUUID() };
  expect((await send(world, world.steward, 'remove_staff_allocation', unknown)).body).toMatchObject(
    { status: 'error', reason: 'row_not_found' },
  );
}

describe.skipIf(!testServer)('#200 who writes commitments and staff allocations', () => {
  it('#200 a person adds and removes their own commitments, by id or by text', () =>
    inWorld(selfWritesOwnCommitments));
  it('#200 a person cannot write another person’s commitments, nor commit to themself', () =>
    inWorld(othersCommitmentsRefused));
  it('#200 the directory steward writes anyone’s commitments and sets and removes allocations', () =>
    inWorld(stewardWritesAnyone));
  it('#200 an allocation is refused to anyone but a steward, and to a wrong, retired or bad target', () =>
    inWorld(allocationsGuarded));
});
