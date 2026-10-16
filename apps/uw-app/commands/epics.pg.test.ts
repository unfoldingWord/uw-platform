import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { recordSubIssues } from '../github/facts/sub-issues.ts';
import { upsertFacts } from '../github/facts/upsert.ts';
import { emptyBatch, type IssueRecord } from '../github/facts/records.ts';
import { labelledIssue, repo } from '../github/testing/facts-fixtures.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { command, eventsNamed, softwareHarness } from '../testing/commands.ts';

const platform = 'unfoldingWord/uw-platform';
const seededAt = new Date('2026-10-15T08:00:00.000Z');

function issue(number: number, overrides: Partial<IssueRecord> = {}): IssueRecord {
  return {
    ...labelledIssue,
    githubId: 9100000300 + number,
    number,
    title: `Issue ${number}`,
    labels: [],
    doneWhen: [`Issue ${number} ships.`],
    ...overrides,
  };
}

async function seedEpic(db: Database): Promise<void> {
  const children = [issue(41), issue(42), issue(43, { blockedBy: [42] })];
  const epic = issue(40, { subIssues: children.length, doneWhen: [] });
  await upsertFacts(db, { ...emptyBatch, repos: [repo], issues: [epic, ...children] }, seededAt);
  await recordSubIssues(db, {
    repoId: repo.githubId,
    parentId: epic.githubId,
    children: children.map((child) => child.githubId),
  });
}

async function epicItems(db: Database) {
  const rows = await db.$client`
    SELECT issue_number, cardinality(blocked_by) AS blockers, epic->>'position' AS position FROM harness_items
    WHERE epic IS NOT NULL ORDER BY (epic->>'position')::int`;
  return rows.map((row) => [
    Number(row['issue_number']),
    Number(row['blockers']),
    Number(row['position']),
  ]);
}

describe.skipIf(!testServer)('EI-3 enqueue_epic through the command API', () => {
  it('enqueues the epic’s sub-issues in order with their blockers for an editor', () =>
    withAppDatabase(async (db) => {
      const { harnessId, editor } = await softwareHarness(db);
      await seedEpic(db);
      const sent = await command(db, editor, harnessId, 'enqueue_epic', {
        requestId: randomUUID(),
        repository: platform,
        number: 40,
      });
      expect(sent.body).toMatchObject({ status: 'accepted' });
      expect(await epicItems(db)).toEqual([
        [41, 0, 0],
        [42, 0, 1],
        [43, 1, 2],
      ]);
      expect(await eventsNamed(db, harnessId, 'epic_enqueued')).toHaveLength(1);
    }));

  it('refuses a viewer by can(), another repository, and an issue that is not an epic', () =>
    withAppDatabase(async (db) => {
      const { harnessId, editor, viewer } = await softwareHarness(db);
      await seedEpic(db);
      const body = { repository: platform, number: 40 };
      const byViewer = await command(db, viewer, harnessId, 'enqueue_epic', {
        requestId: randomUUID(),
        ...body,
      });
      expect(byViewer.body).toMatchObject({ status: 'error', reason: 'not_permitted' });
      const elsewhere = await command(db, editor, harnessId, 'enqueue_epic', {
        requestId: randomUUID(),
        repository: 'unfoldingWord/uw-other',
        number: 40,
      });
      expect(elsewhere.body).toMatchObject({ status: 'error', reason: 'not_permitted' });
      const lone = await command(db, editor, harnessId, 'enqueue_epic', {
        requestId: randomUUID(),
        ...body,
        number: 41,
      });
      expect(lone.body).toMatchObject({ status: 'error', reason: 'not_permitted' });
      expect(await epicItems(db)).toEqual([]);
    }));
});
