import { describe, expect, it } from 'vitest';
import type { ItemState, Stage } from '@uw/contracts';
import { software } from '../templates/software.ts';
import { blockerCycle, itemIndex, openBlockers, passedShip } from './blockers.ts';

const harnessId = '00000000-0000-4000-8000-0000000000a1';
const stages: readonly Stage[] = software.stages.map((stage, index) => ({
  ...stage,
  id: `00000000-0000-4000-8000-00000000050${index}`,
  harnessId,
  instructionsPageId: null,
  paused: false,
  validators: [...stage.validators],
  feeds: [...stage.feeds],
}));

function item(n: number, stageKey: string, extra: Partial<ItemState> = {}): ItemState {
  return {
    itemId: `00000000-0000-4000-8000-00000000060${n}`,
    harnessId,
    stageKey,
    title: `Item ${n}`,
    pageId: null,
    priority: 0,
    due: null,
    holder: null,
    claimantKind: null,
    delegationId: null,
    leaseExpiresAt: null,
    gateStatus: 'working',
    gateTarget: null,
    branchState: 'none',
    expectedHead: null,
    riskTier: null,
    riskDomains: [],
    pullRequest: null,
    issue: null,
    zulipTopic: null,
    epic: null,
    blockedBy: [],
    ...extra,
  };
}

describe('EI-3 a blocker holds its dependants until its item has passed Ship', () => {
  it('passes Ship past the merge stage or when done, and not at or before it', () => {
    expect(passedShip(item(1, 'check'), stages)).toBe(false);
    expect(passedShip(item(1, 'ship', { gateStatus: 'parked' }), stages)).toBe(false);
    expect(passedShip(item(1, 'validate'), stages)).toBe(true);
    expect(passedShip(item(1, 'close', { gateStatus: 'done' }), stages)).toBe(true);
  });

  it('blocks again when the blocker loops back to Package, and blocks on a blocker it cannot read', () => {
    const blocker = item(1, 'package');
    const unread = item(9, 'package').itemId;
    const waiting = item(2, 'package', { blockedBy: [blocker.itemId, unread] });
    expect(openBlockers(waiting, [blocker], stages)).toEqual([blocker.itemId, unread]);
    const passed = [item(1, 'validate'), item(9, 'close', { gateStatus: 'done' })];
    expect(openBlockers(waiting, passed, stages)).toEqual([]);
    expect(openBlockers(waiting, itemIndex(passed), stages)).toEqual([]);
    expect(openBlockers(waiting, itemIndex([blocker]), stages)).toEqual([blocker.itemId, unread]);
  });

  it('passes a blocker only when done on a harness with no connector stage', () => {
    const plain = stages.map((stage) => ({ ...stage, connector: 'none' as const }));
    expect(passedShip(item(1, 'validate'), plain)).toBe(false);
    expect(passedShip(item(1, 'close', { gateStatus: 'done' }), plain)).toBe(true);
  });

  it('finds a cycle among blocker edges, a self edge included, and none in a chain', () => {
    const chain = new Map([
      [41, [42]],
      [42, [43]],
      [43, []],
    ]);
    const ring = new Map([
      [41, [43]],
      [42, [41]],
      [43, [42]],
    ]);
    expect(blockerCycle(chain)).toEqual([]);
    expect(blockerCycle(ring)).toEqual([41, 42, 43]);
    expect(blockerCycle(new Map([[44, [44]]]))).toEqual([44]);
  });
});
