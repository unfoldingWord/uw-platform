import type { Connector, Stage } from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import type { EffectConnector } from '../ports.ts';
import { stageProblems } from '../stages/rules.ts';
import { connectorRegistered, connectorRegistry } from './registry.ts';

const planted: ReadonlySet<EffectConnector> = new Set<EffectConnector>(['merge']);

function stageWith(connector: Connector): Stage {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    harnessId: '00000000-0000-4000-8000-000000000002',
    key: 'extra',
    title: 'Extra',
    position: 90,
    bracket: 'iterate',
    agentPickup: 'allowed',
    exitGate: 'human_approval',
    connector,
    wipLimit: 3,
    instructionsPageId: null,
    validators: [],
    feeds: [],
    paused: false,
  };
}

describe('KN-18 a connector is written only when its handler is registered', () => {
  it('registers every effect connector, and none always', () => {
    expect([...connectorRegistry].sort()).toEqual(['deploy', 'merge', 'post', 'publish', 'send']);
    for (const connector of ['merge', 'deploy', 'publish', 'send', 'post', 'none'] as const) {
      expect(connectorRegistered(connector, connectorRegistry)).toBe(true);
    }
  });

  it('answers from the registry it is given', () => {
    expect(connectorRegistered('merge', planted)).toBe(true);
    expect(connectorRegistered('deploy', planted)).toBe(false);
    expect(connectorRegistered('none', planted)).toBe(true);
  });

  it('refuses at write time a stage whose connector the registry does not hold', () => {
    expect(stageProblems([stageWith('deploy')], planted)).toMatchObject({
      status: 'error',
      reason: 'connector_not_registered',
      detail: { stage: 'extra', connector: 'deploy' },
    });
    expect(stageProblems([stageWith('merge')], planted)).toBeNull();
    expect(stageProblems([stageWith('deploy')])).toBeNull();
  });
});
