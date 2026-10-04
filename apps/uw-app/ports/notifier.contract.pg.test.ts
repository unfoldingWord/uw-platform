import { afterAll, beforeAll, describe } from 'vitest';
import { createClient, type Database } from '@uw/db/client';
import { createMigratedDatabase, testServer, type TestDatabase } from '@uw/db/test-database';
import { seedPerson } from '@uw/db/test-seed';
import type { Notifier } from '@uw/harness';
import { describeNotifierContract } from '@uw/harness/port-contracts/notifier';
import { pushStore } from '../notify/push/store.ts';
import { webPushTransport } from '../notify/push/transport.ts';
import { endpointFor, recordingFetch, subscription, vapidFixture } from '../notify/testing.ts';
import { systemTimers } from '../timers.ts';
import { platformNotifier } from './notifier.ts';

let database: TestDatabase;
let db: Database;

describe.skipIf(!testServer)('DX-3 the platform notifier on Postgres', () => {
  beforeAll(async () => {
    database = await createMigratedDatabase(testServer ?? '');
    db = createClient(database.connectionString);
  });

  afterAll(async () => {
    await db.$client.end();
    await database.drop();
  });

  describeNotifierContract(
    'the platform notifier on Postgres',
    async () => {
      const vapid = await vapidFixture();
      const state = { failing: false };
      const recorded = recordingFetch(() =>
        state.failing ? Promise.reject(new Error('offline')) : new Response(null, { status: 201 }),
      );
      const inner = platformNotifier({
        db,
        config: { appOrigin: null, push: vapid.config },
        push: webPushTransport(vapid.config, recorded.fetcher, systemTimers),
        sink: () => undefined,
        commit: 'test',
      });
      const notifier: Notifier = {
        notify: async (wake) => {
          try {
            return await inner.notify(wake);
          } finally {
            state.failing = false;
          }
        },
      };
      return {
        notifier,
        subscribe: async (personId) => {
          await seedPerson(db, { id: personId, email: `${personId}@fixture.unfoldingword.org` });
          const device = await subscription(endpointFor(personId));
          await pushStore(db).subscribe(personId, device, new Date('2026-10-03T08:00:00.000Z'));
        },
        enableZulip: async () => undefined,
        failNext: async () => {
          state.failing = true;
        },
        posts: async () => [],
      };
    },
    false,
  );
});
