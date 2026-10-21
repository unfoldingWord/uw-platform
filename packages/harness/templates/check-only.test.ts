import { describe, expect, it } from 'vitest';
import { templateKeySchema } from '@uw/contracts';
import { connectorRegistered, connectorRegistry } from '../connectors/registry.ts';
import { templateProperty } from '../template-property.ts';
import { templates } from '../templates.ts';
import { validatorRegistry } from '../validators/registry.ts';
import { checkOnly } from './check-only.ts';
import { personasOf } from './personas.ts';

describe('GL-2 the check-only template has Check and Ship and nothing before them', () => {
  it('has two stages, check then ship, gapped by 10 with WIP 3', () => {
    expect(checkOnly.key).toBe('check-only');
    expect(checkOnly.stages.map((stage) => stage.key)).toEqual(['check', 'ship']);
    expect(checkOnly.stages.map((stage) => stage.position)).toEqual([10, 20]);
    expect(checkOnly.stages.map((stage) => stage.wipLimit)).toEqual([3, 3]);
  });

  it('lets agents pick up Check and never Ship', () => {
    const [check, ship] = checkOnly.stages;
    expect(check?.agentPickup).toBe('allowed');
    expect(check?.exitGate).toBe('checks');
    expect(check?.connector).toBe('none');
    expect(ship?.agentPickup).toBe('none');
  });

  it('gates Ship on a human_approval exit with the merge connector and no feeds', () => {
    const ship = checkOnly.stages.find((stage) => stage.key === 'ship');
    expect(ship?.exitGate).toBe('human_approval');
    expect(ship?.connector).toBe('merge');
    expect(checkOnly.stages.every((stage) => stage.feeds.length === 0)).toBe(true);
  });

  it('passes the template property', () => {
    expect(templateProperty(checkOnly.stages)).toEqual([]);
  });

  it('names only registered validators and connectors', () => {
    for (const stage of checkOnly.stages) {
      for (const key of stage.validators) expect(validatorRegistry.has(key)).toBe(true);
      expect(connectorRegistered(stage.connector, connectorRegistry)).toBe(true);
    }
  });

  it('is registered under the key the command schema names, with the two Reviewer personas', () => {
    expect(templates.get('check-only')).toBe(checkOnly);
    expect(templateKeySchema.options).toContain('check-only');
    expect(personasOf('check-only').map((persona) => persona.slug)).toEqual([
      'reviewer',
      'reviewer-codex',
    ]);
  });
});
