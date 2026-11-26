import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { ingestPrincipal } from '@uw/core/principal';
import { seedGrant, seedPerson } from '@uw/db/test-seed';
import { kernelOn, personOn } from '../../testing/kernel.ts';
import { testServer, withAppDatabase } from '../../testing/postgres.ts';
import { sha256Hex } from './digest.ts';
import { startZulipPairing } from './pairing-start.ts';

const person = '00000000-0000-4000-8000-0000000e0601';
const harness = '00000000-0000-4000-8000-0000000e0602';
const at = new Date('2026-11-26T09:00:00.000Z');
const clock = { now: () => at };

describe.skipIf(!testServer)('PA-6 starting a Zulip pairing from the platform', () => {
  it('gives me a code once, stores only its digest, and pairs the account that sends it back', () =>
    withAppDatabase(async (db) => {
      await seedPerson(db, { id: person, email: 'ana@example.org' });
      await seedGrant(db, {
        id: randomUUID(),
        personId: person,
        role: 'viewer',
        scopeKind: 'org',
        scopeArea: null,
        grantedAt: at,
        expiresAt: null,
      });
      await db.execute(sql`INSERT INTO harnesses (id, key, title, template, jd_area, created_at, person_id)
        VALUES (${harness}, ${`assistant-${person}`}, 'Assistant', 'assistant', '10-19',
          ${at.toISOString()}::timestamptz, ${person})`);
      const kernel = kernelOn(db, clock);
      const me = await personOn(db, person, 'ana@example.org', at);
      const started = await startZulipPairing(
        kernel,
        { actor: me, traceId: randomUUID(), requestId: null },
        harness,
      );
      if (started.status !== 'accepted') throw new Error(started.reason);
      expect(started.value.code).toMatch(/^[A-HJKMNP-TV-Z2-9]{8}$/);
      const [stored] = await db.execute<{ code_digest: string }>(
        sql`SELECT code_digest FROM assistant_pairing_codes WHERE harness_id = ${harness}`,
      );
      expect(stored?.code_digest).toMatch(/^[0-9a-f]{64}$/);
      expect(stored?.code_digest).not.toContain(started.value.code);
      const ingest = { actor: ingestPrincipal(), traceId: randomUUID(), requestId: null };
      const paired = await kernel.assistants.completePairing(ingest, {
        personId: person,
        channel: 'zulip_dm',
        address: 'zulip:5005',
        codeDigest: await sha256Hex(started.value.code),
      });
      expect(paired).toMatchObject({ status: 'accepted', value: { via: 'pairing_code' } });
    }));
});
