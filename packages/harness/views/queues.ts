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

type CardFacts = { readonly waiting: number; readonly entries: ReadonlyMap<string, Date> };

async function cardOf(
  tx: StoreTransaction,
  harness: Harness,
  facts: CardFacts,
): Promise<QueueCard> {
  const stages = await tx.harnessStages.read.forHarness(harness.id);
  const brackets = new Map(stages.map((stage) => [stage.key, stage.bracket]));
  const open = await tx.harnessItems.read.openFor(harness.id, VIEW_LIMIT);
  const entered = open.flatMap((item) => {
    const at = facts.entries.get(item.itemId);
    return at === undefined ? [] : [at];
  });
  return {
    harness,
    phases: phaseCounts(
      brackets,
      open.map((item) => item.stageKey),
    ),
    open: open.length,
    oldestEnteredAt: earliest(entered),
    waiting: facts.waiting,
    capped: open.length === VIEW_LIMIT,
  };
}

async function entriesOf(
  tx: StoreTransaction,
  harnesses: readonly Harness[],
): Promise<ReadonlyMap<string, Date>> {
  const opens = await Promise.all(
    harnesses.map((harness) => tx.harnessItems.read.openFor(harness.id, VIEW_LIMIT)),
  );
  const entries = await tx.harnessEvents.read.enteredStages(
    opens.flat().map((item) => item.itemId),
  );
  return new Map(entries.map((entry) => [entry.itemId, entry.at]));
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
  const entries = await entriesOf(tx, shown);
  const cards = await Promise.all(
    shown.map((harness) => cardOf(tx, harness, { waiting: waiting.get(harness.id) ?? 0, entries })),
  );
  return { cards };
}
