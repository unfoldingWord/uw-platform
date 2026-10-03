import { describe, expect, it } from 'vitest';
import { connectorRegistered, connectorRegistry } from '../connectors/registry.ts';
import { validatorRegistry } from '../validators/registry.ts';
import { bml } from './bml.ts';
import { software } from './software.ts';

const keys = ['package', 'scope', 'plan', 'build', 'check', 'ship', 'validate', 'close'];
const brackets = [
  'product_package',
  'build_package',
  'build_package',
  'build_package',
  'build_package',
  'deploy_package',
  'iterate',
  'iterate',
];
const pickups = ['none', 'allowed', 'allowed', 'allowed', 'allowed', 'none', 'allowed', 'allowed'];

describe.each([
  ['software', software, 'merge'],
  ['bml', bml, 'publish'],
] as const)('KN-15 %s ships as eight stages', (_name, template, connector) => {
  it('has the eight keys at positions gapped by 10 with WIP 3', () => {
    expect(template.stages.map((stage) => stage.key)).toEqual(keys);
    expect(template.stages.map((stage) => stage.position)).toEqual([
      10, 20, 30, 40, 50, 60, 70, 80,
    ]);
    expect(template.stages.map((stage) => stage.wipLimit)).toEqual(Array(8).fill(3));
  });

  it('puts each stage in its bracket with its default pickup', () => {
    expect(template.stages.map((stage) => stage.bracket)).toEqual(brackets);
    expect(template.stages.map((stage) => stage.agentPickup)).toEqual(pickups);
  });

  it('gates Ship on a human_approval exit with the connector', () => {
    const ship = template.stages.find((stage) => stage.key === 'ship');
    expect(ship).toMatchObject({ exitGate: 'human_approval', connector });
  });

  it('closes with learning_attached and feeds Scope, and Validate feeds Package', () => {
    const byKey = new Map(template.stages.map((stage) => [stage.key, stage]));
    expect(byKey.get('close')).toMatchObject({
      validators: ['learning_attached'],
      feeds: ['scope'],
    });
    expect(byKey.get('validate')).toMatchObject({ feeds: ['package'] });
  });
});

describe('KN-15 every validator key a template names exists', () => {
  it.each([software, bml])('$key', (template) => {
    for (const stage of template.stages) {
      for (const key of stage.validators) expect(validatorRegistry.has(key)).toBe(true);
    }
  });
});

describe('KN-15 every connector a template names is registered', () => {
  it.each([software, bml])('$key', (template) => {
    for (const stage of template.stages)
      expect(connectorRegistered(stage.connector, connectorRegistry)).toBe(true);
  });
});
