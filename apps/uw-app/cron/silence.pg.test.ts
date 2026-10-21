import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createClient } from '@uw/db/client';
import { createMigratedDatabase } from '@uw/db/test-database';
import type { Bindings } from '../env.ts';
import { softwareHarness } from '../testing/commands.ts';
import { testServer } from '../testing/postgres.ts';
import type { CronDeps } from './job.ts';
import { minuteJob } from './minute.ts';

type Line = Record<string, unknown>;

describe.skipIf(!testServer)('OB-1 the minute cron sounds the silence alarm', () => {
  it('runs the silence step as the system and logs what it sounded', async () => {
    const database = await createMigratedDatabase(testServer ?? '');
    const db = createClient(database.connectionString);
    try {
      await softwareHarness(db);
      const lines: Line[] = [];
      const env: Bindings = { HYPERDRIVE: { connectionString: database.connectionString } };
      const deps: CronDeps = {
        now: () => new Date(),
        fetch: () => Promise.reject(new Error('no request')),
        sink: (line) => lines.push(JSON.parse(line) as Line),
        newId: () => randomUUID(),
        commit: 'c',
        engines: {
          AI_GATEWAY_ACCOUNT_ID: 'account',
          AI_GATEWAY_ID: 'gateway',
          AI_GATEWAY_ANALYTICS_TOKEN: 'analytics',
          AI_SPEND_CAP_MINOR: undefined,
          fetch: () => Promise.reject(new Error('no spend read in this test')),
        },
      };
      await minuteJob(env, deps);
      const silence = lines.find((line) => line['step'] === 'silence');
      expect(silence).toMatchObject({ outcome: 'silence_checked', sounded: 0 });
    } finally {
      await db.$client.end();
      await database.drop();
    }
  });
});
