import { describe, expect, it } from 'vitest';
import { eventPageReplySchema, type EventPageReply } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { revokeSeededGrant } from '@uw/db/test-seed';
import {
  allEvents,
  enqueued,
  get,
  ian,
  softwareHarness,
  type Person,
  type Sent,
} from '../testing/commands.ts';
import { agentForms, readAs } from '../testing/harness-reads.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';

const missingHarness = '00000000-0000-4000-8000-0000000000ee';

const edgeIdentities = ['agent:system', 'agent:ingest'];

function eventsPath(harnessId: string, query = ''): string {
  return `/api/harness/${harnessId}/events${query}`;
}

function read(db: Database, person: Pick<Person, 'email'>, path: string): Promise<Sent> {
  return get(db, { email: person.email }, path);
}

function pageOf(sent: Sent): EventPageReply {
  expect(sent.status).toBe(200);
  return eventPageReplySchema.parse(sent.body);
}

async function enqueuedMany(db: Database, harnessId: string, count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    ids.push(await enqueued(db, harnessId, `Item ${index}`));
  }
  return ids;
}

async function pagesInOrder(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  await enqueuedMany(db, scene.harnessId, 150);
  const stored = await allEvents(db, scene.harnessId);
  expect(stored.length).toBeGreaterThan(150);
  const first = pageOf(await read(db, scene.viewer, eventsPath(scene.harnessId, '?after=0')));
  expect(first.events).toEqual(stored.slice(0, 100));
  expect(first.next).not.toBeNull();
  const rest = pageOf(
    await read(db, scene.viewer, eventsPath(scene.harnessId, `?after=${first.next}&limit=100`)),
  );
  expect(rest.events).toEqual(stored.slice(100, 200));
  const third = rest.next === null ? null : `?after=${rest.next}`;
  const tail =
    third === null
      ? []
      : pageOf(await read(db, scene.viewer, eventsPath(scene.harnessId, third))).events;
  expect([...first.events, ...rest.events, ...tail]).toEqual(stored);
  const small = pageOf(await read(db, scene.viewer, eventsPath(scene.harnessId, '?limit=3')));
  expect(small.events).toEqual(stored.slice(0, 3));
}

async function lastPageEnds(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  await enqueuedMany(db, scene.harnessId, 3);
  const stored = await allEvents(db, scene.harnessId);
  const page = pageOf(await read(db, scene.viewer, eventsPath(scene.harnessId)));
  expect(page).toEqual({ events: stored, next: null });
}

async function itemFilter(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const [first, second] = await enqueuedMany(db, scene.harnessId, 2);
  const path = eventsPath(scene.harnessId, `?item=${second}`);
  const page = pageOf(await read(db, scene.viewer, path));
  expect(page.events.length).toBeGreaterThan(0);
  expect(page.events.every((event) => event.itemId === second)).toBe(true);
  const stored = await allEvents(db, scene.harnessId);
  expect(page.events).toEqual(stored.filter((event) => event.itemId === second));
  expect(page.events.some((event) => event.itemId === first)).toBe(false);
}

async function revokedReadsMissing(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  await enqueued(db, scene.harnessId, 'Watch the board');
  pageOf(await read(db, scene.viewer, eventsPath(scene.harnessId)));
  await revokeSeededGrant(db, scene.viewer.grantId, new Date(Date.now() - 1000));
  const hidden = await read(db, scene.viewer, eventsPath(scene.harnessId));
  const missing = await read(db, scene.viewer, eventsPath(missingHarness));
  expect(hidden.status).toBe(404);
  expect(hidden.body).toEqual({ status: 'error', reason: 'harness_not_found' });
  expect(hidden.text).toBe(missing.text);
}

async function hiddenLikeMissing(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  await enqueued(db, scene.harnessId, 'Hide the board');
  const missing = await read(db, scene.editor, eventsPath(missingHarness));
  expect(missing.status).toBe(404);
  expect(missing.body).toEqual({ status: 'error', reason: 'harness_not_found' });
  for (const path of [eventsPath(scene.harnessId), eventsPath('not-a-uuid')]) {
    const sent = await read(db, scene.stranger, path);
    expect(sent.status).toBe(404);
    expect(sent.text).toBe(missing.text);
  }
  const malformedId = await read(db, scene.editor, eventsPath('not-a-uuid'));
  expect(malformedId.text).toBe(missing.text);
  const token = { common_name: 'svc-reader' };
  const service = await get(db, token, eventsPath(scene.harnessId));
  const serviceMissing = await get(db, token, eventsPath(missingHarness));
  expect(service.body).toEqual({ status: 'error', reason: 'unauthenticated' });
  expect(service.text).toBe(serviceMissing.text);
}

async function agentsSeeWhatTheyActOn(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  await enqueued(db, scene.harnessId, 'Show the agents');
  const owner = await ian(db);
  const forms = await agentForms(db, owner, scene.harnessId, edgeIdentities);
  const stored = await allEvents(db, scene.harnessId);
  for (const agent of forms.readable) {
    const page = pageOf(await readAs(db, agent, eventsPath(scene.harnessId)));
    expect(page.events).toEqual(stored);
  }
  for (const agent of forms.hidden) {
    const hidden = await readAs(db, agent, eventsPath(scene.harnessId));
    const missing = await readAs(db, agent, eventsPath(missingHarness));
    expect(hidden.status).toBe(404);
    expect(hidden.body).toEqual({ status: 'error', reason: 'harness_not_found' });
    expect(hidden.text).toBe(missing.text);
  }
}

const malformedQueries = [
  '?after=abc',
  '?after=-1',
  '?after=1.5',
  '?after=',
  '?after=%201',
  '?after=1e3',
  '?after=0x10',
  '?after=99999999999999999999',
  '?limit=0',
  '?limit=101',
  '?limit=abc',
  '?item=not-a-uuid',
  '?cursor=1',
];

async function malformedCursor(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  for (const query of malformedQueries) {
    const sent = await read(db, scene.viewer, eventsPath(scene.harnessId, query));
    expect({ query, status: sent.status, body: sent.body }).toEqual({
      query,
      status: 400,
      body: { status: 'error', reason: 'malformed_command' },
    });
  }
  const unread = await read(db, scene.stranger, eventsPath(scene.harnessId, '?after=abc'));
  const absent = await read(db, scene.stranger, eventsPath(missingHarness, '?after=abc'));
  expect(unread.text).toBe(absent.text);
}

describe.skipIf(!testServer)('WB-3 a session reads the events of a harness by cursor', () => {
  it('WB-3 a session reads the events after its cursor, in order, a page at a time', () =>
    withAppDatabase(pagesInOrder));

  it('WB-3 the last page answers next null', () => withAppDatabase(lastPageEnds));

  it("WB-3 an item filter returns only that item's events", () => withAppDatabase(itemFilter));

  it('WB-3 a person who loses their grant reads harness_not_found on the next read', () =>
    withAppDatabase(revokedReadsMissing));

  it('WB-3 a malformed cursor is malformed_command', () => withAppDatabase(malformedCursor));
});

describe.skipIf(!testServer)('the event read hides what the caller may not read', () => {
  it('answers a stranger, a bad id and a service token as it answers a missing harness', () =>
    withAppDatabase(hiddenLikeMissing));

  it('shows an agent the events of a harness it may act on, and nothing of one it may not', () =>
    withAppDatabase(agentsSeeWhatTheyActOn));
});
