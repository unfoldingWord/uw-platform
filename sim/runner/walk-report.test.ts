import { describe, expect, it } from 'vitest';
import type { Template, WalkStage } from '@uw/harness';
import { formatTemplateWalk } from './walk-report.ts';

function stage(key: string, position: number, extra: Partial<WalkStage> = {}): WalkStage {
  return { key, position, exitGate: 'none', connector: 'none', feeds: [], ...extra };
}

const eightStages: Template = {
  key: 'fixture',
  title: 'A fixture template',
  stages: [
    stage('package', 10),
    stage('scope', 20),
    stage('plan', 30, { exitGate: 'checks' }),
    stage('build', 40, { exitGate: 'checks' }),
    stage('check', 50, { exitGate: 'checks' }),
    stage('ship', 60, { exitGate: 'human_approval', connector: 'merge' }),
    stage('validate', 70, { feeds: ['package'] }),
    stage('close', 80, { exitGate: 'checks', feeds: ['scope'] }),
  ],
};

const selfFeeding: Template = {
  key: 'loop',
  title: 'A self-feeding template',
  stages: [stage('post', 10, { exitGate: 'human_approval', connector: 'post', feeds: ['post'] })],
};

const noEffect: Template = {
  key: 'quiet',
  title: 'A template with no effect',
  stages: [stage('draft', 10), stage('review', 20, { exitGate: 'checks' })],
};

describe('DX-5 KN-9 walk prints every path to an external effect and the gate each crosses', () => {
  it('prints the one path of the eight-stage template with each stage gate and connector', () => {
    expect(formatTemplateWalk(eightStages)).toBe(
      [
        'template fixture (A fixture template): 1 path to an external effect',
        '  1. package [none] > scope [none] > plan [checks] > build [checks] > check [checks] > ship [human_approval, merge]',
      ].join('\n'),
    );
  });

  it('counts paths in the plural and marks a revisited stage as again', () => {
    expect(formatTemplateWalk(selfFeeding)).toBe(
      [
        'template loop (A self-feeding template): 2 paths to an external effect',
        '  1. post [human_approval, post]',
        '  2. post [human_approval, post] > post again [human_approval, post]',
      ].join('\n'),
    );
  });

  it('says so when no path reaches an external effect', () => {
    expect(formatTemplateWalk(noEffect)).toBe(
      'template quiet (A template with no effect): no path reaches an external effect',
    );
  });
});
