import { describe, expect, it } from 'vitest';
import { gateLink, homeLink, type JdArea } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { seedPerson } from '@uw/db/test-seed';
import type { Wake } from '@uw/harness';
import { testServer, withAppDatabase } from '../../testing/postgres.ts';
import { systemTimers } from '../../timers.ts';
import { notifyConfigOf } from '../config.ts';
import { platformNotifier } from '../notifier.ts';
import { pushStore } from '../push/store.ts';
import { webPushTransport } from '../push/transport.ts';
import {
  appOrigin,
  endpointFor,
  recordingFetch,
  subscription,
  vapidFixture,
  zulipEnv,
  zulipForms,
  zulipSite,
} from '../testing.ts';
import { zulipPoster } from './post.ts';

const ana = 'c7100000-0000-4000-8000-000000000001';
const harnessId = 'c7100000-0000-4000-8000-000000000002';
const itemId = 'c7100000-0000-4000-8000-000000000003';
const traceId = 'c7100000-0000-4000-8000-000000000004';
const at = new Date('2026-10-04T09:00:00.000Z');
const channels = { '80-89': '80-89 Technology', '40-49': '40-49 Programs' };

function wake(jdArea: JdArea): Wake {
  return {
    harnessId,
    harnessKey: 'software',
    jdArea,
    itemId,
    itemRef: 'uw-platform#42',
    topic: 'software/uw-platform#42',
    reason: 'gate_waiting',
    link: gateLink(harnessId, itemId),
    recipients: [{ personId: ana, present: false }],
    at,
    traceId,
  };
}

async function rig(db: Database, zulipDown: boolean) {
  await seedPerson(db, { id: ana, email: 'zulip-ana@unfoldingword.org' });
  await pushStore(db).subscribe(ana, await subscription(endpointFor('ana')), at);
  const vapid = await vapidFixture();
  const config = notifyConfigOf({ ...vapid.env, ...zulipEnv(channels), APP_ORIGIN: appOrigin });
  const recorded = recordingFetch((url) => {
    if (!url.startsWith(zulipSite)) return new Response(null, { status: 201 });
    if (zulipDown) return Promise.reject(new Error('zulip is down'));
    return Response.json({ result: 'success', id: 7 });
  });
  const lines: Record<string, unknown>[] = [];
  if (config.zulip === null || config.push === null)
    throw new Error('expected a full configuration');
  const notifier = platformNotifier({
    db,
    config,
    push: webPushTransport(config.push, recorded.fetcher, systemTimers),
    zulip: zulipPoster(config.zulip, recorded.fetcher, systemTimers),
    sink: (line) => lines.push(JSON.parse(line) as Record<string, unknown>),
    commit: 'test',
  });
  return { notifier, recorded, lines };
}

async function outage(db: Database): Promise<void> {
  const { notifier, lines } = await rig(db, true);
  const delivery = await notifier.notify(wake('80-89'));
  expect(delivery).toEqual({ push: [{ personId: ana, decision: 'sent' }], zulip: 'dropped' });
  const dropped = lines.find((line) => line['outcome'] === 'zulip_dropped');
  expect(dropped).toMatchObject({ trace_id: traceId, route: 'notifier', harness_id: harnessId });
}

async function mappedChannel(db: Database): Promise<void> {
  const { notifier, recorded, lines } = await rig(db, false);
  expect((await notifier.notify(wake('40-49'))).zulip).toBe('posted');
  expect(zulipForms(recorded.calls)).toEqual([
    {
      to: '40-49 Programs',
      topic: 'software/uw-platform#42',
      content: `software · uw-platform#42: A gate is waiting on a person. ${appOrigin}/harnesses/${harnessId}/gates/${itemId}`,
    },
  ]);
  expect((await notifier.notify(wake('10-19'))).zulip).toBe('dropped');
  expect(lines.map((line) => line['outcome'])).toContain('zulip_channel_unmapped');
  expect(zulipForms(recorded.calls)).toHaveLength(1);
}

async function harnessTopic(db: Database): Promise<void> {
  const { notifier, recorded } = await rig(db, false);
  const lapse: Wake = {
    ...wake('80-89'),
    itemId: null,
    itemRef: null,
    topic: 'software',
    reason: 'delegation_lapsed',
    link: homeLink,
  };
  expect((await notifier.notify(lapse)).zulip).toBe('posted');
  expect(zulipForms(recorded.calls)).toEqual([
    {
      to: '80-89 Technology',
      topic: 'software',
      content: `software: A delegation lapsed. ${appOrigin}/`,
    },
  ]);
}

describe.skipIf(!testServer)('the platform notifier posts to Zulip', () => {
  it('NT-3 a Zulip outage drops the wake, logs it, and push still sends', () =>
    withAppDatabase(outage));
  it("NT-3 the post goes to the channel mapped to the harness's area", () =>
    withAppDatabase(mappedChannel));
  it("NT-4 a harness-level lapse posts to the harness's topic", () =>
    withAppDatabase(harnessTopic));
});
