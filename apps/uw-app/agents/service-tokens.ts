import { and, eq, isNull } from 'drizzle-orm';
import type {
  BindServiceTokenCommand,
  ErrorReason,
  RevokeServiceTokenCommand,
} from '@uw/contracts';
import { can } from '@uw/core/acl';
import type { Principal } from '@uw/core/principal';
import { advisoryLock, advisoryLocks } from '@uw/db/advisory-locks';
import type { Database, Executor, Transaction } from '@uw/db/client';
import { pgConstraint, pgErrorCode } from '@uw/db/errors';
import { serviceTokens } from '@uw/db/schema';
import { resolveGrants } from '@uw/db/store';
import type { CommandResult } from '../http/commands.ts';
import { lockPerson } from '../people/directory.ts';

export const owns = ['service_tokens'] as const;

type ServiceTokenBinding = { readonly personId: string; readonly device: string };

const UNIQUE_VIOLATION = '23505';
const BINDING_CONSTRAINTS = new Set([
  'service_tokens_one_live_client',
  'service_tokens_one_live_device',
]);
const BINDABLE_ROLES = new Set(['editor', 'admin']);

const accepted: CommandResult = { ok: true };

function refused(reason: ErrorReason): CommandResult {
  return { ok: false, reason };
}

async function isLiveOrgAdmin(tx: Transaction, actor: Principal, at: Date): Promise<boolean> {
  if (actor.kind !== 'person' || actor.personId === null) return false;
  await tx.execute(advisoryLock(advisoryLocks.grantCommands));
  const grants = await resolveGrants(tx, actor.personId, { at, lock: 'share' });
  return can({ ...actor, grants }, 'admin', { kind: 'org' }, at);
}

async function targetRefusal(
  tx: Transaction,
  personId: string,
  at: Date,
): Promise<ErrorReason | null> {
  const person = await lockPerson(tx, personId);
  if (!person) return 'person_not_found';
  if (person.status === 'pending') return 'pending_approval';
  const grants = await resolveGrants(tx, personId, { at, lock: 'share' });
  return grants.some((grant) => BINDABLE_ROLES.has(grant.role)) ? null : 'not_permitted';
}

async function bindInTransaction(
  tx: Transaction,
  actor: Principal,
  command: BindServiceTokenCommand,
  traceId: string,
  at: Date,
): Promise<CommandResult> {
  if (!(await isLiveOrgAdmin(tx, actor, at))) return refused('not_permitted');
  const refusal = await targetRefusal(tx, command.personId, at);
  if (refusal !== null) return refused(refusal);
  await tx.insert(serviceTokens).values({
    id: crypto.randomUUID(),
    clientId: command.clientId,
    personId: command.personId,
    device: command.device,
    boundBy: actor.identity,
    boundAt: at,
    traceId,
  });
  return accepted;
}

function isBindingConflict(error: unknown): boolean {
  return (
    pgErrorCode(error) === UNIQUE_VIOLATION && BINDING_CONSTRAINTS.has(pgConstraint(error) ?? '')
  );
}

export async function bindServiceToken(
  db: Database,
  actor: Principal,
  command: BindServiceTokenCommand,
  traceId: string,
  at: Date,
): Promise<CommandResult> {
  if (actor.kind !== 'person') return refused('not_permitted');
  try {
    return await db.transaction((tx) => bindInTransaction(tx, actor, command, traceId, at));
  } catch (error) {
    if (isBindingConflict(error)) return refused('grant_exists');
    throw error;
  }
}

async function revokeInTransaction(
  tx: Transaction,
  actor: Principal,
  command: RevokeServiceTokenCommand,
  at: Date,
): Promise<CommandResult> {
  if (!(await isLiveOrgAdmin(tx, actor, at))) return refused('not_permitted');
  const revoked = await tx
    .update(serviceTokens)
    .set({ revokedAt: at })
    .where(and(eq(serviceTokens.clientId, command.clientId), isNull(serviceTokens.revokedAt)))
    .returning({ clientId: serviceTokens.clientId });
  return revoked.length === 0 ? refused('grant_not_found') : accepted;
}

export function revokeServiceToken(
  db: Database,
  actor: Principal,
  command: RevokeServiceTokenCommand,
  at: Date,
): Promise<CommandResult> {
  if (actor.kind !== 'person') return Promise.resolve(refused('not_permitted'));
  return db.transaction((tx) => revokeInTransaction(tx, actor, command, at));
}

export async function liveBinding(
  db: Executor,
  clientId: string,
): Promise<ServiceTokenBinding | null> {
  const [row] = await db
    .select({ personId: serviceTokens.personId, device: serviceTokens.device })
    .from(serviceTokens)
    .where(and(eq(serviceTokens.clientId, clientId), isNull(serviceTokens.revokedAt)));
  return row ?? null;
}

export async function deviceIsBound(
  db: Executor,
  personId: string,
  device: string,
): Promise<boolean> {
  const rows = await db
    .select({ clientId: serviceTokens.clientId })
    .from(serviceTokens)
    .where(
      and(
        eq(serviceTokens.personId, personId),
        eq(serviceTokens.device, device),
        isNull(serviceTokens.revokedAt),
      ),
    );
  return rows.length > 0;
}
