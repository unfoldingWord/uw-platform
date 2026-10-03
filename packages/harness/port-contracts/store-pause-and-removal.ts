import { expect, it } from 'vitest';
import { identitySchema } from '@uw/contracts';
import type { Store } from '../ports.ts';
import { at, itemOf, refusedBy, seedHarness, uid } from './store-gateway-fixtures.ts';

type RemovalSubject = () => { readonly store: Store };

export function describeHarnessPause(subject: RemovalSubject): void {
  it('DX-3 sets a harness paused and back', async () => {
    const seen = await subject().store.transaction(async (tx) => {
      await seedHarness(tx, 0x2500, 'gateway-pause');
      const pausedOf = async () => (await tx.harnesses.read.byId(uid(0x2500)))?.paused;
      const set = await tx.harnesses.write.setPaused(uid(0x2500), true);
      const paused = await pausedOf();
      const unset = await tx.harnesses.write.setPaused(uid(0x2500), false);
      return [set, paused, unset, await pausedOf()];
    });
    expect(seen).toEqual([true, true, true, false]);
  });

  it('DX-3 reports that no harness was paused when the id names none', async () => {
    const found = await subject().store.transaction((tx) =>
      tx.harnesses.write.setPaused(uid(0x25fe), true),
    );
    expect(found).toBe(false);
  });
}

export function describeStageRemoval(subject: RemovalSubject): void {
  it('DX-3 removes a stage that holds no item', async () => {
    const keys = await subject().store.transaction(async (tx) => {
      const { review } = await seedHarness(tx, 0x2600, 'gateway-remove');
      const removed = await tx.harnessStages.write.remove(review.id);
      const left = await tx.harnessStages.read.forHarness(uid(0x2600));
      return { removed, keys: left.map((stage) => stage.key) };
    });
    expect(keys).toEqual({ removed: true, keys: ['build', 'ship'] });
  });

  it('DX-3 reports that no stage was removed when the id names none', async () => {
    const removed = await subject().store.transaction((tx) =>
      tx.harnessStages.write.remove(uid(0x26fe)),
    );
    expect(removed).toBe(false);
  });

  it('DX-3 refuses to remove a stage that holds an item, naming harness_items_stage_fk', async () => {
    const outcome = await refusedBy(async (tx) => {
      const { build } = await seedHarness(tx, 0x2700, 'gateway-remove-held');
      await tx.harnessItems.write.insert(itemOf(0x2700, 1), at);
      await tx.harnessStages.write.remove(build.id);
    }, subject().store);
    expect(outcome).toMatchObject({ code: '23503', constraint: 'harness_items_stage_fk' });
  });

  it('DX-3 refuses to remove a stage with gate decisions, naming gate_decisions_stage_fk', async () => {
    const outcome = await refusedBy(async (tx) => {
      const { review } = await seedHarness(tx, 0x2800, 'gateway-remove-decided');
      const item = itemOf(0x2800, 1);
      await tx.harnessItems.write.insert(item, at);
      await tx.gateDecisions.write.insert({
        id: uid(0x2881),
        harnessId: uid(0x2800),
        itemId: item.itemId,
        stageId: review.id,
        actor: identitySchema.parse('human:ian'),
        decision: 'approve',
        reason: null,
        evidence: { findings: [], gateTarget: null },
        traceId: uid(0x2891),
        decidedAt: at,
      });
      await tx.harnessStages.write.remove(review.id);
    }, subject().store);
    expect(outcome).toMatchObject({ code: '23503', constraint: 'gate_decisions_stage_fk' });
  });
}
