import type { Principal } from '@uw/contracts';
import { createClient, type Database } from '@uw/db/client';
import { createMigratedDatabase, testServer } from '@uw/db/test-database';
import { seedPage } from '@uw/db/test-seed';
import { bml, readAllEvents, type Caller } from '@uw/harness';
import { describe, expect, it } from 'vitest';
import { writePageAsAgent } from '../pages/agent-write.ts';
import { platformStore } from '../ports/store.ts';
import { systemClock } from '../ports/clock.ts';
import { agentOf, kernelOn, personOn } from '../testing/kernel.ts';

const ianId = '00000000-0000-4000-8000-000000000001';
const pageId = '00000000-0000-4000-8000-000000008451';

function caller(actor: Principal): Caller {
  return { actor, traceId: crypto.randomUUID() };
}

function persona(ian: Principal, harnessId: string, toolset: readonly string[]) {
  return {
    identity: 'agent:iterate',
    owner: ian.identity,
    harness: harnessId,
    toolset,
    run_shape: 'workflow-run',
    engine: 'openrouter-messages',
    model: 'glm-5.3-flash',
    budget: { monthly_minor: 0, currency: 'USD' },
    capability: 'iterate',
    requires_tools: toolset,
  };
}

async function scene(db: Database) {
  const ian = await personOn(db, ianId, 'ian.lindsley@unfoldingword.org', new Date());
  const harnessId = crypto.randomUUID();
  const kernel = kernelOn(db, systemClock);
  const activate = { harnessId, harnessKey: 'bml', jdArea: '30-39', template: bml };
  expect((await kernel.stages.activate(caller(ian), activate)).status).toBe('accepted');
  await seedPage(db, {
    id: pageId,
    type: 'persona',
    status: 'suggested',
    jdArea: '30-39',
    slug: 'iterate',
    title: 'Iterate',
    bodyMd: 'Iterate tunes a product from its measurements.',
    frontmatter: persona(ian, harnessId, ['search_pages']),
  });
  return { ian, harnessId, kernel };
}

async function agentWidens(db: Database, ian: Principal, harnessId: string) {
  const input = {
    pageId,
    type: 'persona' as const,
    jdArea: '30-39',
    slug: 'iterate',
    title: 'Iterate',
    parentId: null,
    frontmatter: persona(ian, harnessId, ['search_pages', 'read_page']),
    bodyMd: 'Iterate now reaches further.',
    expectedVersion: 1,
  };
  const request = {
    traceId: crypto.randomUUID(),
    at: new Date(),
    instructions: kernelOn(db, systemClock).reads,
  };
  return writePageAsAgent(db, agentOf(ian, 'laptop'), input, request);
}

describe.skipIf(!testServer)('AB-8 activation is pinned to the version the person read', () => {
  it('refuses activating version 1 after an agent saved version 2, recording nothing', async () => {
    const database = await createMigratedDatabase(testServer ?? '');
    const db = createClient(database.connectionString);
    try {
      const { ian, harnessId, kernel } = await scene(db);
      expect(await agentWidens(db, ian, harnessId)).toMatchObject({ ok: true });
      const outcome = await kernel.personas.activate(caller(ian), { pageId, expectedVersion: 1 });
      expect(outcome).toEqual({
        status: 'error',
        reason: 'stale_version',
        detail: { pageId, version: 2 },
      });
      const events = await platformStore(db).transaction((tx) =>
        readAllEvents(tx, harnessId, null),
      );
      expect(events.filter((event) => event.name === 'persona_activation_failed')).toEqual([]);
    } finally {
      await db.$client.end();
      await database.drop();
    }
  });
});
