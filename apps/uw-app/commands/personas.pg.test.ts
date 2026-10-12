import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { seedPage } from '@uw/db/test-seed';
import { agentOf } from '../testing/kernel.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import {
  command,
  dispatchAs,
  dispatchScope,
  eventsNamed,
  ian,
  softwareHarness,
} from '../testing/commands.ts';

const IAN = { email: 'ian.lindsley@unfoldingword.org' };

const body = [
  '---',
  'name: builder',
  'description: Builder turns an approved plan into commits.',
  '---',
  'Claim the item, do the work, submit it.',
].join('\n');

async function suggestedPersona(db: Database, harnessId: string): Promise<string> {
  const pageId = randomUUID();
  await seedPage(db, {
    id: pageId,
    type: 'persona',
    status: 'suggested',
    jdArea: '80-89',
    slug: 'persona-builder',
    title: 'Builder',
    bodyMd: body,
    frontmatter: {
      identity: 'agent:builder',
      owner: 'human:00000000-0000-4000-8000-000000000001',
      harness: harnessId,
      toolset: ['read_page', 'claim_item'],
      run_shape: 'workflow-run',
      engine: 'claude-messages',
      model: 'claude-sonnet-5',
      provider: null,
      budget: { monthly_minor: 0, currency: 'USD' },
      capability: 'build',
      requires_tools: ['read_page', 'claim_item'],
      status: 'suggested',
    },
  });
  return pageId;
}

function activation(pageId: string, expectedVersion: number) {
  return { requestId: randomUUID(), pageId, expectedVersion };
}

async function pageRow(db: Database, pageId: string) {
  const rows = await db.execute<{ status: string; version: number }>(
    sql`SELECT status, version FROM pages WHERE id = ${pageId}`,
  );
  return rows[0];
}

async function adminOnly(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const pageId = await suggestedPersona(db, scene.harnessId);
  const send = (who: { readonly email: string }, version: number) =>
    command(db, who, scene.harnessId, 'activate_persona', activation(pageId, version));
  expect((await send(scene.editor, 1)).body).toMatchObject({ reason: 'not_permitted' });
  const agent = agentOf(await ian(db), 'laptop');
  const fromAgent = await dispatchAs(
    agent,
    scene.harnessId,
    'activate_persona',
    activation(pageId, 1),
    dispatchScope(db),
  );
  expect(fromAgent).toMatchObject({ status: 'error', reason: 'not_permitted' });
  const stale = await send(IAN, 2);
  expect([stale.status, stale.body['reason']]).toEqual([409, 'stale_version']);
  expect(await eventsNamed(db, scene.harnessId, 'persona_activated')).toHaveLength(0);
  expect(await pageRow(db, pageId)).toEqual({ status: 'suggested', version: 1 });
  const done = await send(IAN, 1);
  expect([done.status, done.body['status']]).toEqual([200, 'accepted']);
  expect(await pageRow(db, pageId)).toEqual({ status: 'active', version: 2 });
  expect(await eventsNamed(db, scene.harnessId, 'persona_activated')).toHaveLength(1);
}

async function otherHarness(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const pageId = await suggestedPersona(db, scene.harnessId);
  const sent = await command(
    db,
    IAN,
    scene.otherHarnessId,
    'activate_persona',
    activation(pageId, 1),
  );
  expect([sent.status, sent.body['reason']]).toEqual([404, 'page_not_found']);
  expect(await pageRow(db, pageId)).toEqual({ status: 'suggested', version: 1 });
}

describe.skipIf(!testServer)('the activate_persona command', () => {
  it('PE-3 activate_persona is admin only, refused to agents, and answers stale_version for an old version', () =>
    withAppDatabase(adminOnly));
  it('PE-3 a page of another harness is page_not_found', () => withAppDatabase(otherHarness));
});
