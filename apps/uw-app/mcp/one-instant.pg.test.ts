import { describe, expect, it } from 'vitest';
import { principalSchema, type Principal } from '@uw/contracts';
import { createLogger } from '@uw/core/log';
import { createClient } from '@uw/db/client';
import { createMigratedDatabase, testServer } from '@uw/db/test-database';
import { software, type Caller, type Kernel } from '@uw/harness';
import { kernelOn, personOn } from '../testing/kernel.ts';
import type { VerbContext } from './context.ts';
import { callVerb } from './dispatch.ts';
import { verbHandlers } from './verbs/index.ts';

const IAN_ID = '00000000-0000-4000-8000-000000000001';
const OWNER = '00000000-0000-4000-8000-000000003001';
const requestAt = new Date('2026-10-02T12:00:00.000Z');
const expiresAt = new Date('2026-10-02T12:00:01.000Z');
const kernelNow = new Date('2026-10-02T12:00:02.000Z');

function caller(actor: Principal): Caller {
  return { actor, traceId: crypto.randomUUID() };
}

function laptopUntil(until: Date): Principal {
  return principalSchema.parse({
    identity: `agent:${OWNER}/laptop`,
    kind: 'agent',
    personId: OWNER,
    email: null,
    grants: [
      {
        grantId: '00000000-0000-4000-8000-000000003011',
        role: 'editor',
        scopeKind: 'jd_area',
        scopeArea: '80-89',
        expiresAt: until.toISOString(),
      },
    ],
    interactive: true,
  });
}

function contextOf(kernel: Kernel, principal: Principal): VerbContext {
  return {
    principal,
    host: 'external',
    at: requestAt,
    traceId: crypto.randomUUID(),
    kernel,
    db: createClient('postgres://unused@127.0.0.1:1/unused'),
    commit: 'test-commit',
    logger: createLogger(
      { traceId: 'trace', commit: 'test-commit', route: 'POST /mcp', principal: null },
      () => undefined,
    ),
  };
}

describe.skipIf(!testServer)('a verb call judges the kernel read at the request instant', () => {
  it('answers get_health for a grant live at the request even when the kernel clock has passed it', async () => {
    const database = await createMigratedDatabase(testServer ?? '');
    const db = createClient(database.connectionString);
    try {
      const kernel = kernelOn(db, { now: () => kernelNow });
      const ian = await personOn(db, IAN_ID, 'ian.lindsley@unfoldingword.org', requestAt);
      const harnessId = crypto.randomUUID();
      const activate = {
        harnessId,
        harnessKey: 'software',
        jdArea: '80-89',
        template: software,
        repository: 'unfoldingWord/uw-platform',
      };
      expect((await kernel.stages.activate(caller(ian), activate)).status).toBe('accepted');
      const context = contextOf(kernel, laptopUntil(expiresAt));
      const result = await callVerb(context, 'get_health', { harnessId }, verbHandlers);
      expect(result.isError).toBeUndefined();
    } finally {
      await db.$client.end();
      await database.drop();
    }
  });
});
