import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createClient } from '@uw/db/client';
import { testServer, withMigratedDatabase } from '@uw/db/test-database';
import { seedPerson } from '@uw/db/test-seed';
import { postgresBotTokens } from './bot-tokens.ts';

const person = '00000000-0000-4000-8000-0000000b0701';
const harness = '00000000-0000-4000-8000-0000000b0702';
const digest = 'e'.repeat(64);

describe.skipIf(!testServer)('PA-6 the bot token lookup on real Postgres', () => {
  it('finds the digest of an active bot by its email, and none for a deactivated one', () =>
    withMigratedDatabase(testServer ?? '', async (target) => {
      const db = createClient(target);
      try {
        await seedPerson(db, { id: person, email: 'tokens@example.org' });
        await db.execute(sql`INSERT INTO harnesses (id, key, title, template, jd_area, created_at, person_id)
          VALUES (${harness}, ${`assistant-${person}`}, 'Assistant', 'assistant', '10-19',
            '2026-11-26T09:00:00Z'::timestamptz, ${person})`);
        await db.execute(sql`INSERT INTO assistant_zulip_bots
            (harness_id, person_id, bot_user_id, bot_email, full_name, key_cipher, key_ciphertext,
             key_nonce, key_wrapped, key_id, webhook_token_digest, status, created_at, updated_at)
          VALUES (${harness}, ${person}, 9001, 'barnabas-bot@chat.example.org', 'barnabas',
            'aes-256-gcm', 'c2VhbGVk', 'bm9uY2U=', 'd3JhcHBlZA==', 'kms-key', ${digest}, 'active',
            '2026-11-26T09:00:00Z'::timestamptz, '2026-11-26T09:00:00Z'::timestamptz)`);
        const tokens = postgresBotTokens(db);
        expect(await tokens.byBotEmail('barnabas-bot@chat.example.org')).toEqual({
          botUserId: 9001,
          digest,
        });
        expect(await tokens.byBotEmail('silas-bot@chat.example.org')).toBeNull();
        await db.execute(sql`UPDATE assistant_zulip_bots SET status = 'deactivated'`);
        expect(await tokens.byBotEmail('barnabas-bot@chat.example.org')).toBeNull();
      } finally {
        await db.$client.end();
      }
    }));
});
