import type {
  ApprovePersonCommand,
  DeactivatePersonCommand,
  DeclinePersonCommand,
  ErrorReason,
  PersonStatus,
} from '@uw/contracts';
import { can } from '@uw/core/acl';
import type { Principal } from '@uw/core/principal';
import { advisoryLock, advisoryLocks } from '@uw/db/advisory-locks';
import type { Database, Transaction } from '@uw/db/client';
import { resolveGrants } from '@uw/db/store';
import { giveDefaultReading } from '../acl/default-grant.ts';
import type { CommandResult } from '../http/commands.ts';
import { changeStatus, lockPerson, type StatusChange } from './directory.ts';

const accepted: CommandResult = { ok: true };

function refused(reason: ErrorReason): CommandResult {
  return { ok: false, reason };
}

const decidable: Readonly<Record<StatusChange['action'], readonly PersonStatus[]>> = {
  approve: ['pending', 'disabled'],
  decline: ['pending'],
  deactivate: ['active'],
};

function fits(change: StatusChange, personId: string, status: PersonStatus): boolean {
  if (change.action === 'deactivate' && change.actor.personId === personId) return false;
  return decidable[change.action].includes(status);
}

async function orgAdminNow(tx: Transaction, actor: Principal, at: Date): Promise<boolean> {
  if (actor.personId === null) return false;
  const grants = await resolveGrants(tx, actor.personId, { at, lock: 'share' });
  return can({ ...actor, grants }, 'admin', { kind: 'org' }, at);
}

async function decideInTransaction(
  tx: Transaction,
  personId: string,
  change: StatusChange,
): Promise<CommandResult> {
  await tx.execute(advisoryLock(advisoryLocks.grantCommands));
  if (!(await orgAdminNow(tx, change.actor, change.at))) return refused('not_permitted');
  const person = await lockPerson(tx, personId);
  if (!person) return refused('person_not_found');
  if (!fits(change, personId, person.status)) {
    return refused('transition_not_allowed');
  }
  await changeStatus(tx, person, change);
  if (change.action === 'approve') {
    await giveDefaultReading(tx, personId, { actor: change.actor, traceId: change.traceId });
  }
  return accepted;
}

function decide(db: Database, personId: string, change: StatusChange): Promise<CommandResult> {
  if (!can(change.actor, 'admin', { kind: 'org' }, change.at)) {
    return Promise.resolve(refused('not_permitted'));
  }
  return db.transaction((tx) => decideInTransaction(tx, personId, change));
}

export function approvePerson(
  db: Database,
  actor: Principal,
  command: ApprovePersonCommand,
  traceId: string,
  at: Date,
): Promise<CommandResult> {
  return decide(db, command.personId, { actor, action: 'approve', traceId, at });
}

export function declinePerson(
  db: Database,
  actor: Principal,
  command: DeclinePersonCommand,
  traceId: string,
  at: Date,
): Promise<CommandResult> {
  return decide(db, command.personId, { actor, action: 'decline', traceId, at });
}

export function deactivatePerson(
  db: Database,
  actor: Principal,
  command: DeactivatePersonCommand,
  traceId: string,
  at: Date,
): Promise<CommandResult> {
  return decide(db, command.personId, { actor, action: 'deactivate', traceId, at });
}
