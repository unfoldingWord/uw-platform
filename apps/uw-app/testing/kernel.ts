import { newEventSchema, principalSchema, type Principal } from '@uw/contracts';
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
import { platformPorts } from '../kernel.ts';
import { platformGrants } from '../ports/grants.ts';
import { platformStore } from '../ports/store.ts';

declare function setTimeout(handler: () => void, milliseconds: number): unknown;

export function kernelOn(db: Database, clock: Clock, overrides: Partial<Ports> = {}): Kernel {
  const handle = { db, ping: async () => undefined, release: async () => undefined };
  return createKernel({ ...platformPorts(handle), clock, ...overrides });
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

export async function seedSpendReading(db: Database, harnessId: string, at: Date): Promise<void> {
  const reading = newEventSchema.parse({
    eventId: crypto.randomUUID(),
    harnessId,
    itemId: null,
    name: 'breaker_open',
    at: at.toISOString(),
    actor: 'agent:system',
    evidence: { spentMinor: 0, capMinor: 125_000, currency: 'USD', percent: 0 },
    traceId: crypto.randomUUID(),
    requestId: null,
  });
  await platformStore(db).transaction((tx) => tx.harnessEvents.write.append([reading]));
}
