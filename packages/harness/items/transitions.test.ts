import { principalSchema, type Stage } from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import { exitDrafts, isOccasionalTweak, resolveExit, unattendedLoop } from './transitions.ts';

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

describe('loop exits', () => {
  const fed = { ...third, feeds: ['first', 'second'] };

  it('resolves a feeds target that is not the next stage to a loop exit', () => {
    expect(resolveExit(stages, fed, 'first')).toEqual({ kind: 'loop', from: fed, to: first });
  });

  it('keeps a feeds target that is the next stage a forward exit', () => {
    const early = { ...first, feeds: ['second'] };
    expect(resolveExit(stages, early, 'second')).toEqual({
      kind: 'forward',
      from: early,
      to: second,
    });
  });

  it('marks only a loop to the lowest position as the occasional tweak', () => {
    expect(isOccasionalTweak(stages, { kind: 'loop', from: fed, to: first })).toBe(true);
    expect(isOccasionalTweak(stages, { kind: 'loop', from: fed, to: second })).toBe(false);
    expect(isOccasionalTweak(stages, { kind: 'forward', from: first, to: second })).toBe(false);
  });

  it('flags only an unattended loop without a delegation id', () => {
    const loop = { kind: 'loop', from: fed, to: first } as const;
    const agent = (interactive: boolean) =>
      principalSchema.parse({
        identity: 'agent:00000000-0000-4000-8000-000000000006/runner',
        kind: 'agent',
        personId: '00000000-0000-4000-8000-000000000006',
        email: null,
        grants: [],
        interactive,
      });
    const runner = agent(false);
    const attended = agent(true);
    expect(unattendedLoop(loop, runner, null)).toBe(true);
    expect(unattendedLoop(loop, runner, 'd')).toBe(false);
    expect(unattendedLoop(loop, attended, null)).toBe(false);
  });
});
