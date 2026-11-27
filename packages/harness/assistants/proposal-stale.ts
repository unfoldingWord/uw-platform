import { draft, recordHarnessEvents, type RecordContext } from '../items/record.ts';
import { lockKeys } from '../lock-keys.ts';
import type { AssistantEffectRow, Ports, StoreTransaction } from '../ports.ts';

type StalePorts = Pick<Ports, 'store'>;

async function settledIn(
  tx: StoreTransaction,
  context: RecordContext,
  effect: AssistantEffectRow,
): Promise<boolean> {
  await tx.lock(lockKeys.assistantHarness(effect.harnessId));
  if (await tx.assistantEffects.read.settled(effect.harnessId, effect.id)) return false;
  await recordHarnessEvents(tx, context, effect.harnessId, [
    draft('assistant_effect_failed', {
      effectId: effect.id,
      kind: effect.kind,
      why: 'outcome_unknown',
    }),
  ]);
  return true;
}

export async function settleStaleProposalEffects(
  ports: StalePorts,
  context: RecordContext,
  startedBefore: Date,
  limit: number,
): Promise<readonly string[]> {
  const open = await ports.store.transaction((tx) =>
    tx.assistantEffects.read.openProposals(startedBefore, limit),
  );
  const unknown: string[] = [];
  for (const effect of open) {
    const settled = await ports.store.transaction((tx) => settledIn(tx, context, effect));
    if (settled) unknown.push(effect.id);
  }
  return unknown;
}
