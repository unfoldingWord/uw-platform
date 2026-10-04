import { evidenceLabelSchema, type EvidenceLabel, type HarnessEvent } from '@uw/contracts';
import { allowed } from '../access.ts';
import type { Caller } from '../caller.ts';
import { readEventPage } from '../items/events.ts';
import { accepted, type KernelOutcome } from '../outcome.ts';
import type { StoreTransaction } from '../ports.ts';
import { itemScene, type ScenePorts } from '../reads/scene.ts';
import { PLAY_PAGE, type PlayByPlay } from './types.ts';

export type PlayInput = { readonly itemId: string; readonly after: number };

function attachedPages(events: readonly HarnessEvent[]): readonly string[] {
  const ids = events
    .filter((event) => event.name === 'learning_attached')
    .map((event) => event.evidence['pageId'])
    .filter((pageId): pageId is string => typeof pageId === 'string');
  return [...new Set(ids)];
}

async function learningsOf(
  tx: StoreTransaction,
  caller: Caller,
  events: readonly HarnessEvent[],
  at: Date,
): Promise<Readonly<Record<string, EvidenceLabel>>> {
  const pages = await tx.pages.read.facts(attachedPages(events));
  const labels: [string, EvidenceLabel][] = [];
  for (const page of pages) {
    if (!allowed(caller.actor, 'read', page, at)) continue;
    const label = evidenceLabelSchema.safeParse(page.frontmatter['confidence']);
    if (page.type === 'learning' && label.success) labels.push([page.id, label.data]);
  }
  return Object.fromEntries(labels);
}

export async function playByPlay(
  ports: ScenePorts,
  tx: StoreTransaction,
  caller: Caller,
  input: PlayInput,
  at: Date,
): Promise<KernelOutcome<PlayByPlay>> {
  const scene = await itemScene(ports, tx, caller, input.itemId, at);
  if (scene.status !== 'accepted') return scene;
  const { item, harness, stage } = scene.value;
  const query = {
    harnessId: harness.id,
    itemId: item.itemId,
    after: input.after,
    limit: PLAY_PAGE,
  };
  const page = await readEventPage(ports, tx, caller, query, at);
  if (page.status !== 'accepted') return page;
  const { events, next } = page.value;
  const learnings = await learningsOf(tx, caller, events, at);
  return accepted({ harness, stage, item, events, next, learnings });
}
