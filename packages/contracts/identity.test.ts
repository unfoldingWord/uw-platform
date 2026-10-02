import { describe, expect, it } from 'vitest';
import {
  delegatedIdentity,
  delegationIdOf,
  deviceOwnerSegment,
  identitySchema,
  isPersonaIdentity,
  personaSlugOf,
} from './identity.ts';

const delegated = 'agent:p1/laptop as iterate via delegation:d1';

describe('the delegated identity is built in one place', () => {
  it('builds the delegated form from a device, a persona slug and a delegation id', () => {
    expect(delegatedIdentity('agent:p1/laptop', 'iterate', 'd1')).toBe(delegated);
  });

  it('reads the owner segment only from a device identity', () => {
    expect(deviceOwnerSegment(delegated)).toBe('p1');
    expect(deviceOwnerSegment('agent:p1/laptop')).toBe('p1');
    expect(deviceOwnerSegment('agent:iterate')).toBeNull();
    expect(deviceOwnerSegment('human:p1')).toBeNull();
  });

  it('reads the delegation id only from the delegated form', () => {
    expect(delegationIdOf(delegated)).toBe('d1');
    expect(delegationIdOf('agent:p1/laptop')).toBeNull();
  });

  it('reads the persona slug from a persona identity or the delegated form', () => {
    expect(personaSlugOf(delegated)).toBe('iterate');
    expect(personaSlugOf('agent:iterate')).toBe('iterate');
    expect(personaSlugOf('agent:p1/laptop')).toBeNull();
    expect(personaSlugOf('human:p1')).toBeNull();
  });
});

describe('a persona identity', () => {
  it.each(['agent:iterate', 'agent:builder'])('accepts %s', (value) => {
    expect(isPersonaIdentity(value)).toBe(true);
  });

  it.each([
    'agent:ingest',
    'agent:System',
    'agent:INGEST',
    'agent:Iterate',
    'agent:p1/laptop',
    delegated,
    'human:p1',
  ])('refuses %s', (value) => {
    expect(isPersonaIdentity(value)).toBe(false);
  });
});

describe('the device and persona slots of an identity', () => {
  it.each(['agent:p1/laptop', 'agent:p1/hourly-routine', delegated])('accepts %s', (value) => {
    expect(identitySchema.safeParse(value).success).toBe(true);
  });

  it.each([
    'agent:p1/Laptop',
    'agent:p1/my_laptop',
    'agent:p1/laptop as Iterate via delegation:d1',
    'agent:p1/laptop as ingest via delegation:d1',
    'agent:p1/Laptop as iterate via delegation:d1',
  ])('refuses %s', (value) => {
    expect(identitySchema.safeParse(value).success).toBe(false);
  });
});
