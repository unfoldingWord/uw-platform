import { eq } from 'drizzle-orm';
import type { ErrorReason, SaveProfileBodyCommand } from '@uw/contracts';
import { can } from '@uw/core/acl';
import type { Principal } from '@uw/core/principal';
import type { Database, Transaction } from '@uw/db/client';
import { directoryEntries } from '@uw/db/schema';
import { ensureBuiltIns } from '../collections/builtins/seed.ts';
import type { CommandResult } from '../http/commands.ts';
import { createProfilePage, writeProfileBody } from '../pages/profile-pages.ts';
import { replayOf } from '../pages/replay.ts';
import { DIRECTORY_STEWARD } from './directory-entries.ts';
import { personPage } from './directory.ts';

const accepted: CommandResult = { ok: true };

function refused(reason: ErrorReason): CommandResult {
  return { ok: false, reason };
}

export function mayWriteProfileBody(actor: Principal, personId: string, at: Date): boolean {
  const profile = { kind: 'person', personId, status: 'active' } as const;
  if (!can(actor, 'read', profile, at)) return false;
  if (actor.personId === personId) return true;
  return can(actor, 'admin', { kind: 'area', area: DIRECTORY_STEWARD }, at);
}

export async function personOfProfilePage(db: Database, pageId: string): Promise<string | null> {
  const [row] = await db
    .select({ personId: directoryEntries.personId })
    .from(directoryEntries)
    .where(eq(directoryEntries.pageId, pageId));
  return row?.personId ?? null;
}

export async function profilePageId(db: Database, personId: string): Promise<string | null> {
  const [row] = await db
    .select({ pageId: directoryEntries.pageId })
    .from(directoryEntries)
    .where(eq(directoryEntries.personId, personId));
  return row?.pageId ?? null;
}

type Save = {
  readonly actor: Principal;
  readonly command: SaveProfileBodyCommand;
  readonly title: string;
  readonly traceId: string;
  readonly at: Date;
};

async function lockedEntry(tx: Transaction, save: Save): Promise<string | null> {
  const { personId } = save.command;
  const stamp = { updatedBy: save.actor.identity, updatedAt: save.at };
  await tx
    .insert(directoryEntries)
    .values({ personId, ...stamp })
    .onConflictDoNothing();
  const [row] = await tx
    .select({ pageId: directoryEntries.pageId })
    .from(directoryEntries)
    .where(eq(directoryEntries.personId, personId))
    .for('update');
  return row?.pageId ?? null;
}

async function firstWrite(tx: Transaction, save: Save): Promise<CommandResult> {
  const { command, actor, at } = save;
  const source = { actor, at, traceId: save.traceId, requestId: command.requestId };
  const pageId = crypto.randomUUID();
  await createProfilePage(
    tx,
    {
      pageId,
      personId: command.personId,
      title: save.title,
      bodyMd: command.bodyMd,
    },
    source,
  );
  await tx
    .update(directoryEntries)
    .set({ pageId, updatedBy: actor.identity, updatedAt: at })
    .where(eq(directoryEntries.personId, command.personId));
  return accepted;
}

async function saveInTransaction(tx: Transaction, save: Save): Promise<CommandResult> {
  const { command } = save;
  const pageId = await lockedEntry(tx, save);
  if (pageId === null) {
    return command.expectedVersion === null ? firstWrite(tx, save) : refused('stale_version');
  }
  if (command.expectedVersion === null) return refused('stale_version');
  const source = {
    actor: save.actor,
    at: save.at,
    traceId: save.traceId,
    requestId: command.requestId,
  };
  const change = {
    pageId,
    expectedVersion: command.expectedVersion,
    title: save.title,
    bodyMd: command.bodyMd,
  };
  const written = await writeProfileBody(tx, change, source);
  return written.ok ? accepted : refused(written.reason);
}

export async function saveProfileBody(
  db: Database,
  actor: Principal,
  command: SaveProfileBodyCommand,
  traceId: string,
  at: Date,
): Promise<CommandResult> {
  if (!mayWriteProfileBody(actor, command.personId, at)) return refused('not_permitted');
  if ((await replayOf(db, actor, command.requestId)) !== null) return accepted;
  const person = await personPage(db, command.personId);
  if (person?.status !== 'active') return refused('person_not_found');
  await ensureBuiltIns(db, at);
  const save = { actor, command, title: person.displayName, traceId, at };
  return db.transaction((tx) => saveInTransaction(tx, save));
}
