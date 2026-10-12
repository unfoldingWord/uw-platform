import type { Principal } from '@uw/contracts';
import { revokeSeededGrant } from '@uw/db/test-seed';
import { software, type Delegation, type KernelOutcome, type Wake } from '@uw/harness';
import { createSimHarness, simAgent, simCaller, simDelegate, simPerson } from './fixtures.ts';
import { value } from './runs.ts';
import { simParkedAtShip, standardChange, type ShipChange } from './ship-fixtures.ts';
import type { World } from './world.ts';

const area = { scopeKind: 'jd_area', scopeArea: '80-89' } as const;

export type GateScene = {
  readonly world: World;
  readonly harnessId: string;
  readonly ian: Principal;
  readonly areaAdmin: Principal;
  readonly editor: Principal;
  readonly viewer: Principal;
};

export async function gateScene(world: World): Promise<GateScene> {
  const { harness, admin: ian } = await createSimHarness(world, software);
  const editor = await simPerson(world, 2, [{ role: 'editor', ...area }]);
  const areaAdmin = await simPerson(world, 5, [{ role: 'admin', ...area }]);
  const viewer = await simPerson(world, 8, [{ role: 'viewer', ...area }]);
  return { world, harnessId: harness.id, ian, areaAdmin, editor, viewer };
}

export async function parkAtShip(
  scene: GateScene,
  title: string,
  riskDomains: readonly ('acl' | 'ledger')[] = [],
): Promise<string> {
  const riskTier = riskDomains.length > 0 ? 'high' : 'standard';
  const change: ShipChange = {
    ...standardChange,
    paths: riskDomains.includes('acl') ? ['packages/core/acl.ts'] : standardChange.paths,
    declaration: { riskTier, riskDomains: [...riskDomains] },
  };
  const parked = await simParkedAtShip(scene.world, {
    harnessId: scene.harnessId,
    editor: scene.editor,
    title,
    change,
  });
  return parked.itemId;
}

export function wakesFor(world: World, itemId: string | null): readonly Wake[] {
  return world.adapters.notifier.delivered().filter((wake) => wake.itemId === itemId);
}

export function recipientIds(wake: Wake | undefined): readonly string[] {
  return wake?.recipients.map((recipient) => recipient.personId) ?? [];
}

export function personOf(principal: Principal): string {
  if (principal.personId === null) throw new Error('the principal names no person');
  return principal.personId;
}

export async function grantPersona(
  world: World,
  harnessId: string,
  person: Principal,
  persona: string,
): Promise<Delegation> {
  const granted = await simDelegate(world, person, {
    harnessId,
    persona,
    capability: 'build',
    expiresAt: null,
    supersedes: null,
  });
  return value(granted);
}

export function beatAs(
  world: World,
  person: Principal,
  delegation: Delegation,
): Promise<KernelOutcome<unknown>> {
  const slug = delegation.persona.slice('agent:'.length);
  const agent = simCaller(world, simAgent(person, slug, { interactive: false }));
  return world.kernel.delegations.beat(agent, { delegationId: delegation.id });
}

export async function loseAdmin(world: World, person: Principal): Promise<void> {
  const grant = person.grants[0];
  if (grant === undefined) throw new Error('the person holds no grant');
  await revokeSeededGrant(world.database.db, grant.grantId, world.adapters.clock.now());
}
