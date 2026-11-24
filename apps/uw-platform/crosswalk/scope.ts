import { inArray, type AnyColumn, type SQL } from 'drizzle-orm';
import type { JdArea } from '@uw/contracts';
import { can, readableAreas } from '@uw/core/acl';
import type { Principal } from '@uw/core/principal';

const DECADES = 10;

export const decades: readonly JdArea[] = Array.from(
  { length: DECADES },
  (_, decade) => `${decade}0-${decade}9`,
);

export function areasRead(actor: Principal, at: Date): readonly JdArea[] {
  return decades.filter((area) => can(actor, 'read', { kind: 'area', area }, at));
}

export function readFilter(actor: Principal, at: Date, column: AnyColumn): SQL | undefined | null {
  const readable = readableAreas(actor, at);
  if (readable.kind === 'all') return undefined;
  if (readable.areas.length === 0) return null;
  return inArray(column, [...readable.areas]);
}
