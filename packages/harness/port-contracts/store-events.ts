import { expect, it } from 'vitest';
import { newEventSchema, type HarnessEvent, type NewHarnessEvent } from '@uw/contracts';
import type { EventPage, Store } from '../ports.ts';
import { at, itemOf, refusedBy, seedHarness, uid } from './store-gateway-fixtures.ts';

type EventsSubject = () => { readonly store: Store };

function eventOf(base: number, n: number, itemId: string | null, name = 'item_created') {
  return {
    eventId: uid(base + 0x40 + n),
    harnessId: uid(base),
    itemId,
    name,
    at: at.toISOString(),
    actor: 'human:00000000-0000-4000-8000-000000000001',
    evidence: { stage: 'build', title: `Item ${n}`, pageId: null, priority: 0, due: null },
    traceId: uid(base + 0x80),
  };
}

function positions(page: EventPage): number[] {
  return page.events.map((event) => event.position);
}

function describeAppend(subject: EventsSubject): void {
  it('DX-3 KN-3 appends events with positions per harness, in the order given', async () => {
    const first = eventOf(0xf00, 1, null);
    const second = eventOf(0xf00, 2, null);
    const other = eventOf(0xf10, 1, null);
    const stored: HarnessEvent[][] = [];
    await subject().store.transaction(async (tx) => {
      await seedHarness(tx, 0xf00, 'gateway-events-a');
      await seedHarness(tx, 0xf10, 'gateway-events-b');
      const both = [newEventSchema.parse(first), newEventSchema.parse(second)];
      stored.push([...(await tx.harnessEvents.write.append(both))]);
      stored.push([...(await tx.harnessEvents.write.append([newEventSchema.parse(other)]))]);
    });
    expect(stored).toEqual([
      [
        { ...first, position: 1 },
        { ...second, position: 2 },
      ],
      [{ ...other, position: 1 }],
    ]);
  });
}

function describePaging(subject: EventsSubject): void {
  it('DX-3 KN-4 pages a harness and an item in cursor order and resumes after a cursor', async () => {
    const itemX = itemOf(0xf20, 1);
    const itemY = itemOf(0xf20, 2);
    const owners = [itemX.itemId, itemY.itemId, itemX.itemId, itemX.itemId, null];
    const pages = await subject().store.transaction(async (tx) => {
      await seedHarness(tx, 0xf20, 'gateway-events-paging');
      await tx.harnessItems.write.insert(itemX, at);
      await tx.harnessItems.write.insert(itemY, at);
      const events = owners.map((owner, n) => newEventSchema.parse(eventOf(0xf20, n, owner)));
      await tx.harnessEvents.write.append(events);
      const harnessId = uid(0xf20);
      const read = (after: number, limit: number, itemId: string | null = null) =>
        tx.harnessEvents.read.page({ harnessId, itemId, after, limit });
      return [
        await read(0, 2),
        await read(2, 2),
        await read(4, 2),
        await read(0, 100, itemX.itemId),
        await read(1, 100, itemX.itemId),
      ];
    });
    expect(pages.map(positions)).toEqual([[1, 2], [3, 4], [5], [1, 3, 4], [3, 4]]);
    expect(pages.map((page) => page.next)).toEqual([2, 4, null, null, null]);
  });
}

function describeIsolation(subject: EventsSubject): void {
  it("DX-3 KN-4 pages only the asked harness's events, never another harness's", async () => {
    const pages = await subject().store.transaction(async (tx) => {
      await seedHarness(tx, 0x1600, 'gateway-events-own');
      await seedHarness(tx, 0x1700, 'gateway-events-other');
      const own = [1, 2].map((n) => newEventSchema.parse(eventOf(0x1600, n, null)));
      const other = [1, 2, 3].map((n) => newEventSchema.parse(eventOf(0x1700, n, null)));
      await tx.harnessEvents.write.append(own);
      await tx.harnessEvents.write.append(other);
      const read = (base: number) =>
        tx.harnessEvents.read.page({ harnessId: uid(base), itemId: null, after: 0, limit: 100 });
      return [await read(0x1600), await read(0x1700)];
    });
    expect(pages.map((page) => page.events.map((event) => event.harnessId))).toEqual([
      [uid(0x1600), uid(0x1600)],
      [uid(0x1700), uid(0x1700), uid(0x1700)],
    ]);
    expect(pages.map(positions)).toEqual([
      [1, 2],
      [1, 2, 3],
    ]);
  });
}

function describePageBounds(subject: EventsSubject): void {
  it('DX-3 KN-4 refuses a page outside 1 to 100 rows or before position 0', async () => {
    const bad = [
      { after: 0, limit: 0 },
      { after: 0, limit: 101 },
      { after: -1, limit: 10 },
    ];
    const outcomes = await subject().store.transaction(async (tx) => {
      const names: string[] = [];
      for (const range of bad) {
        const query = { harnessId: uid(0xf20), itemId: null, ...range };
        const error = await tx.harnessEvents.read.page(query).then(
          () => null,
          (e: unknown) => e,
        );
        names.push(error instanceof RangeError ? 'RangeError' : 'no RangeError');
      }
      return names;
    });
    expect(outcomes).toEqual(['RangeError', 'RangeError', 'RangeError']);
  });
}

function describeRefusals(subject: EventsSubject): void {
  it('DX-3 KN-3 refuses an unknown event name as a StoreRefusedError naming harness_events_name_known', async () => {
    const forged: NewHarnessEvent = JSON.parse(
      JSON.stringify({ ...eventOf(0xf30, 1, null), name: 'merged' }),
    );
    const refusal = await refusedBy(async (tx) => {
      await seedHarness(tx, 0xf30, 'gateway-events-forged');
      await tx.harnessEvents.write.append([forged]);
    }, subject().store);
    expect(refusal).toMatchObject({ code: '23514', constraint: 'harness_events_name_known' });
  });

  it('DX-3 KN-3 offers no way to change or remove an event', async () => {
    const members = await subject().store.transaction(async (tx) =>
      Object.keys(tx.harnessEvents.write),
    );
    expect(members).toEqual(['append']);
  });
}

export function describeEvents(subject: EventsSubject): void {
  describeAppend(subject);
  describePaging(subject);
  describeIsolation(subject);
  describePageBounds(subject);
  describeRefusals(subject);
}
