import { principalSchema, type Principal } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import {
  createKernel,
  notWiredCall,
  type Clock,
  type GitHubFacts,
  type Grants,
  type Kernel,
  type Ports,
  type PullRequestFacts,
} from '@uw/harness';
import { createPersonaActivation, type PersonaCommands } from '@uw/harness/persona-activation';
import { platformPorts } from '../kernel.ts';
import { platformGrants } from '../ports/grants.ts';

declare function setTimeout(handler: () => void, milliseconds: number): unknown;

export function kernelOn(db: Database, clock: Clock, overrides: Partial<Ports> = {}): Kernel {
  const handle = { db, ping: async () => undefined, release: async () => undefined };
  return createKernel({ ...platformPorts(handle), clock, ...overrides });
}

export function personasOn(
  db: Database,
  clock: Clock,
  overrides: Partial<Ports> = {},
): PersonaCommands {
  const handle = { db, ping: async () => undefined, release: async () => undefined };
  return createPersonaActivation({ ...platformPorts(handle), clock, ...overrides });
}

export function fixedFacts(facts: PullRequestFacts): GitHubFacts {
  return {
    pullRequest: async () => facts,
    refresh: async () => facts,
    diff: () => notWiredCall('githubFacts', 'diff'),
  };
}

export function pausingGrants(grants: Grants, onLocked: () => void, pauseMs: number): Grants {
  return {
    resolve: (personId, at) => grants.resolve(personId, at),
    resolveIn: (tx, personId, at) => grants.resolveIn(tx, personId, at),
    lockAndReread: async (tx, personId, at) => {
      const locked = await grants.lockAndReread(tx, personId, at);
      onLocked();
      await new Promise<void>((resolve) => setTimeout(resolve, pauseMs));
      return locked;
    },
    holders: (area, at) => grants.holders(area, at),
  };
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
