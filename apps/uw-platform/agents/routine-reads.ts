import type { JdArea, Principal } from '@uw/contracts';
import { can } from '@uw/core/acl';

export function readableRoutines<R extends { readonly personId: string }>(
  actor: Principal,
  rows: readonly R[],
  area: JdArea,
  at: Date,
): readonly R[] {
  return rows.filter((row) =>
    can(actor, 'read', { kind: 'row', table: 'routines', area, ownerId: row.personId }, at),
  );
}
