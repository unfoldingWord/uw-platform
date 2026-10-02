import { describe, expect, it } from 'vitest';
import {
  ingestPrincipal,
  systemPrincipal,
  parsePrincipal,
  personPrincipal,
  serviceTokenPrincipal,
} from './principal.ts';

const person = personPrincipal({
  personId: '00000000-0000-4000-8000-000000000001',
  email: 'ian.lindsley@unfoldingword.org',
  grants: [
    {
      grantId: '00000000-0000-4000-8000-000000000101',
      role: 'admin',
      scopeKind: 'org',
      scopeArea: null,
      expiresAt: null,
    },
  ],
  interactive: true,
});

describe('FD-7 the principal', () => {
  it('names a person as human:<personId> and keeps the resolved grants', () => {
    expect(person.identity).toBe('human:00000000-0000-4000-8000-000000000001');
    expect(person.kind).toBe('person');
    expect(person.grants).toHaveLength(1);
  });

  it('survives serialisation into a queue message', () => {
    expect(parsePrincipal(JSON.parse(JSON.stringify(person)))).toEqual(person);
  });

  it('makes a service token non-interactive, with no grants of its own', () => {
    const agent = serviceTokenPrincipal('a1b2c3d4.access');
    expect(agent).toMatchObject({
      identity: 'agent:svc-a1b2c3d4-access',
      kind: 'agent',
      interactive: false,
      grants: [],
    });
  });

  it('names the ingest system identity agent:ingest', () => {
    expect(ingestPrincipal()).toMatchObject({
      identity: 'agent:ingest',
      kind: 'agent',
      personId: null,
      interactive: false,
    });
  });

  it('names the platform maintenance identity agent:system, with no person and no grants', () => {
    expect(systemPrincipal()).toEqual({
      identity: 'agent:system',
      kind: 'agent',
      personId: null,
      email: null,
      grants: [],
      interactive: false,
    });
  });

  it('refuses a principal whose kind and identity disagree', () => {
    expect(() => parsePrincipal({ ...person, identity: 'agent:builder' })).toThrow();
  });
});

describe('FD-7 a service token id', () => {
  it.each(['...', '', '---', '___'])('refuses %j because it leaves nothing to name', (clientId) => {
    expect(() => serviceTokenPrincipal(clientId)).toThrow(RangeError);
  });
});
