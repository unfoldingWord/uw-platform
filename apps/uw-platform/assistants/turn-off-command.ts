import type { DisablePersonAssistantCommand } from '@uw/contracts';
import { can } from '@uw/core/acl';
import type { Principal } from '@uw/core/principal';
import type { Database } from '@uw/db/client';
import type { CommandResult } from '../http/commands.ts';
import { platformKernel } from '../kernel.ts';

export async function disablePersonAssistant(
  db: Database,
  actor: Principal,
  command: DisablePersonAssistantCommand,
  traceId: string,
  at: Date,
): Promise<CommandResult> {
  if (!can(actor, 'admin', { kind: 'org' }, at)) return { ok: false, reason: 'not_permitted' };
  const handle = { db, ping: () => Promise.resolve(), release: () => Promise.resolve() };
  const kernel = platformKernel(handle, { now: () => at });
  const outcome = await kernel.assistants.disableFor(
    { actor, traceId, requestId: command.requestId },
    { personId: command.personId },
  );
  return outcome.status === 'accepted' ? { ok: true } : { ok: false, reason: outcome.reason };
}
