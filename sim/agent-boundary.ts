import {
  delegatedIdentity,
  gateDecisionSchema,
  identitySchema,
  principalSchema,
  type GateDecision,
  type HarnessEvent,
  type ItemState,
  type Principal,
  type Role,
} from '@uw/contracts';
import { readAllEvents, type Kernel, type KernelOutcome } from '@uw/harness';
import { simAgent, simCaller, simPerson, type SimGrant } from './fixtures.ts';
import type { World } from './world.ts';

export type Decide = Kernel['gates']['decide'];
export type UpdateStage = Kernel['stages']['updateStage'];
export type AgentAttempt = { readonly label: string; readonly actor: Principal };
export type Violation = {
  readonly label: string;
  readonly decision: GateDecision;
  readonly why: string;
};

type Target = { readonly itemId: string; readonly harnessId: string };
type GrantSet = { readonly label: string; readonly grants: readonly SimGrant[] };
type Form = { readonly label: string; build(person: Principal): Principal };
type Call = {
  readonly attempt: AgentAttempt;
  readonly decision: GateDecision;
  readonly readable: boolean;
};
type Place = Pick<ItemState, 'stageKey' | 'holder' | 'gateStatus'>;
type Snapshot = { readonly events: readonly HarnessEvent[]; readonly place: Place | null };

const FIRST_PERSON = 20;
const EXPIRES_AFTER_MS = 60_000;
const DELEGATED_OWNER = 'admin org';

const roles: readonly Role[] = ['admin', 'editor', 'viewer'];

const scopes = [
  { label: 'org', scopeKind: 'org', scopeArea: null },
  { label: '80-89', scopeKind: 'jd_area', scopeArea: '80-89' },
  { label: '30-39', scopeKind: 'jd_area', scopeArea: '30-39' },
] as const;

const expiring = [
  { role: 'admin', scope: scopes[0] },
  { role: 'admin', scope: scopes[1] },
  { role: 'viewer', scope: scopes[1] },
] as const;

const forms: readonly Form[] = [
  {
    label: 'bare persona agent:reviewer',
    build: (person) => simAgent(person, 'reviewer', { interactive: true }),
  },
  {
    label: 'device laptop',
    build: (person) => simAgent(person, `${person.personId}/laptop`, { interactive: true }),
  },
  {
    label: 'service-token device hourly-routine',
    build: (person) =>
      simAgent(person, `${person.personId}/hourly-routine`, { interactive: false }),
  },
  {
    label: 'person kind carrying agent:builder',
    build: (person) => ({
      ...person,
      kind: 'person',
      identity: identitySchema.parse('agent:builder'),
    }),
  },
];

function grantSets(expiresAt: Date): readonly GrantSet[] {
  const live = roles.flatMap((role) =>
    scopes.map((scope) => ({
      label: `${role} ${scope.label}`,
      grants: [{ role, scopeKind: scope.scopeKind, scopeArea: scope.scopeArea }],
    })),
  );
  const expired = expiring.map(({ role, scope }) => ({
    label: `${role} ${scope.label} expired`,
    grants: [{ role, scopeKind: scope.scopeKind, scopeArea: scope.scopeArea, expiresAt }],
  }));
  return [{ label: 'no grant', grants: [] }, ...live, ...expired];
}

function valueOf<T>(outcome: KernelOutcome<T>, what: string): T {
  if (outcome.status !== 'accepted') throw new Error(`${what} was refused: ${outcome.reason}`);
  return outcome.value;
}

async function delegatedAttempts(
  world: World,
  harnessId: string,
  owner: Principal,
): Promise<readonly AgentAttempt[]> {
  const delegation = valueOf(
    await world.kernel.delegations.grant(simCaller(world, owner), {
      harnessId,
      persona: 'agent:iterate',
      capability: 'iterate',
      expiresAt: null,
      supersedes: null,
    }),
    'delegating',
  );
  const device = `agent:${owner.personId}/laptop`;
  const delegated = principalSchema.parse({
    ...simAgent(owner, `${owner.personId}/laptop`, { interactive: true }),
    identity: delegatedIdentity(device, 'iterate', delegation.id),
  });
  const runner = simCaller(world, simAgent(owner, 'iterate', { interactive: false }));
  const beat = valueOf(
    await world.kernel.delegations.beat(runner, { delegationId: delegation.id }),
    'the beat',
  );
  return [
    { label: `${DELEGATED_OWNER}, delegated device laptop as iterate`, actor: delegated },
    { label: `${DELEGATED_OWNER}, hosted beat principal`, actor: beat.principal },
  ];
}

export async function agentAttempts(
  world: World,
  harnessId: string,
): Promise<readonly AgentAttempt[]> {
  const expiresAt = new Date(world.adapters.clock.now().getTime() + EXPIRES_AFTER_MS);
  const attempts: AgentAttempt[] = [];
  for (const [index, set] of grantSets(expiresAt).entries()) {
    const person = await simPerson(world, FIRST_PERSON + index, set.grants);
    attempts.push(
      ...forms.map((form) => ({ label: `${set.label}, ${form.label}`, actor: form.build(person) })),
    );
    if (set.label === DELEGATED_OWNER) {
      attempts.push(...(await delegatedAttempts(world, harnessId, person)));
    }
  }
  world.adapters.clock.advance(2 * EXPIRES_AFTER_MS);
  return attempts;
}

async function readsHarness(world: World, actor: Principal, harnessId: string): Promise<boolean> {
  if (actor.personId === null) return false;
  const reader = principalSchema.parse({
    identity: `human:${actor.personId}`,
    kind: 'person',
    personId: actor.personId,
    email: 'boundary-reader@unfoldingword.org',
    grants: actor.grants,
    interactive: true,
  });
  const scene = await world.kernel.reads.harness(simCaller(world, reader), { harnessId });
  return scene.status === 'accepted';
}

function snapshot(world: World, target: Target): Promise<Snapshot> {
  return world.adapters.store.transaction(async (tx) => {
    const item = await tx.harnessItems.read.byId(target.itemId);
    const events = await readAllEvents(tx, target.harnessId, target.itemId);
    if (item === null) return { events, place: null };
    const { stageKey, holder, gateStatus } = item;
    return { events, place: { stageKey, holder, gateStatus } };
  });
}

function replyWhy(outcome: KernelOutcome<unknown>, call: Call, itemId: string): string | null {
  if (outcome.status === 'accepted') return 'the decision was accepted';
  const expected = call.readable ? 'gate_refused_to_agent' : 'item_not_found';
  if (outcome.reason !== expected) return `replied ${outcome.reason}, not ${expected}`;
  if (
    expected === 'item_not_found' &&
    JSON.stringify(outcome.detail) !== JSON.stringify({ itemId })
  ) {
    return 'the item_not_found detail differs from the one a missing id gets';
  }
  return null;
}

function logWhy(gained: readonly HarnessEvent[], call: Call): string | null {
  const [only, ...rest] = gained;
  const refusal =
    only?.name === 'gate_refused_to_agent' &&
    only.actor === call.attempt.actor.identity &&
    only.evidence['decision'] === call.decision &&
    rest.length === 0;
  if (refusal) return null;
  const names = gained.map((event) => `${event.name} by ${event.actor}`);
  return `the log gained [${names.join(', ')}], not one gate_refused_to_agent by the agent`;
}

function placeWhy(before: Place | null, after: Place | null): string | null {
  if (JSON.stringify(before) === JSON.stringify(after)) return null;
  return `the item moved from ${JSON.stringify(before)} to ${JSON.stringify(after)}`;
}

async function callViolations(
  world: World,
  target: Target,
  call: Call,
  decide: Decide,
): Promise<readonly Violation[]> {
  const before = await snapshot(world, target);
  const outcome = await decide(simCaller(world, call.attempt.actor), {
    itemId: target.itemId,
    decision: call.decision,
    reason: call.decision === 'override' ? 'planted' : null,
    findings: [],
  });
  const after = await snapshot(world, target);
  const whys = [
    replyWhy(outcome, call, target.itemId),
    logWhy(after.events.slice(before.events.length), call),
    placeWhy(before.place, after.place),
  ];
  return whys
    .filter((why) => why !== null)
    .map((why) => ({ label: call.attempt.label, decision: call.decision, why }));
}

async function decisionRows(world: World, itemId: string): Promise<readonly Violation[]> {
  const rows = await world.adapters.store.transaction((tx) =>
    tx.gateDecisions.read.forItem(itemId),
  );
  return rows.map((row) => ({
    label: 'gate_decisions',
    decision: row.decision,
    why: `a ${row.decision} decision row by ${row.actor}`,
  }));
}

export async function gateViolations(
  world: World,
  target: Target,
  attempts: readonly AgentAttempt[],
  decide: Decide,
): Promise<readonly Violation[]> {
  const violations: Violation[] = [];
  for (const attempt of attempts) {
    const readable = await readsHarness(world, attempt.actor, target.harnessId);
    for (const decision of gateDecisionSchema.options) {
      const call = { attempt, decision, readable };
      violations.push(...(await callViolations(world, target, call, decide)));
    }
  }
  return [...violations, ...(await decisionRows(world, target.itemId))];
}

function stageRows(world: World, harnessId: string): Promise<string> {
  return world.adapters.store.transaction(async (tx) =>
    JSON.stringify(await tx.harnessStages.read.forHarness(harnessId)),
  );
}

async function gatedStages(world: World, harnessId: string): Promise<readonly string[]> {
  const stages = await world.adapters.store.transaction((tx) =>
    tx.harnessStages.read.forHarness(harnessId),
  );
  return stages.filter((stage) => stage.exitGate !== 'none').map((stage) => stage.key);
}

export async function stageViolations(
  world: World,
  harnessId: string,
  attempts: readonly AgentAttempt[],
  updateStage: UpdateStage,
): Promise<readonly string[]> {
  const before = await stageRows(world, harnessId);
  const violations: string[] = [];
  for (const stageKey of await gatedStages(world, harnessId)) {
    for (const attempt of attempts) {
      const outcome = await updateStage(simCaller(world, attempt.actor), {
        harnessId,
        stageKey,
        change: { exitGate: 'none' },
      });
      const reason = outcome.status === 'accepted' ? 'accepted' : outcome.reason;
      if (reason !== 'not_permitted') violations.push(`${attempt.label}, ${stageKey}: ${reason}`);
    }
  }
  if ((await stageRows(world, harnessId)) !== before) violations.push('harness_stages changed');
  return violations;
}
