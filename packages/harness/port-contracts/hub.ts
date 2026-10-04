import { describe, expect, it } from 'vitest';
import type { Hub, PresenceQuery } from '../ports.ts';
import { describeNotWired } from './not-wired-cases.ts';

export type HubSubject = {
  readonly hub: Hub;
  wakes(): Promise<readonly string[]>;
  enter(query: PresenceQuery): Promise<void>;
};

const firstHarness = 'b3000000-0000-4000-8000-000000000001';
const secondHarness = 'b3000000-0000-4000-8000-000000000002';
const person = 'b3000000-0000-4000-8000-000000000003';
const otherPerson = 'b3000000-0000-4000-8000-000000000004';
const item = 'b3000000-0000-4000-8000-000000000005';
const otherItem = 'b3000000-0000-4000-8000-000000000006';

const gates: PresenceQuery = {
  harnessId: firstHarness,
  personId: person,
  screen: 'gates',
  itemId: null,
};
const onItem: PresenceQuery = {
  harnessId: firstHarness,
  personId: person,
  screen: 'item',
  itemId: item,
};

function describeWakes(subject: () => Promise<HubSubject>): void {
  it('observes a wake for the harness it names and no other', async () => {
    const opened = await subject();
    await opened.hub.wake(firstHarness);
    const wakes = await opened.wakes();
    expect(wakes).toContain(firstHarness);
    expect(wakes).not.toContain(secondHarness);
  });

  it('takes two wakes in a row for one harness', async () => {
    const opened = await subject();
    await expect(opened.hub.wake(firstHarness)).resolves.toBeUndefined();
    await expect(opened.hub.wake(firstHarness)).resolves.toBeUndefined();
    expect(await opened.wakes()).toContain(firstHarness);
  });
}

function describePresence(subject: () => Promise<HubSubject>): void {
  it('present answers false with no session and true for the person, screen and item that connected', async () => {
    const opened = await subject();
    expect(await opened.hub.present(gates)).toBe(false);
    await opened.enter(gates);
    expect(await opened.hub.present(gates)).toBe(true);
    expect(await opened.hub.present({ ...gates, personId: otherPerson })).toBe(false);
    expect(await opened.hub.present({ ...gates, screen: 'home' })).toBe(false);
    expect(await opened.hub.present({ ...gates, harnessId: secondHarness })).toBe(false);
  });

  it('an item screen session is presence for that item only', async () => {
    const opened = await subject();
    await opened.enter(onItem);
    expect(await opened.hub.present(onItem)).toBe(true);
    expect(await opened.hub.present({ ...onItem, itemId: otherItem })).toBe(false);
    expect(await opened.hub.present({ ...onItem, screen: 'gates', itemId: null })).toBe(false);
  });
}

export function describeHubContract(adapter: string, open: () => Promise<HubSubject>): void {
  describe(`DX-3 hub port contract on ${adapter}`, () => {
    describeWakes(open);
    describePresence(open);
  });
}

export function describeHubNotWired(adapter: string, hub: Hub): void {
  describeNotWired('hub', adapter, hub, { wake: true, present: true } satisfies Record<
    keyof Hub,
    true
  >);
}
