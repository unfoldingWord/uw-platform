import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { command } from '../testing/commands.ts';

const IAN = { email: 'ian.lindsley@unfoldingword.org' };
const IAN_ID = '00000000-0000-4000-8000-000000000001';

type PersonaRow = {
  readonly slug: string;
  readonly status: string;
  readonly identity: string;
  readonly harness: string;
  readonly owner: string;
  readonly toolset: readonly string[];
  readonly requires: readonly string[];
};

function activation(template: 'software' | 'bml', harnessKey: string, jdArea: string) {
  const repository = template === 'software' ? `unfoldingWord/${harnessKey}` : null;
  return { requestId: randomUUID(), harnessKey, jdArea, template, repository };
}

async function activate(
  db: Database,
  template: 'software' | 'bml',
  key: string,
  jdArea: string,
): Promise<string> {
  const harnessId = randomUUID();
  const sent = await command(
    db,
    IAN,
    harnessId,
    'activate_template',
    activation(template, key, jdArea),
  );
  expect(sent.body['status']).toBe('accepted');
  return harnessId;
}

async function personasIn(db: Database, jdArea: string): Promise<readonly PersonaRow[]> {
  return db.execute<PersonaRow>(sql`
    SELECT slug, status, frontmatter->>'identity' AS identity, frontmatter->>'harness' AS harness,
      frontmatter->>'owner' AS owner, frontmatter->'toolset' AS toolset,
      frontmatter->'requires_tools' AS requires
    FROM pages WHERE type = 'persona' AND jd_area = ${jdArea} ORDER BY slug`);
}

async function draftsSoftware(db: Database): Promise<void> {
  const harnessId = await activate(db, 'software', 'drafting', '50-59');
  const rows = await personasIn(db, '50-59');
  expect(rows.map((row) => [row.slug, row.status, row.identity])).toEqual([
    ['persona-builder', 'suggested', 'agent:builder'],
    ['persona-builder-hosted', 'suggested', 'agent:builder-hosted'],
    ['persona-reviewer', 'suggested', 'agent:reviewer'],
    ['persona-reviewer-codex', 'suggested', 'agent:reviewer-codex'],
  ]);
  for (const row of rows) {
    expect([row.harness, row.owner]).toEqual([harnessId, `human:${IAN_ID}`]);
    expect(row.requires).toEqual(row.toolset);
  }
}

async function draftsIterate(db: Database): Promise<void> {
  const harnessId = await activate(db, 'bml', 'flywheel', '60-69');
  const rows = await personasIn(db, '60-69');
  expect(rows.map((row) => [row.slug, row.status, row.identity, row.harness])).toEqual([
    ['persona-iterate', 'suggested', 'agent:iterate', harnessId],
  ]);
}

async function skipsTakenSlugs(db: Database): Promise<void> {
  const first = await activate(db, 'software', 'first-board', '70-79');
  await activate(db, 'software', 'second-board', '70-79');
  const rows = await personasIn(db, '70-79');
  expect(rows).toHaveLength(4);
  expect(new Set(rows.map((row) => row.harness))).toEqual(new Set([first]));
}

describe.skipIf(!testServer)('template personas drafted at activation', () => {
  it('PE-5 activating the software template drafts Builder and both Reviewers as suggested persona pages', () =>
    withAppDatabase(draftsSoftware));
  it('PE-7 activating the BML template drafts Iterate', () => withAppDatabase(draftsIterate));
  it('a second activation from the same template in the same area skips the slugs already taken', () =>
    withAppDatabase(skipsTakenSlugs));
});
