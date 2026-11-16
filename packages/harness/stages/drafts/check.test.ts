import { describe, expect, it } from 'vitest';
import type { DraftStage } from '@uw/contracts';
import { shapeProblems } from './check.ts';

function stage(key: string, change: Partial<DraftStage> = {}): DraftStage {
  return {
    id: null,
    key,
    title: key.charAt(0).toUpperCase() + key.slice(1),
    bracket: 'build_package',
    agentPickup: 'allowed',
    exitGate: 'checks',
    connector: 'none',
    wipLimit: 3,
    instructionsPageId: null,
    validators: [],
    feeds: [],
    ...change,
  };
}

const codes = (stages: readonly DraftStage[]) =>
  shapeProblems(stages).map((entry) => [entry.stage, entry.code]);

describe('#103 the draft check names every problem on the stage it is about', () => {
  it('finds nothing wrong with a clean workflow', () => {
    const clean = [
      stage('build'),
      stage('ship', { exitGate: 'human_approval', connector: 'merge' }),
    ];
    expect(codes(clean)).toEqual([]);
  });

  it('needs at least one stage', () => {
    expect(codes([])).toEqual([[null, 'no_stages']]);
  });

  it('flags a loop arrow to a stage that is not in the workflow', () => {
    expect(codes([stage('build', { feeds: ['gone'] })])).toEqual([
      ['build', 'unknown_loop_target'],
    ]);
  });

  it('flags a merge that leaves its stage without a person approving', () => {
    expect(codes([stage('ship', { connector: 'merge' })])).toEqual([
      ['ship', 'connector_needs_person'],
    ]);
  });

  it('flags a repeated key on the second stage that uses it', () => {
    expect(codes([stage('build'), stage('build')])).toEqual([['build', 'key_repeated']]);
  });

  it('flags a blank title, a limit below 1 and an unknown check, all at once', () => {
    expect(codes([stage('build', { title: ' ', wipLimit: 0, validators: ['made_up'] })])).toEqual([
      ['build', 'title_blank'],
      ['build', 'wip_limit_low'],
      ['build', 'unknown_validator'],
    ]);
  });

  it('flags an action the platform cannot run', () => {
    const registry = new Set<'merge'>(['merge']);
    const found = shapeProblems(
      [stage('post', { connector: 'post', exitGate: 'human_approval' })],
      registry,
    );
    expect(found.map((entry) => entry.code)).toEqual(['connector_not_registered']);
  });

  it('says what is wrong in plain words', () => {
    const [found] = shapeProblems([stage('build', { feeds: ['gone'] })]);
    expect(found?.message).toBe('Build loops back to gone, which is not in the workflow.');
  });
});
