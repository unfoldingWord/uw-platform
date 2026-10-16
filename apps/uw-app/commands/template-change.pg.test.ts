import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { allEvents, command } from '../testing/commands.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';

const IAN = { email: 'ian.lindsley@unfoldingword.org' };

async function personaSlugs(db: Database): Promise<readonly string[]> {
  const rows = await db.execute<{ slug: string }>(
    sql`SELECT slug FROM pages WHERE type = 'persona' AND jd_area = '50-59' ORDER BY slug`,
  );
  return rows.map((row) => row.slug);
}

async function changesAndDrafts(db: Database): Promise<void> {
  const harnessId = randomUUID();
  const activation = {
    requestId: randomUUID(),
    harnessKey: 'joined-review',
    jdArea: '50-59',
    template: 'check-only',
    repository: 'unfoldingWord/joined-review',
  };
  const activated = await command(db, IAN, harnessId, 'activate_template', activation);
  expect(activated.body['status']).toBe('accepted');
  expect(await personaSlugs(db)).toEqual(['persona-reviewer', 'persona-reviewer-codex']);
  const body = { requestId: randomUUID(), template: 'software' };
  const changed = await command(db, IAN, harnessId, 'change_template', body);
  expect(changed.body['status']).toBe('accepted');
  expect(await personaSlugs(db)).toEqual([
    'persona-builder',
    'persona-builder-hosted',
    'persona-reviewer',
    'persona-reviewer-codex',
  ]);
  const names = (await allEvents(db, harnessId)).map((event) => event.name);
  expect(names.filter((name) => name === 'template_changed')).toHaveLength(1);
  const again = { requestId: randomUUID(), template: 'bml' };
  const refused = await command(db, IAN, harnessId, 'change_template', again);
  expect(refused.body['reason']).toBe('template_change_not_allowed');
}

describe.skipIf(!testServer)('GL-5 the change_template command', () => {
  it('GL-5 changes a check-only harness to software and drafts the Builder personas', () =>
    withAppDatabase(changesAndDrafts));
});
