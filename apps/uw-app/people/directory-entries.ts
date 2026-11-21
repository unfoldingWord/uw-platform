import { sql } from 'drizzle-orm';
import type { Principal } from '@uw/core/principal';
import { can } from '@uw/core/acl';
import type { Transaction } from '@uw/db/client';
import { directoryEntries, directoryPrivate } from '@uw/db/schema';

const DIRECTORY_AREA = '10-19';

export type DirectoryColumn =
  | 'role'
  | 'team'
  | 'employment'
  | 'ring'
  | 'joined'
  | 'url'
  | 'portfolios'
  | 'phone'
  | 'mailing_address'
  | 'compliance_status'
  | 'compliance_due';

const publicFields = {
  role: 'role',
  team: 'team',
  employment: 'employment',
  ring: 'ring',
  joined: 'joined',
  url: 'url',
  portfolios: 'portfolios',
} as const;

const privateFields = {
  phone: 'phone',
  mailing_address: 'mailingAddress',
  compliance_status: 'complianceStatus',
  compliance_due: 'complianceDue',
} as const;

const ownContactColumns: ReadonlySet<DirectoryColumn> = new Set([
  'phone',
  'mailing_address',
  'url',
]);

export function mayWriteDirectory(
  actor: Principal,
  personId: string,
  column: DirectoryColumn,
  at: Date,
): boolean {
  if (can(actor, 'admin', { kind: 'area', area: DIRECTORY_AREA }, at)) return true;
  const self = actor.kind === 'person' && actor.personId === personId;
  return self && ownContactColumns.has(column);
}

export type DirectoryWrite = { readonly actor: Principal; readonly at: Date };

function fieldFor(column: DirectoryColumn) {
  if (column in publicFields) {
    return { table: directoryEntries, field: publicFields[column as keyof typeof publicFields] };
  }
  return { table: directoryPrivate, field: privateFields[column as keyof typeof privateFields] };
}

export async function writeDirectoryColumn(
  tx: Transaction,
  personId: string,
  change: { readonly column: DirectoryColumn; readonly value: unknown },
  write: DirectoryWrite,
): Promise<void> {
  const { table, field } = fieldFor(change.column);
  const stamp = { updatedBy: write.actor.identity, updatedAt: write.at };
  const value = change.value ?? (change.column === 'portfolios' ? sql`'{}'::uuid[]` : null);
  await tx
    .insert(table)
    .values({ personId, ...stamp, [field]: value })
    .onConflictDoUpdate({ target: table.personId, set: { ...stamp, [field]: value } });
}
