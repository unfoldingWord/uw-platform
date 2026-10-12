import type { IssueRef } from '@uw/contracts';
import { ingestPrincipal } from '@uw/core/principal';
import { createClient, type Database } from '@uw/db/client';
import { createMigratedDatabase, testServer } from '@uw/db/test-database';
import { software, type Clock, type KernelOutcome } from '@uw/harness';
import { describe, expect, it } from 'vitest';
import { kernelOn, personOn } from '../testing/kernel.ts';

const ianId = '00000000-0000-4000-8000-000000000001';
const harnessId = '00000000-0000-4000-8000-000000008601';
const issue: IssueRef = { repo: 'unfoldingWord/uw-platform', number: 12, githubId: 9100000012 };
const instant = new Date();
const clock: Clock = { now: () => instant };
const rounds = 5;

type Connections = { readonly one: Database; readonly two: Database };

function valueOf<T>(outcome: KernelOutcome<T>): T {
  if (outcome.status !== 'accepted') throw new Error(`refused: ${outcome.reason}`);
  return outcome.value;
}

async function withConnections(work: (connections: Connections) => Promise<void>) {
  const database = await createMigratedDatabase(testServer ?? '');
  const connections: Connections = {
    one: createClient(database.connectionString),
    two: createClient(database.connectionString),
  };
  try {
    await work(connections);
  } finally {
    await Promise.all(Object.values(connections).map((db) => db.$client.end()));
    await database.drop();
  }
}

async function seedHarness(db: Database): Promise<void> {
  const ian = await personOn(db, ianId, 'ian.lindsley@unfoldingword.org', instant);
  valueOf(
    await kernelOn(db, clock).stages.activate(
      { actor: ian, traceId: crypto.randomUUID() },
      {
        harnessId,
        harnessKey: 'software',
        jdArea: '80-89',
        template: software,
        repository: 'unfoldingWord/uw-platform',
      },
    ),
  );
}

function importOn(db: Database, round: number) {
  return kernelOn(db, clock).items.importIssue(
    { actor: ingestPrincipal(), traceId: crypto.randomUUID() },
    {
      harnessId,
      issue: { ...issue, number: issue.number + round, githubId: issue.githubId + round },
      title: `Wire the board ${round}`,
      pageId: null,
    },
  );
}

async function rowsFor(db: Database, githubId: number) {
  const rows = await db.$client`
    SELECT id FROM harness_items WHERE issue_github_id = ${githubId}`;
  const created = await db.$client`
    SELECT item_id FROM harness_events WHERE name = 'item_created'
    AND (evidence -> 'issue' ->> 'githubId')::bigint = ${githubId}`;
  return { items: rows.length, created: created.length };
}

async function oneItemPerIssue(connections: Connections): Promise<void> {
  await seedHarness(connections.one);
  for (let round = 0; round < rounds; round += 1) {
    const outcomes = await Promise.all([
      importOn(connections.one, round),
      importOn(connections.two, round),
    ]);
    const [first, second] = outcomes.map(valueOf);
    expect([first?.created, second?.created].sort()).toEqual([false, true]);
    expect(first?.item.itemId).toBe(second?.item.itemId);
    expect(await rowsFor(connections.one, issue.githubId + round)).toEqual({
      items: 1,
      created: 1,
    });
  }
}

function removeOn(db: Database, round: number) {
  return kernelOn(db, clock).items.labelRemoved(
    { actor: ingestPrincipal(), traceId: crypto.randomUUID() },
    {
      githubId: issue.githubId + round,
      label: 'harness',
      githubUpdatedAt: new Date(instant.getTime() + round).toISOString(),
    },
  );
}

async function labelEvents(db: Database, githubId: number): Promise<number> {
  const rows = await db.$client`
    SELECT e.id FROM harness_events e JOIN harness_items i ON i.id = e.item_id
    WHERE e.name = 'label_removed' AND i.issue_github_id = ${githubId}`;
  return rows.length;
}

async function oneRemovalPerIssue(connections: Connections): Promise<void> {
  await seedHarness(connections.one);
  for (let round = 0; round < rounds; round += 1) {
    valueOf(await importOn(connections.one, round));
    const outcomes = await Promise.all([
      removeOn(connections.one, round),
      removeOn(connections.two, round),
    ]);
    const recorded = outcomes.map((outcome) => valueOf(outcome).recorded);
    expect(recorded.sort()).toEqual([false, true]);
    expect(await labelEvents(connections.one, issue.githubId + round)).toBe(1);
  }
}

describe.skipIf(!testServer)(
  'GH-3 two label removals of one issue on two connections record one event',
  () => {
    it('answers recorded once and records one label_removed', () =>
      withConnections(oneRemovalPerIssue));
  },
);

describe.skipIf(!testServer)(
  'GH-3 two imports of one issue on two connections make one item',
  () => {
    it('answers created once and the same item to the other import', () =>
      withConnections(oneItemPerIssue));
  },
);
