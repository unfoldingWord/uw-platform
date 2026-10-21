import { describe, expect, it } from 'vitest';
import { principalSchema, type Principal } from '@uw/contracts';
import { clearanceKey } from './clearance.ts';

const at = new Date('2026-10-15T12:00:00.000Z');

function grant(n: number, role: string, scopeArea: string | null, expiresAt: string | null = null) {
  return {
    grantId: `00000000-0000-4000-8000-0000000134${String(n).padStart(2, '0')}`,
    role,
    scopeKind: scopeArea === null ? 'org' : 'jd_area',
    scopeArea,
    expiresAt,
  };
}

function reader(identity: string, grants: readonly object[]): Principal {
  return principalSchema.parse({
    identity,
    kind: 'agent',
    personId: null,
    email: null,
    grants,
    interactive: false,
  });
}

describe('UC-5 a cache of model output keys on the reader clearance', () => {
  it('UC-5 gives two readers of the same areas the same key, whatever their identity', () => {
    const one = reader('agent:reviewer', [grant(1, 'viewer', '80-89')]);
    const two = reader('agent:builder', [grant(2, 'viewer', '80-89')]);
    expect(clearanceKey(one, at)).toBe('clearance:80-89');
    expect(clearanceKey(two, at)).toBe(clearanceKey(one, at));
  });

  it('UC-5 changes the key when a grant adds an area', () => {
    const wider = reader('agent:reviewer', [
      grant(1, 'viewer', '80-89'),
      grant(2, 'viewer', '30-39'),
    ]);
    expect(clearanceKey(wider, at)).toBe('clearance:30-39,80-89');
  });

  it('UC-5 leaves out a grant that has expired at the instant', () => {
    const lapsed = grant(2, 'viewer', '30-39', '2026-10-01T00:00:00.000Z');
    expect(clearanceKey(reader('agent:reviewer', [grant(1, 'viewer', '80-89'), lapsed]), at)).toBe(
      'clearance:80-89',
    );
  });

  it('UC-5 keys an editor and an org reader as reading every area, as FD-8 says', () => {
    expect(clearanceKey(reader('agent:builder', [grant(1, 'editor', '80-89')]), at)).toBe(
      'clearance:all',
    );
    expect(clearanceKey(reader('agent:auditor', [grant(2, 'viewer', null)]), at)).toBe(
      'clearance:all',
    );
    expect(clearanceKey(reader('agent:nobody', []), at)).toBe('clearance:');
  });
});
