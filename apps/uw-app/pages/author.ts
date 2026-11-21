import { sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { deviceOwnerSegment } from '@uw/contracts';
import { people } from '@uw/db/schema';

const HUMAN = 'human:';

export function authorPersonIs(identity: AnyPgColumn): SQL {
  return sql`${people.id}::text = CASE
    WHEN ${identity} LIKE 'human:%' THEN substr(${identity}, 7)
    WHEN ${identity} LIKE 'agent:%/%' THEN split_part(substr(${identity}, 7), '/', 1)
  END`;
}

export function authorName(identity: string, personName: string | null): string {
  if (personName === null) return identity;
  if (identity.startsWith(HUMAN)) return personName;
  if (deviceOwnerSegment(identity) !== null) return `${personName}'s agent`;
  return identity;
}
