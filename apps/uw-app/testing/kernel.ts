import { principalSchema, type Principal } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { createKernel, type Clock, type Kernel } from '@uw/harness';
import { platformPorts } from '../kernel.ts';
import { platformGrants } from '../ports/grants.ts';

export function kernelOn(db: Database, clock: Clock): Kernel {
  const handle = { db, ping: async () => undefined, release: async () => undefined };
  return createKernel({ ...platformPorts(handle), clock });
}

export async function personOn(
  db: Database,
  personId: string,
  email: string,
  at: Date,
): Promise<Principal> {
  const grants = await platformGrants(db).resolve(personId, at);
  return principalSchema.parse({
    identity: `human:${personId}`,
    kind: 'person',
    personId,
    email,
    grants,
    interactive: true,
  });
}

export function agentOf(owner: Principal, persona: string): Principal {
  return principalSchema.parse({
    identity: `agent:${owner.personId}/${persona}`,
    kind: 'agent',
    personId: owner.personId,
    email: null,
    grants: owner.grants,
    interactive: true,
  });
}
