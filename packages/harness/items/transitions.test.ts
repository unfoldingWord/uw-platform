import type { Stage } from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import { exitDrafts, resolveExit } from './transitions.ts';

function stageAt(key: string, position: number): Stage {
  return {
    id: `00000000-0000-4000-8000-0000000009${position}`,
    harnessId: '00000000-0000-4000-8000-000000000900',
    key,
    title: key,
    position,
    bracket: 'build_package',
    agentPickup: 'allowed',
    exitGate: 'none',
    connector: 'none',
    wipLimit: 3,
    instructionsPageId: null,
    validators: [],
    feeds: [],
    paused: false,
  };
}

const first = stageAt('first', 10);
const second = stageAt('second', 20);
const third = stageAt('third', 30);
const stages = [third, first, second];

describe('resolveExit', () => {
  it('goes forward to the next stage by position when to is null', () => {
    expect(resolveExit(stages, first, null)).toEqual({ kind: 'forward', from: first, to: second });
  });

  it('goes forward to null from the last stage', () => {
    expect(resolveExit(stages, third, null)).toEqual({ kind: 'forward', from: third, to: null });
  });

  it('accepts the next stage key and refuses any other', () => {
    expect(resolveExit(stages, first, 'second')).toEqual({
      kind: 'forward',
      from: first,
      to: second,
    });
    expect(resolveExit(stages, first, 'third')).toBeNull();
    expect(resolveExit(stages, third, 'first')).toBeNull();
  });
});

describe('exitDrafts', () => {
  it('records stage_advanced for a forward exit, to null at the end', () => {
    expect(exitDrafts({ kind: 'forward', from: first, to: second })).toEqual([
      { name: 'stage_advanced', evidence: { from: 'first', to: 'second' } },
    ]);
    expect(exitDrafts({ kind: 'forward', from: third, to: null })).toEqual([
      { name: 'stage_advanced', evidence: { from: 'third', to: null } },
    ]);
  });

  it('records loop_edge_taken for a loop exit', () => {
    expect(exitDrafts({ kind: 'loop', from: third, to: first })).toEqual([
      { name: 'loop_edge_taken', evidence: { from: 'third', to: 'first' } },
    ]);
  });
});
