import { eq } from 'drizzle-orm';
import type {
  AddCommitmentCommand,
  RemoveCommitmentCommand,
  RemoveStaffAllocationCommand,
  SetStaffAllocationCommand,
} from '@uw/contracts';
import { can } from '@uw/core/acl';
import type { Principal } from '@uw/core/principal';
import type { Executor } from '@uw/db/client';
import { pages, people, personCommitments, staffAllocations } from '@uw/db/schema';
import type { CommandResult } from '../http/commands.ts';
import { DIRECTORY_STEWARD } from './directory-entries.ts';

export type TeamWrite = { readonly actor: Principal; readonly at: Date };

const done: CommandResult = { ok: true };

export function stewardsTeam(actor: Principal, at: Date): boolean {
  return can(actor, 'admin', { kind: 'area', area: DIRECTORY_STEWARD }, at);
}

function mayWriteCommitments(actor: Principal, fromPersonId: string, at: Date): boolean {
  if (stewardsTeam(actor, at)) return true;
  return actor.kind === 'person' && actor.personId === fromPersonId;
}

async function isActivePerson(db: Executor, personId: string): Promise<boolean> {
  const [row] = await db
    .select({ status: people.status })
    .from(people)
    .where(eq(people.id, personId))
    .limit(1);
  return row?.status === 'active';
}

function stamp(write: TeamWrite) {
  return { updatedBy: write.actor.identity, updatedAt: write.at };
}

export async function addCommitment(
  db: Executor,
  command: AddCommitmentCommand,
  write: TeamWrite,
): Promise<CommandResult> {
  const { fromPersonId, toPersonId, toText } = command;
  if (!mayWriteCommitments(write.actor, fromPersonId, write.at)) {
    return { ok: false, reason: 'not_permitted' };
  }
  if (toPersonId === fromPersonId) return { ok: false, reason: 'invalid_value' };
  const named = toPersonId === null ? [fromPersonId] : [fromPersonId, toPersonId];
  for (const personId of named) {
    if (!(await isActivePerson(db, personId))) return { ok: false, reason: 'person_not_found' };
  }
  await db
    .insert(personCommitments)
    .values({ fromPersonId, toPersonId, toText: toText?.trim() ?? null, ...stamp(write) })
    .onConflictDoNothing();
  return done;
}

export async function removeCommitment(
  db: Executor,
  command: RemoveCommitmentCommand,
  write: TeamWrite,
): Promise<CommandResult> {
  const [row] = await db
    .select({ fromPersonId: personCommitments.fromPersonId })
    .from(personCommitments)
    .where(eq(personCommitments.id, command.commitmentId))
    .limit(1);
  if (row === undefined) return { ok: false, reason: 'row_not_found' };
  if (!mayWriteCommitments(write.actor, row.fromPersonId, write.at)) {
    return { ok: false, reason: 'not_permitted' };
  }
  await db.delete(personCommitments).where(eq(personCommitments.id, command.commitmentId));
  return done;
}

async function targetProblem(
  db: Executor,
  target: SetStaffAllocationCommand['target'],
): Promise<CommandResult | null> {
  const [page] = await db
    .select({ type: pages.type, status: pages.status })
    .from(pages)
    .where(eq(pages.id, target.pageId))
    .limit(1);
  if (page === undefined || page.status === 'retired')
    return { ok: false, reason: 'page_not_found' };
  return page.type === target.kind ? null : { ok: false, reason: 'invalid_value' };
}

export async function setStaffAllocation(
  db: Executor,
  command: SetStaffAllocationCommand,
  write: TeamWrite,
): Promise<CommandResult> {
  if (!stewardsTeam(write.actor, write.at)) return { ok: false, reason: 'not_permitted' };
  if (!(await isActivePerson(db, command.personId))) {
    return { ok: false, reason: 'person_not_found' };
  }
  const problem = await targetProblem(db, command.target);
  if (problem !== null) return problem;
  const program = command.target.kind === 'program';
  const column = program ? staffAllocations.programPageId : staffAllocations.portfolioPageId;
  const values = {
    personId: command.personId,
    programPageId: program ? command.target.pageId : null,
    portfolioPageId: program ? null : command.target.pageId,
    percent: command.percent,
    ...stamp(write),
  };
  await db
    .insert(staffAllocations)
    .values(values)
    .onConflictDoUpdate({
      target: [staffAllocations.personId, column],
      set: { percent: command.percent, ...stamp(write) },
    });
  return done;
}

export async function removeStaffAllocation(
  db: Executor,
  command: RemoveStaffAllocationCommand,
  write: TeamWrite,
): Promise<CommandResult> {
  if (!stewardsTeam(write.actor, write.at)) return { ok: false, reason: 'not_permitted' };
  const removed = await db
    .delete(staffAllocations)
    .where(eq(staffAllocations.id, command.allocationId))
    .returning({ id: staffAllocations.id });
  return removed.length === 0 ? { ok: false, reason: 'row_not_found' } : done;
}
