import { describe, expect, it } from 'vitest';
import type { EpicGroup, EpicNode } from '@uw/harness';
import { epicLayout, GAP_X, LABEL_CHARS, NODE_WIDTH, nodeLabel, PAD } from './epic-layout.ts';

function node(n: number, blockedBy: readonly string[] = []): EpicNode {
  return {
    itemId: `item-${n}`,
    title: `Item ${n}`,
    issue: { repo: 'unfoldingWord/uw-platform', number: 40 + n, githubId: 9100000340 + n },
    stageKey: 'package',
    position: n,
    blockedBy,
    waiting: blockedBy.length > 0,
    passedShip: false,
  };
}

const group: EpicGroup = {
  epic: { repo: 'unfoldingWord/uw-platform', number: 40, githubId: 9100000340 },
  title: 'Epic intake',
  nodes: [node(1), node(2), node(3, ['item-2']), node(4, ['item-3', 'item-9'])],
};

describe('EI-5 the epic drawing places each item after its blockers', () => {
  it('puts unblocked items in the first column and each dependant one column after its deepest blocker', () => {
    const laid = epicLayout(group);
    const xOf = (id: string) => laid.nodes.find((entry) => entry.itemId === id)?.x;
    const column = (depth: number) => PAD + depth * (NODE_WIDTH + GAP_X);
    expect([xOf('item-1'), xOf('item-2'), xOf('item-3'), xOf('item-4')]).toEqual([
      column(0),
      column(0),
      column(1),
      column(2),
    ]);
  });

  it('draws one edge per blocker inside the group and none for a blocker outside it', () => {
    const laid = epicLayout(group);
    expect(laid.edges.map((edge) => [edge.from, edge.to])).toEqual([
      ['item-2', 'item-3'],
      ['item-3', 'item-4'],
    ]);
    expect(laid.width).toBeGreaterThan(0);
    expect(laid.height).toBeGreaterThan(0);
  });
});

describe('EI-5 a node label fits its box', () => {
  it('keeps a short name and cuts a long title to the label length with an ellipsis', () => {
    expect(nodeLabel('#42')).toBe('#42');
    const cut = nodeLabel('Read every sub-issue of the epic and enqueue them');
    expect(cut).toHaveLength(LABEL_CHARS);
    expect(cut.endsWith('…')).toBe(true);
  });
});
