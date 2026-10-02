import { describe, expect, it } from 'vitest';
import {
  principalSchema,
  verbRegistry,
  type JdArea,
  type Principal,
  type Role,
  type VerbDefinition,
} from '@uw/contracts';
import { toolCheck } from './tool-check.ts';

const at = new Date('2026-10-01T09:00:00.000Z');
const personId = '00000000-0000-4000-8000-000000000102';

function personWith(role: Role, area: JdArea): Principal {
  return principalSchema.parse({
    identity: `human:${personId}`,
    kind: 'person',
    personId,
    email: 'person2@unfoldingword.org',
    grants: [
      {
        grantId: '00000000-0000-4000-8000-000000020200',
        role,
        scopeKind: 'jd_area',
        scopeArea: area,
        expiresAt: null,
      },
    ],
    interactive: true,
  });
}

function check(verbs: readonly string[], role: Role, registry?: readonly VerbDefinition[]) {
  const activator = personWith(role, '30-39');
  return toolCheck({ personaSlug: 'iterate', verbs, activator, area: '30-39', at }, registry);
}

function servedListGifts(): readonly VerbDefinition[] {
  return verbRegistry.map((entry) =>
    entry.name === 'list_gifts' ? { ...entry, servedInV1: true } : entry,
  );
}

describe('AB-8 the tool check names the first verb a persona cannot have', () => {
  it('passes an all-served toolset an editor reaches', () => {
    expect(
      check(['search_pages', 'read_page', 'write_page', 'claim_item', 'get_health'], 'editor'),
    ).toBeNull();
  });

  it('names a verb that does not exist', () => {
    expect(check(['search_pages', 'summarise_measurements'], 'editor')).toEqual({
      verb: 'summarise_measurements',
      reason: 'unknown_verb',
      message: 'persona iterate requires verb summarise_measurements, which does not exist',
    });
  });

  it('names a registered verb that is not served as one that does not exist', () => {
    expect(check(['list_gifts'], 'editor')).toEqual({
      verb: 'list_gifts',
      reason: 'unknown_verb',
      message: 'persona iterate requires verb list_gifts, which does not exist',
    });
  });

  it('reports a forbidden verb before a verb that does not exist', () => {
    expect(check(['nope', 'approve'], 'editor')).toEqual({
      verb: 'approve',
      reason: 'forbidden_verb',
      message: 'persona iterate names approve, which no agent may hold',
    });
  });

  it('names a forbidden verb whatever its case or affix', () => {
    expect(check(['Gate_Approve'], 'editor')?.reason).toBe('forbidden_verb');
  });
});

describe("AB-8 the tool check judges a verb's reach by the activating person's grants", () => {
  it('names a resource-area verb the activating person does not reach', () => {
    expect(check(['claim_item'], 'viewer')).toEqual({
      verb: 'claim_item',
      reason: 'not_permitted',
      message:
        "persona iterate requires verb claim_item, which the activating person's grants do not reach",
    });
  });

  it('names a fixed-area verb the activating person does not reach', () => {
    expect(check(['search_pages', 'list_gifts'], 'admin', servedListGifts())).toEqual({
      verb: 'list_gifts',
      reason: 'not_permitted',
      message:
        "persona iterate requires verb list_gifts, which the activating person's grants do not reach",
    });
  });

  it('passes a fixed-area verb the activating person reaches', () => {
    const activator = personWith('editor', '40-49');
    const input = { personaSlug: 'iterate', verbs: ['list_gifts'], activator, area: '30-39', at };
    expect(toolCheck(input, servedListGifts())).toBeNull();
  });
});
