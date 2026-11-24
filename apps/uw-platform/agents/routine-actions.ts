import type { ErrorReason, RoutineChangeCommand } from '@uw/contracts';
import type { Principal } from '@uw/core/principal';
import type { Database } from '@uw/db/client';
import type { Bindings } from '../env.ts';
import { accessTokensConfigOf, deleteAccessServiceToken } from './access-tokens.ts';
import { changeRoutine } from './routines.ts';
import type { RemoveLogin } from './service-tokens.ts';

export type RoutineChangeName = RoutineChangeCommand['command'];

function changeOf(name: RoutineChangeName): 'pause' | 'resume' | 'revoke' {
  if (name === 'pause_routine') return 'pause';
  if (name === 'resume_routine') return 'resume';
  return 'revoke';
}

export type RoutineChangeOutcome =
  | { readonly ok: true; readonly loginRemoved: boolean }
  | { readonly ok: false; readonly reason: ErrorReason };

export type RoutineChangeRequest = {
  readonly db: Database;
  readonly env: Bindings;
  readonly fetch: typeof fetch;
  readonly actor: Principal;
  readonly at: Date;
};

export function loginRemover(env: Bindings, fetcher: typeof fetch): RemoveLogin {
  return async (accessTokenId) => {
    const config = accessTokensConfigOf(env, fetcher);
    if (config === null) return false;
    try {
      return await deleteAccessServiceToken(config, accessTokenId);
    } catch {
      return false;
    }
  };
}

export async function applyRoutineChange(
  request: RoutineChangeRequest,
  routineId: string,
  name: RoutineChangeName,
): Promise<RoutineChangeOutcome> {
  const change = changeOf(name);
  const changed = await changeRoutine(request.db, request.actor, routineId, change, request.at);
  if (!changed.ok) return changed;
  if (change !== 'revoke') return { ok: true, loginRemoved: false };
  const removeLogin = loginRemover(request.env, request.fetch);
  return { ok: true, loginRemoved: await removeLogin(changed.accessTokenId) };
}
