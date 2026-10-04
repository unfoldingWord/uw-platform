import {
  gateLink,
  homeLink,
  itemLink,
  type DeepLink,
  type Harness,
  type HarnessEvent,
  type JdArea,
  type LiveScreen,
} from '@uw/contracts';
import type { GrantHolder, Hub, Ports, Wake, WakeRecipient } from '../ports.ts';
import {
  readWakeContext,
  triggerDelegation,
  triggerRun,
  type ItemContext,
  type WakeContext,
} from './context.ts';
import { POSTING_REASONS } from './rank.ts';
import { recipientsOf } from './recipients.ts';
import { itemRefOf, topicFor } from './topic.ts';
import { triggersOf, type Trigger } from './triggers.ts';

export type WakePlanPorts = Pick<Ports, 'store' | 'grants' | 'hub' | 'clock'>;

type Holders = ReadonlyMap<JdArea, readonly GrantHolder[]>;
type Draft = Omit<Wake, 'recipients'> & { readonly people: readonly string[] };

const needsHolders: ReadonlySet<string> = new Set(['gate_waiting', 'delegation_lapsed']);

async function holdersFor(
  ports: WakePlanPorts,
  triggers: readonly Trigger[],
  context: WakeContext,
  at: Date,
): Promise<Holders> {
  const areas = new Set<JdArea>();
  for (const { event, reason } of triggers) {
    const harness = context.harnesses.get(event.harnessId);
    if (harness !== undefined && needsHolders.has(reason)) areas.add(harness.jdArea);
  }
  const holders = new Map<JdArea, readonly GrantHolder[]>();
  for (const area of areas) holders.set(area, await ports.grants.holders(area, at));
  return holders;
}

function linkOf(trigger: Trigger, harness: Harness, itemId: string | null): DeepLink | null {
  if (trigger.reason === 'delegation_lapsed') return homeLink;
  if (itemId === null) return null;
  return trigger.reason === 'gate_waiting'
    ? gateLink(harness.id, itemId)
    : itemLink(harness.id, itemId);
}

function where(harness: Harness, item: ItemContext | null) {
  if (item === null) return { itemRef: null, topic: topicFor(harness.key, null) };
  const itemRef = itemRefOf(item.item);
  return { itemRef, topic: item.item.zulipTopic ?? topicFor(harness.key, itemRef) };
}

function draftOf(trigger: Trigger, context: WakeContext, holders: Holders, at: Date): Draft | null {
  const { event, reason } = trigger;
  const harness = context.harnesses.get(event.harnessId);
  const item = event.itemId === null ? null : (context.items.get(event.itemId) ?? null);
  if (harness === undefined) return null;
  const link = linkOf(trigger, harness, item?.item.itemId ?? null);
  if (link === null) return null;
  const people = recipientsOf({
    trigger,
    harness,
    item,
    run: triggerRun(context, event),
    delegation: triggerDelegation(context, event),
    holders: holders.get(harness.jdArea) ?? [],
    delegationPerson: (id) => context.delegations.get(id)?.personId ?? null,
    at,
  });
  const base = { harnessId: harness.id, harnessKey: harness.key, jdArea: harness.jdArea };
  const identity = { itemId: item?.item.itemId ?? null, ...where(harness, item), reason, link };
  return { ...base, ...identity, people, at, traceId: event.traceId };
}

const screens: ReadonlyMap<string, LiveScreen> = new Map<string, LiveScreen>([
  ['gate_waiting', 'gates'],
  ['delegation_lapsed', 'home'],
  ['run_failed', 'item'],
  ['stage_advanced', 'item'],
]);

async function presentOn(hub: Hub, draft: Draft, personId: string): Promise<WakeRecipient> {
  const screen = screens.get(draft.reason) ?? 'home';
  const itemId = screen === 'item' ? draft.itemId : null;
  try {
    return {
      personId,
      present: await hub.present({ harnessId: draft.harnessId, personId, screen, itemId }),
    };
  } catch {
    return { personId, present: false };
  }
}

async function wakeOf(hub: Hub, draft: Draft): Promise<Wake> {
  const { people, ...wake } = draft;
  const recipients = await Promise.all(people.map((personId) => presentOn(hub, draft, personId)));
  return { ...wake, recipients };
}

function worthSending(draft: Draft | null): draft is Draft {
  return draft !== null && (draft.people.length > 0 || POSTING_REASONS.has(draft.reason));
}

export async function planWakes(
  ports: WakePlanPorts,
  events: readonly HarnessEvent[],
): Promise<readonly Wake[]> {
  const triggers = triggersOf(events);
  if (triggers.length === 0) return [];
  const at = ports.clock.now();
  const context = await ports.store.transaction((tx) => readWakeContext(tx, triggers, events));
  const holders = await holdersFor(ports, triggers, context, at);
  const drafts = triggers.map((trigger) => draftOf(trigger, context, holders, at));
  return Promise.all(drafts.filter(worthSending).map((draft) => wakeOf(ports.hub, draft)));
}
