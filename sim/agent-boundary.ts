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
export type AgentAttempt = {
  readonly label: string;
  readonly actor: Principal;
  readonly readable: boolean;
};
export type Violation = {
  readonly label: string;
  readonly decision: GateDecision;
  readonly why: string;
};

type Target = { readonly itemId: string; readonly harnessId: string };
type GrantSet = { readonly label: string; readonly grants: readonly SimGrant[] };
type Form = { readonly label: string; build(person: Principal): Principal };
type Ask = { readonly decision: GateDecision; readonly reason: string | null };
type Call = Ask & { readonly attempt: AgentAttempt };
type Place = Pick<ItemState, 'stageKey' | 'holder' | 'gateStatus'>;
type Snapshot = {
  readonly events: readonly HarnessEvent[];
  readonly harnessEvents: readonly HarnessEvent[];
  readonly place: Place | null;
};

const FIRST_PERSON = 20;
const EXPIRES_AFTER_MS = 60_000;
const DELEGATING_OWNERS: ReadonlySet<string> = new Set(['admin org', 'admin 80-89']);
const REVOKING_OWNER = 'admin org';

const readableSets: ReadonlySet<string> = new Set([
  'admin org',
  'admin 80-89',
  'admin 30-39',
  'editor org',
  'editor 80-89',
  'editor 30-39',
  'viewer org',
  'viewer 80-89',
]);

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

const asks: readonly Ask[] = [
  ...gateDecisionSchema.options.map((decision) => ({
    decision,
    reason: decision === 'override' ? 'planted' : null,
  })),
  { decision: 'override', reason: '' },
];

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

async function delegationOf(
  world: World,
  harnessId: string,
  owner: Principal,
  persona: string,
): Promise<string> {
  const granted = await world.kernel.delegations.grant(simCaller(world, owner), {
    harnessId,
    persona: `agent:${persona}`,
    capability: 'iterate',
    expiresAt: null,
    supersedes: null,
  });
  return valueOf(granted, 'delegating').id;
}

function delegatedDevice(
  owner: Principal,
  device: string,
  persona: string,
  delegationId: string,
): Principal {
  return principalSchema.parse({
    ...simAgent(owner, `${owner.personId}/${device}`, { interactive: device === 'laptop' }),
    identity: delegatedIdentity(`agent:${owner.personId}/${device}`, persona, delegationId),
  });
}

async function delegatedAttempts(
  world: World,
  harnessId: string,
  owner: Principal,
  label: string,
): Promise<readonly AgentAttempt[]> {
  const delegationId = await delegationOf(world, harnessId, owner, 'iterate');
  const runner = simCaller(world, simAgent(owner, 'iterate', { interactive: false }));
  const beat = valueOf(await world.kernel.delegations.beat(runner, { delegationId }), 'the beat');
  return [
    {
      label: `${label}, delegated device laptop as iterate`,
      actor: delegatedDevice(owner, 'laptop', 'iterate', delegationId),
      readable: true,
    },
    {
      label: `${label}, delegated service-token device hourly-routine as iterate`,
      actor: delegatedDevice(owner, 'hourly-routine', 'iterate', delegationId),
      readable: true,
    },
    { label: `${label}, hosted beat principal`, actor: beat.principal, readable: true },
  ];
}

async function revokedAttempt(
  world: World,
  harnessId: string,
  owner: Principal,
  label: string,
): Promise<AgentAttempt> {
  const delegationId = await delegationOf(world, harnessId, owner, 'reviewer');
  valueOf(
    await world.kernel.delegations.revoke(simCaller(world, owner), { delegationId }),
    'revoking',
  );
  return {
    label: `${label}, device laptop as reviewer via a revoked delegation`,
    actor: delegatedDevice(owner, 'laptop', 'reviewer', delegationId),
    readable: true,
  };
}

async function setAttempts(
  world: World,
  harnessId: string,
  set: GrantSet,
  person: Principal,
): Promise<readonly AgentAttempt[]> {
  const readable = readableSets.has(set.label);
  const attempts = forms.map((form) => ({
    label: `${set.label}, ${form.label}`,
    actor: form.build(person),
    readable,
  }));
  const delegated = DELEGATING_OWNERS.has(set.label)
    ? await delegatedAttempts(world, harnessId, person, set.label)
    : [];
  const revoked =
    set.label === REVOKING_OWNER ? [await revokedAttempt(world, harnessId, person, set.label)] : [];
  return [...attempts, ...delegated, ...revoked];
}

export async function agentAttempts(
  world: World,
  harnessId: string,
): Promise<readonly AgentAttempt[]> {
  const expiresAt = new Date(world.adapters.clock.now().getTime() + EXPIRES_AFTER_MS);
  const attempts: AgentAttempt[] = [];
  for (const [index, set] of grantSets(expiresAt).entries()) {
    const person = await simPerson(world, FIRST_PERSON + index, set.grants);
    attempts.push(...(await setAttempts(world, harnessId, set, person)));
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
    const all = await readAllEvents(tx, target.harnessId, null);
    const harnessEvents = all.filter((event) => event.itemId === null);
    if (item === null) return { events, harnessEvents, place: null };
    const { stageKey, holder, gateStatus } = item;
    return { events, harnessEvents, place: { stageKey, holder, gateStatus } };
  });
}

function replyWhy(outcome: KernelOutcome<unknown>, call: Call, itemId: string): string | null {
  if (outcome.status === 'accepted') return 'the decision was accepted';
  const expected = call.attempt.readable ? 'gate_refused_to_agent' : 'item_not_found';
  if (outcome.reason !== expected) return `replied ${outcome.reason}, not ${expected}`;
  const hidden = JSON.stringify(outcome.detail) !== JSON.stringify({ itemId });
  if (expected === 'item_not_found' && hidden) {
    return 'the item_not_found detail differs from the one a missing id gets';
  }
  return null;
}

function logWhy(gained: readonly HarnessEvent[], call: Call, before: Snapshot): string | null {
  const [only, ...rest] = gained;
  const refusal =
    only?.name === 'gate_refused_to_agent' &&
    only.actor === call.attempt.actor.identity &&
    only.evidence['decision'] === call.decision &&
    only.evidence['stage'] === before.place?.stageKey &&
    rest.length === 0;
  if (refusal) return null;
  const names = gained.map((event) => `${event.name} by ${event.actor}`);
  return `the log gained [${names.join(', ')}], not one gate_refused_to_agent by the agent`;
}

function harnessLogWhy(before: Snapshot, after: Snapshot): string | null {
  const gained = after.harnessEvents.slice(before.harnessEvents.length);
  if (gained.length === 0) return null;
  return `the harness log gained [${gained.map((event) => event.name).join(', ')}]`;
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
    reason: call.reason,
    findings: [],
  });
  const after = await snapshot(world, target);
  const whys = [
    replyWhy(outcome, call, target.itemId),
    logWhy(after.events.slice(before.events.length), call, before),
    harnessLogWhy(before, after),
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

async function oracleViolations(
  world: World,
  target: Target,
  attempt: AgentAttempt,
): Promise<readonly Violation[]> {
  const read = await readsHarness(world, attempt.actor, target.harnessId);
  if (read === attempt.readable) return [];
  const why = `the pinned readability ${String(attempt.readable)} disagrees with the read ${String(read)}`;
  return [{ label: attempt.label, decision: 'approve', why }];
}

export async function gateViolations(
  world: World,
  target: Target,
  attempts: readonly AgentAttempt[],
  decide: Decide,
): Promise<readonly Violation[]> {
  const violations: Violation[] = [];
  for (const attempt of attempts) {
    violations.push(...(await oracleViolations(world, target, attempt)));
    for (const ask of asks) {
      violations.push(...(await callViolations(world, target, { ...ask, attempt }, decide)));
    }
  }
  return [...violations, ...(await decisionRows(world, target.itemId))];
}
