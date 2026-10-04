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
type Draft = Omit<Wake, 'recipients'> & {
  readonly personIds: readonly string[];
  readonly unlinked: boolean;
};

export type PlannedWake = { readonly wake: Wake; readonly unlinked: boolean };

async function holdersFor(
  ports: WakePlanPorts,
  triggers: readonly Trigger[],
  context: WakeContext,
  at: Date,
): Promise<Holders> {
  const areas = new Set<JdArea>();
  for (const { event } of triggers) {
    const harness = context.harnesses.get(event.harnessId);
    if (harness !== undefined) areas.add(harness.jdArea);
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
  return { itemRef: itemRefOf(item.item), topic: item.topic };
}

function peopleFor(
  trigger: Trigger,
  context: WakeContext,
  holders: Holders,
  scope: { readonly harness: Harness; readonly item: ItemContext | null; readonly at: Date },
): readonly string[] {
  const { event } = trigger;
  return recipientsOf({
    trigger,
    ...scope,
    run: triggerRun(context, event),
    delegation: triggerDelegation(context, event),
    holders: holders.get(scope.harness.jdArea) ?? [],
    delegationPerson: (id) => context.delegations.get(id)?.personId ?? null,
  });
}

function draftOf(trigger: Trigger, context: WakeContext, holders: Holders, at: Date): Draft | null {
  const { event, reason } = trigger;
  const harness = context.harnesses.get(event.harnessId);
  if (harness === undefined) return null;
  const item = event.itemId === null ? null : (context.items.get(event.itemId) ?? null);
  const itemId = item === null ? null : item.item.itemId;
  const link = linkOf(trigger, harness, itemId);
  if (link === null) return null;
  const personIds = peopleFor(trigger, context, holders, { harness, item, at });
  const base = { harnessId: harness.id, harnessKey: harness.key, jdArea: harness.jdArea };
  const unlinked = item !== null && item.linkable;
  const identity = { itemId, ...where(harness, item), reason, link, unlinked };
  return { ...base, ...identity, personIds, at, traceId: event.traceId };
}

const screens: ReadonlyMap<string, LiveScreen> = new Map<string, LiveScreen>([
  ['gate_waiting', 'gates'],
  ['delegation_lapsed', 'home'],
  ['run_failed', 'item'],
  ['stage_advanced', 'item'],
  ['handed_to_person', 'item'],
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

async function plannedOf(hub: Hub, draft: Draft): Promise<PlannedWake> {
  const { personIds, unlinked, ...wake } = draft;
  const recipients = await Promise.all(
    personIds.map((personId) => presentOn(hub, draft, personId)),
  );
  return { wake: { ...wake, recipients }, unlinked };
}

function worthSending(draft: Draft | null): draft is Draft {
  return draft !== null && (draft.personIds.length > 0 || POSTING_REASONS.has(draft.reason));
}

export async function planWakes(
  ports: WakePlanPorts,
  events: readonly HarnessEvent[],
): Promise<readonly PlannedWake[]> {
  const triggers = triggersOf(events);
  if (triggers.length === 0) return [];
  const at = ports.clock.now();
  const context = await ports.store.transaction((tx) => readWakeContext(tx, triggers, events));
  const holders = await holdersFor(ports, triggers, context, at);
  const drafts = triggers.map((trigger) => draftOf(trigger, context, holders, at));
  return Promise.all(drafts.filter(worthSending).map((draft) => plannedOf(ports.hub, draft)));
}
