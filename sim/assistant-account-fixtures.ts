import {
  assistantProvisionerIdentity,
  principalSchema,
  type HarnessEvent,
  type Principal,
} from '@uw/contracts';
import { seedPage } from '@uw/db/test-seed';
import { readAllEvents } from '@uw/harness';
import { simCaller, simPerson } from './fixtures.ts';
import type { World } from './world.ts';

export function simProvisioner(): Principal {
  return principalSchema.parse({
    identity: assistantProvisionerIdentity,
    kind: 'agent',
    personId: null,
    email: null,
    grants: [],
    interactive: false,
  });
}

export function staffPerson(world: World, n: number): Promise<Principal> {
  return simPerson(world, n, [{ role: 'viewer', scopeKind: 'jd_area', scopeArea: '30-39' }]);
}

export function enable(world: World, person: Principal, name: string) {
  return world.kernel.assistants.enable(simCaller(world, person), {
    harnessId: world.adapters.ids.next(),
    name,
  });
}

export function disable(world: World, person: Principal) {
  return world.kernel.assistants.disable(simCaller(world, person), {});
}

export function retire(world: World, harnessId: string, actor: Principal = simProvisioner()) {
  return world.kernel.assistants.retire(simCaller(world, actor), { harnessId });
}

export function passDays(world: World, days: number): void {
  world.adapters.clock.advance(days * 24 * 3_600_000);
}

export async function seedNumberedPage(world: World, id: string, title: string): Promise<void> {
  await seedPage(world.database.db, {
    id,
    type: 'knowledge',
    status: 'active',
    jdArea: '10-19',
    slug: id.slice(-8),
    title,
    bodyMd: 'A numbered page.',
    frontmatter: { jd_category: '10', jd_id: title.slice(0, 5) },
  });
}

export function accountEvents(world: World, harnessId: string): Promise<readonly HarnessEvent[]> {
  return world.adapters.store
    .transaction((tx) => readAllEvents(tx, harnessId, null))
    .then((events) => events.filter((event) => event.name.startsWith('assistant_')));
}
