import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeEmbeddedTemplate } from './embedded.ts';
import { pgConstraint, pgErrorCode } from './errors.ts';
import { harnessEvents, workflowDrafts } from './schema.ts';
import { seedHarness, seedPerson } from './test-seed.ts';
import { databaseTargets, type DatabaseTarget, type OpenedDatabase } from './test-targets.ts';

afterAll(closeEmbeddedTemplate);

const harnessId = '00000000-0000-4000-8000-0000000000d1';
const personId = '00000000-0000-4000-8000-0000000000f1';
const startedAt = new Date('2026-11-16T09:00:00.000Z');

type Draft = typeof workflowDrafts.$inferInsert;

const draft: Draft = {
  harnessId,
  holderPersonId: personId,
  startedAt,
  touchedAt: startedAt,
  revision: 1,
  stages: [],
  base: [],
};

async function refusal(work: PromiseLike<unknown>): Promise<string | null> {
  try {
    await work;
  } catch (error) {
    expect(pgErrorCode(error)).toBe('23514');
    return pgConstraint(error);
  }
  throw new Error('expected the database to refuse');
}

function describeTarget(target: DatabaseTarget): void {
  let opened: OpenedDatabase | undefined;
  const db = () => {
    if (!opened) throw new Error('the database did not open');
    return opened.db;
  };
  beforeAll(async () => {
    opened = await target.open();
    await seedPerson(db(), { id: personId, email: 'drafter@example.org' });
    await seedHarness(db(), { id: harnessId, key: 'drafted', jdArea: '80-89' });
  }, 60_000);
  afterAll(() => opened?.close());

  it('#103 refuses a revision below 1, a touch before the start and a non-array of stages', async () => {
    const insert = (row: Partial<Draft>) =>
      db()
        .insert(workflowDrafts)
        .values({ ...draft, ...row });
    expect(await refusal(insert({ revision: 0 }))).toBe('workflow_drafts_revision_positive');
    expect(await refusal(insert({ touchedAt: new Date('2026-11-16T08:00:00.000Z') }))).toBe(
      'workflow_drafts_touched_after_start',
    );
    expect(await refusal(insert({ stages: {} }))).toBe('workflow_drafts_stages_bounded');
    expect(await refusal(insert({ base: Array.from({ length: 51 }, () => ({})) }))).toBe(
      'workflow_drafts_base_bounded',
    );
  });

  it('#103 keeps one draft per workflow', async () => {
    await db().insert(workflowDrafts).values(draft);
    await expect(db().insert(workflowDrafts).values(draft)).rejects.toThrow();
  });

  it('#103 the event log admits the draft and publish events', () => recordsEvents(db));
}

async function recordsEvents(db: () => OpenedDatabase['db']): Promise<void> {
  for (const [n, name] of [
    'workflow_draft_opened',
    'workflow_draft_saved',
    'workflow_draft_taken_over',
    'workflow_draft_discarded',
    'workflow_published',
  ].entries()) {
    await db()
      .insert(harnessEvents)
      .values({
        id: `00000000-0000-4000-8000-0000000003${String(n).padStart(2, '0')}`,
        harnessId,
        itemId: null,
        name,
        position: n + 1,
        at: startedAt,
        actor: `human:${personId}`,
        evidence: {},
        traceId: '00000000-0000-4000-8000-0000000000e1',
        requestId: null,
      });
  }
}

describe.each(databaseTargets.map((target) => [target.name, target] as const))(
  'the workflow_drafts table on %s',
  (_name, target) => describeTarget(target),
);
