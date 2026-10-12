import { afterAll, beforeAll, describe } from 'vitest';
import type { WakeReason } from '@uw/contracts';
import { createClient, type Database } from '@uw/db/client';
import { createMigratedDatabase, testServer, type TestDatabase } from '@uw/db/test-database';
import { seedPerson } from '@uw/db/test-seed';
import type { Notifier } from '@uw/harness';
import {
  describeNotifierContract,
  type NotifierSubject,
} from '@uw/harness/port-contracts/notifier';
import { notifyConfigOf } from '../notify/config.ts';
import { pushStore } from '../notify/push/store.ts';
import { webPushTransport } from '../notify/push/transport.ts';
import {
  appOrigin,
  endpointFor,
  recordingFetch,
  subscription,
  vapidFixture,
  zulipEnv,
  zulipFormOf,
  zulipSite,
  type VapidFixture,
  type ZulipForm,
} from '../notify/testing.ts';
import { reasonSentence } from '../notify/zulip/message.ts';
import { zulipPoster } from '../notify/zulip/post.ts';
import { systemTimers } from '../timers.ts';
import { platformNotifier } from './notifier.ts';

let database: TestDatabase;
let db: Database;

const reasons = new Map<string, WakeReason>([
  [reasonSentence.gate_waiting, 'gate_waiting'],
  [reasonSentence.delegation_lapsed, 'delegation_lapsed'],
  [reasonSentence.run_failed, 'run_failed'],
]);

function reasonOf(content: string): WakeReason {
  const sentence = content.split(': ')[1]?.split('. ')[0] ?? '';
  return reasons.get(sentence) ?? 'stage_advanced';
}

type Rig = {
  readonly fetcher: typeof fetch;
  readonly posted: readonly ZulipForm[];
  readonly state: { failing: boolean };
};

function rig(): Rig {
  const state = { failing: false };
  const recorded = recordingFetch((url) => {
    if (state.failing) return Promise.reject(new Error('offline'));
    if (url.startsWith(zulipSite)) return Response.json({ result: 'success', id: 1 });
    return new Response(null, { status: 201 });
  });
  const posted: ZulipForm[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const answer = await recorded.fetcher(input, init);
    if (String(input).startsWith(zulipSite)) posted.push(zulipFormOf(init?.body));
    return answer;
  };
  return { fetcher, posted, state };
}

type Build = {
  readonly vapid: VapidFixture;
  readonly fetcher: typeof fetch;
  readonly zulip: boolean;
};

function builtNotifier(adapter: typeof platformNotifier, build: Build): Notifier {
  const { vapid, fetcher, zulip } = build;
  const env = zulip
    ? { ...vapid.env, ...zulipEnv({ '80-89': 'Technology' }), APP_ORIGIN: appOrigin }
    : vapid.env;
  const config = notifyConfigOf(env);
  return adapter({
    db,
    config,
    push: webPushTransport(vapid.config, fetcher, systemTimers),
    zulip: config.zulip === null ? null : zulipPoster(config.zulip, fetcher, systemTimers),
    sink: () => undefined,
    commit: 'test',
  });
}

async function openSubject(adapter: typeof platformNotifier): Promise<NotifierSubject> {
  const vapid = await vapidFixture();
  const { fetcher, posted, state } = rig();
  const built = (zulip: boolean) => builtNotifier(adapter, { vapid, fetcher, zulip });
  let inner = built(false);
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
    enableZulip: async () => {
      inner = built(true);
    },
    failNext: async () => {
      state.failing = true;
    },
    posts: async () =>
      posted.map((form) => ({ topic: form.topic, reason: reasonOf(form.content) })),
  };
}

describe.skipIf(!testServer)('DX-3 the platform notifier on Postgres', () => {
  beforeAll(async () => {
    database = await createMigratedDatabase(testServer ?? '');
    db = createClient(database.connectionString);
  });

  afterAll(async () => {
    await db.$client.end();
    await database.drop();
  });

  describeNotifierContract('the platform notifier on Postgres', () =>
    openSubject(platformNotifier),
  );
});
