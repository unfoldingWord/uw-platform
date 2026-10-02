import type { Identity } from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import { personaMatches } from './beat.ts';
import type { Delegation } from '../ports.ts';

const delegationId = '00000000-0000-4000-8000-0000000d0001';

function delegationOf(persona: string): Delegation {
  return {
    id: delegationId,
    personId: '00000000-0000-4000-8000-000000000104',
    persona: persona as Identity,
    harnessId: '00000000-0000-4000-8000-0000000d0002',
    capability: 'iterate',
    grantedAt: new Date('2026-10-01T09:00:00.000Z'),
    expiresAt: new Date('2026-12-30T09:00:00.000Z'),
    revokedAt: null,
    lapsedAt: null,
    supersedes: null,
  };
}

function matches(identity: string): boolean {
  return personaMatches(identity as Identity, delegationOf('agent:iterate'));
}

describe('KN-16 a delegation names the persona that may act under it', () => {
  it('matches the persona itself', () => {
    expect(matches('agent:iterate')).toBe(true);
  });

  it('matches a device identity acting as the persona via this delegation', () => {
    expect(matches(`agent:jesse/laptop as iterate via delegation:${delegationId}`)).toBe(true);
  });

  it('does not match another persona', () => {
    expect(matches('agent:builder')).toBe(false);
    expect(matches(`agent:jesse/laptop as builder via delegation:${delegationId}`)).toBe(false);
  });

  it('does not match another delegation, a bare device, or a human', () => {
    expect(matches('agent:jesse/laptop as iterate via delegation:other')).toBe(false);
    expect(matches('agent:jesse/laptop')).toBe(false);
    expect(matches('human:00000000-0000-4000-8000-000000000104')).toBe(false);
  });
});
