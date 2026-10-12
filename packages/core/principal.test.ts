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

const owner = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const delegation = 'delegation:00000000-0000-4000-a000-000000000009';

function deviceAgent(identity: string, personId: string | null) {
  return { identity, kind: 'agent', personId, email: null, grants: [], interactive: true };
}

describe("a device identity is owned by its principal's person", () => {
  it.each([
    ['a device of another person', deviceAgent(`agent:${other}/laptop`, owner)],
    ['a device with no person', deviceAgent(`agent:${owner}/laptop`, null)],
    [
      'a delegated device of another person',
      deviceAgent(`agent:${other}/laptop as iterate via ${delegation}`, owner),
    ],
    [
      'a delegated device with no person',
      deviceAgent(`agent:${owner}/laptop as iterate via ${delegation}`, null),
    ],
  ])('refuses %s', (_label, principal) => {
    expect(() => parsePrincipal(principal)).toThrow();
  });

  it.each([
    ['a device of its person', deviceAgent(`agent:${owner}/laptop`, owner)],
    [
      'a delegated device of its person',
      deviceAgent(`agent:${owner}/laptop as iterate via ${delegation}`, owner),
    ],
  ])('accepts %s', (_label, principal) => {
    expect(parsePrincipal(principal)).toEqual(principal);
  });

  it('still accepts the platform and ingest identities, which name no device', () => {
    expect(parsePrincipal(systemPrincipal())).toEqual(systemPrincipal());
    expect(parsePrincipal(ingestPrincipal())).toEqual(ingestPrincipal());
  });
});

describe('AB-2 a bare agent identity is a lowercase slug', () => {
  const bare = (identity: string) => ({
    identity,
    kind: 'agent',
    personId: null,
    email: null,
    grants: [],
    interactive: false,
  });

  it('refuses agent:System and agent:Builder', () => {
    expect(() => parsePrincipal(bare('agent:System'))).toThrow();
    expect(() => parsePrincipal(bare('agent:Builder'))).toThrow();
  });

  it('still builds the system, ingest and service-token principals', () => {
    expect(systemPrincipal().identity).toBe('agent:system');
    expect(ingestPrincipal().identity).toBe('agent:ingest');
    expect(serviceTokenPrincipal('A1B2C3D4.Access').identity).toBe('agent:svc-a1b2c3d4-access');
    expect(serviceTokenPrincipal(`${'x'.repeat(200)}`).identity).toHaveLength(210);
  });
});
