import { describe, expect, it } from 'vitest';
import type { Grant } from '@uw/contracts';
import { personPrincipal } from '@uw/core/principal';
import { readableRoutines } from './routine-reads.ts';

const at = new Date('2026-11-20T12:00:00.000Z');
const ownerId = '00000000-0000-4000-8000-000000000001';
const readerId = '00000000-0000-4000-8000-000000000002';
const routines = [{ id: 'routine-1', personId: ownerId }];

function reader(personId: string, grants: readonly Omit<Grant, 'grantId' | 'expiresAt'>[]) {
  return personPrincipal({
    personId,
    email: 'reader@unfoldingword.org',
    grants: grants.map((grant, index) => ({
      ...grant,
      grantId: `00000000-0000-4000-8000-0000000001${String(index + 10)}`,
      expiresAt: null,
    })) as Grant[],
    interactive: true,
  });
}

function shownTo(personId: string, grants: readonly Omit<Grant, 'grantId' | 'expiresAt'>[]) {
  return readableRoutines(reader(personId, grants), routines, '80-89', at).map((row) => row.id);
}

describe('#155 a routine is read on its workflow area, by its owner, or by an org admin', () => {
  it('shows none to an org viewer or an org editor', () => {
    expect(shownTo(readerId, [{ role: 'viewer', scopeKind: 'org', scopeArea: null }])).toEqual([]);
    expect(shownTo(readerId, [{ role: 'editor', scopeKind: 'org', scopeArea: null }])).toEqual([]);
  });

  it('shows it to a viewer on the area, an org admin and its owner', () => {
    expect(
      shownTo(readerId, [{ role: 'viewer', scopeKind: 'jd_area', scopeArea: '80-89' }]),
    ).toEqual(['routine-1']);
    expect(shownTo(readerId, [{ role: 'admin', scopeKind: 'org', scopeArea: null }])).toEqual([
      'routine-1',
    ]);
    expect(shownTo(ownerId, [])).toEqual(['routine-1']);
  });

  it('shows none to an admin of another area', () => {
    expect(
      shownTo(readerId, [{ role: 'admin', scopeKind: 'jd_area', scopeArea: '20-29' }]),
    ).toEqual([]);
  });
});
