import { stageBracketSchema, type Harness, type StageBracket } from '@uw/contracts';
import { grantedAreas } from '@uw/core/acl';
import type { Caller } from '../caller.ts';
import type { StoreTransaction } from '../ports.ts';
import type { ScenePorts } from '../reads/scene.ts';
import { decidableGates } from './gates.ts';
import { readableHarnesses } from './readable.ts';
import { VIEW_LIMIT, type PhaseCount, type QueueCard, type Queues } from './types.ts';

function phaseCounts(
  brackets: ReadonlyMap<string, StageBracket>,
  stageKeys: readonly string[],
): readonly PhaseCount[] {
  return stageBracketSchema.options.map((phase) => ({
    phase,
    count: stageKeys.filter((key) => brackets.get(key) === phase).length,
  }));
}

function earliest(times: readonly Date[]): Date | null {
  if (times.length === 0) return null;
  return new Date(Math.min(...times.map((time) => time.getTime())));
}

async function cardOf(tx: StoreTransaction, harness: Harness, waiting: number): Promise<QueueCard> {
  const stages = await tx.harnessStages.read.forHarness(harness.id);
  const brackets = new Map(stages.map((stage) => [stage.key, stage.bracket]));
  const open = await tx.harnessItems.read.openFor(harness.id, VIEW_LIMIT);
  const ids = open.map((item) => item.itemId);
  const entries = await tx.harnessEvents.read.enteredStage(harness.id, ids);
  return {
    harness,
    phases: phaseCounts(
      brackets,
      open.map((item) => item.stageKey),
    ),
    open: open.length,
    oldestEnteredAt: earliest(entries.map((entry) => entry.at)),
    waiting,
    capped: open.length === VIEW_LIMIT,
  };
}

function inGrantedArea(caller: Caller, at: Date): (harness: Harness) => boolean {
  const granted = grantedAreas(caller.actor, at);
  return (harness) => granted.kind === 'all' || granted.areas.includes(harness.jdArea);
}

export async function queuesView(
  ports: ScenePorts,
  tx: StoreTransaction,
  caller: Caller,
  at: Date,
): Promise<Queues> {
  const shown = (await readableHarnesses(ports, tx, caller, at)).filter(inGrantedArea(caller, at));
  const gates = await decidableGates(ports, tx, caller, at);
  const waiting = new Map<string, number>();
  for (const row of gates.rows) {
    waiting.set(row.harness.id, (waiting.get(row.harness.id) ?? 0) + 1);
  }
  const cards: QueueCard[] = [];
  for (const harness of shown) cards.push(await cardOf(tx, harness, waiting.get(harness.id) ?? 0));
  return { cards };
}
