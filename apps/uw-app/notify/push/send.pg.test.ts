import { describe, expect, it } from 'vitest';
import { gateLink, type WakeReason } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { seedPerson } from '@uw/db/test-seed';
import type { Wake, WakeRecipient } from '@uw/harness';
import { testServer, withAppDatabase } from '../../testing/postgres.ts';
import { systemTimers } from '../../timers.ts';
import { platformNotifier } from '../notifier.ts';
import { endpointFor, recordingFetch, subscription, vapidFixture } from '../testing.ts';
import { pushStore } from './store.ts';
import { webPushTransport } from './transport.ts';

const ana = 'c6300000-0000-4000-8000-000000000001';
const harnessId = 'c6300000-0000-4000-8000-000000000002';
const itemId = 'c6300000-0000-4000-8000-000000000003';
const traceId = 'c6300000-0000-4000-8000-000000000004';
const start = new Date('2026-10-04T09:00:00.000Z');

function wake(
  recipients: readonly WakeRecipient[],
  minutes = 0,
  reason: WakeReason = 'gate_waiting',
): Wake {
  return {
    harnessId,
    harnessKey: 'software',
    jdArea: '80-89',
    itemId,
    itemRef: 'item-c6300000',
    topic: 'software/item-c6300000',
    reason,
    link: gateLink(harnessId, itemId),
    recipients,
    at: new Date(start.getTime() + minutes * 60_000),
    traceId,
  };
}

type Setup = {
  readonly statuses: Readonly<Record<string, number>>;
  readonly devices: readonly string[];
};

async function notifierWith(db: Database, setup: Setup) {
  await seedPerson(db, { id: ana, email: 'send-ana@unfoldingword.org' });
  for (const name of setup.devices) {
    await pushStore(db).subscribe(ana, await subscription(endpointFor(name)), start);
  }
  const vapid = await vapidFixture();
  const recorded = recordingFetch((url) => {
    const name = url.slice(url.lastIndexOf('/') + 1);
    return new Response(null, { status: setup.statuses[name] ?? 500 });
  });
  const lines: Record<string, unknown>[] = [];
  const notifier = platformNotifier({
    db,
    config: { appOrigin: null, push: vapid.config, zulip: null },
    push: webPushTransport(vapid.config, recorded.fetcher, systemTimers),
    zulip: null,
    sink: (line) => lines.push(JSON.parse(line) as Record<string, unknown>),
    commit: 'test',
  });
  return { notifier, lines, recorded };
}

const here: WakeRecipient = { personId: ana, present: false };

function pushLines(lines: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  return lines.filter((line) => String(line['outcome']).startsWith('push_'));
}

function outcomes(lines: readonly Record<string, unknown>[]): unknown[] {
  return pushLines(lines).map((line) => line['outcome']);
}

async function everyDevice(db: Database): Promise<void> {
  const both = await notifierWith(db, { devices: ['p1', 'p2'], statuses: { p1: 201, p2: 201 } });
  const delivery = await both.notifier.notify(wake([here]));
  expect(delivery.push).toEqual([{ personId: ana, decision: 'sent' }]);
  expect(both.recorded.calls).toHaveLength(2);
  expect(both.lines.find((line) => line['outcome'] === 'push_sent')).toMatchObject({
    device_count: 2,
    delivered_count: 2,
  });
}

async function goneDevice(db: Database): Promise<void> {
  const gone = await notifierWith(db, { devices: ['p1', 'p2'], statuses: { p1: 410, p2: 201 } });
  const expiring = await subscription(endpointFor('old'), start.getTime());
  await pushStore(db).subscribe(ana, expiring, start);
  expect((await gone.notifier.notify(wake([here]))).push[0]?.decision).toBe('sent');
  const left = (await pushStore(db).devicesOf(ana, start)).devices;
  expect(left.map((device) => device.endpoint)).toEqual([endpointFor('p2')]);
  expect(gone.recorded.calls.map((call) => call.url)).not.toContain(endpointFor('old'));
  expect(outcomes(gone.lines)).toEqual(['push_pruned', 'push_pruned', 'push_sent']);
}

async function spentWindow(db: Database): Promise<void> {
  const failing = await notifierWith(db, { devices: ['p1'], statuses: { p1: 500 } });
  expect((await failing.notifier.notify(wake([here]))).push[0]?.decision).toBe('dropped');
  expect((await failing.notifier.notify(wake([here], 5))).push[0]?.decision).toBe('coalesced');
  expect(outcomes(failing.lines)).toEqual(['push_dropped', 'push_coalesced']);
}

async function loggedDecisions(db: Database): Promise<void> {
  const rig = await notifierWith(db, { devices: ['p1'], statuses: { p1: 201 } });
  const { notifier } = rig;
  await notifier.notify(wake([here]));
  await notifier.notify(wake([here], 1));
  await notifier.notify(wake([{ personId: ana, present: true }], 2));
  const lines = pushLines(rig.lines);
  expect(lines.map((line) => [line['outcome'], line['trace_id'], line['route']])).toEqual([
    ['push_sent', traceId, 'notifier'],
    ['push_coalesced', traceId, 'notifier'],
    ['push_suppressed', traceId, 'notifier'],
  ]);
  const text = JSON.stringify(lines);
  expect(text).not.toContain('fcm.googleapis.com');
  expect(text).not.toContain('p256dh');
  expect(lines[0]).toMatchObject({
    person_id: ana,
    harness_id: harnessId,
    item_id: itemId,
    reason: 'gate_waiting',
  });
}

async function unconfiguredAndBare(db: Database): Promise<void> {
  await seedPerson(db, { id: ana, email: 'send-ana@unfoldingword.org' });
  const lines: Record<string, unknown>[] = [];
  const sink = (line: string) => lines.push(JSON.parse(line) as Record<string, unknown>);
  const config = { appOrigin: null, push: null, zulip: null };
  const unconfigured = platformNotifier({
    db,
    config,
    push: null,
    zulip: null,
    sink,
    commit: 'test',
  });
  expect((await unconfigured.notify(wake([here]))).push[0]?.decision).toBe('not_configured');
  const vapid = await vapidFixture();
  const fetcher = recordingFetch(() => new Response()).fetcher;
  const bare = platformNotifier({
    db,
    config: { appOrigin: null, push: vapid.config, zulip: null },
    push: webPushTransport(vapid.config, fetcher, systemTimers),
    zulip: null,
    sink,
    commit: 'test',
  });
  expect((await bare.notify(wake([here]))).push[0]?.decision).toBe('no_device');
  expect(outcomes(lines)).toEqual(['push_not_configured', 'push_no_device']);
}

describe.skipIf(!testServer)('the platform notifier sends web push', () => {
  it('NT-1 every subscribed device is sent the wake and an expired or gone device is pruned', async () => {
    await withAppDatabase(everyDevice);
    await withAppDatabase(goneDevice);
  });

  it('drops a wake every device refuses, and the spent window coalesces the next one', () =>
    withAppDatabase(spentWindow));

  it('NT-2 every send, coalesce and suppress decision is logged with the trace id', () =>
    withAppDatabase(loggedDecisions));

  it('answers not_configured for push with no VAPID configuration, and no_device for a person with none', () =>
    withAppDatabase(unconfiguredAndBare));
});
