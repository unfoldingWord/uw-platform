import {
  eventEvidenceSchemas,
  type EpicPlace,
  type HarnessEvent,
  type ItemState,
  type Stage,
} from '@uw/contracts';
import { itemIndex, openBlockers, passedShip, type ItemIndex } from '../items/blockers.ts';
import type { StoreTransaction } from '../ports.ts';
import type { EpicGroup, EpicNode, NotReady } from './types.ts';

const GROUP_LIMIT = 20;
const NOT_READY_LIMIT = 20;
const NOT_READY_MS = 30 * 86_400_000;
const RECENT_LIMIT = 500;

type Grouped = { readonly epic: EpicPlace; readonly members: ItemState[] };

function nodeOf(item: ItemState, index: ItemIndex, stages: readonly Stage[]): EpicNode {
  return {
    itemId: item.itemId,
    title: item.title,
    issue: item.issue,
    stageKey: item.stageKey,
    position: item.epic?.position ?? 0,
    blockedBy: item.blockedBy,
    waiting: openBlockers(item, index, stages).length > 0,
    passedShip: passedShip(item, stages),
  };
}

function byPlace(a: EpicNode, b: EpicNode): number {
  if (a.position !== b.position) return a.position - b.position;
  return a.itemId < b.itemId ? -1 : 1;
}

function grouped(items: readonly ItemState[]): readonly Grouped[] {
  const groups = new Map<number, Grouped>();
  for (const item of items) {
    if (item.epic === null) continue;
    const key = item.epic.issue.githubId;
    const group = groups.get(key) ?? { epic: item.epic, members: [] };
    group.members.push(item);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function epicGroupsOf(items: readonly ItemState[], stages: readonly Stage[]): readonly EpicGroup[] {
  const index = itemIndex(items);
  return grouped(items)
    .filter((group) => group.members.some((item) => item.gateStatus !== 'done'))
    .sort((a, b) => a.epic.issue.number - b.epic.issue.number)
    .slice(0, GROUP_LIMIT)
    .map((group) => ({
      epic: group.epic.issue,
      title: group.epic.title,
      nodes: group.members.map((item) => nodeOf(item, index, stages)).sort(byPlace),
    }));
}

type Subjects = { readonly issues: ReadonlySet<number>; readonly pageIds: ReadonlySet<string> };

function subjectsOf(items: readonly ItemState[]): Subjects {
  return {
    issues: new Set(items.flatMap((item) => (item.issue === null ? [] : [item.issue.githubId]))),
    pageIds: new Set(items.flatMap((item) => (item.pageId === null ? [] : [item.pageId]))),
  };
}

export function notReadyOf(
  events: readonly HarnessEvent[],
  items: readonly ItemState[],
): readonly NotReady[] {
  const { issues, pageIds } = subjectsOf(items);
  const seen = new Set<string>();
  const shown: NotReady[] = [];
  for (const event of events) {
    const parsed = eventEvidenceSchemas.done_when_missing.safeParse(event.evidence);
    if (!parsed.success || shown.length === NOT_READY_LIMIT) continue;
    const entry = parsed.data;
    const page = entry.pageId ?? '';
    const key = entry.issue === null ? `page:${page}` : `issue:${entry.issue.githubId}`;
    const imported = entry.issue === null ? pageIds.has(page) : issues.has(entry.issue.githubId);
    if (seen.has(key) || imported) continue;
    seen.add(key);
    shown.push({ ...entry, at: new Date(event.at) });
  }
  return shown;
}

export async function epicBoard(
  tx: StoreTransaction,
  harnessId: string,
  stages: readonly Stage[],
  at: Date,
): Promise<{ readonly epics: readonly EpicGroup[]; readonly notReady: readonly NotReady[] }> {
  const items = await tx.harnessItems.read.forHarness(harnessId);
  const events = await tx.harnessEvents.read.recent({
    since: new Date(at.getTime() - NOT_READY_MS),
    names: ['done_when_missing'],
    agentsOnly: false,
    limit: RECENT_LIMIT,
    harnessIds: [harnessId],
  });
  return { epics: epicGroupsOf(items, stages), notReady: notReadyOf(events, items) };
}
