import { afterAll, describe, expect, it } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import {
  delegatedIdentity,
  isForbiddenVerbName,
  newEventSchema,
  principalSchema,
  verbRegistry,
  type CostBasis,
  type ErrorReason,
  type Principal,
} from '@uw/contracts';
import { createLogger } from '@uw/core/log';
import { createClient, type Database } from '@uw/db/client';
import { createMigratedDatabase, testServer } from '@uw/db/test-database';
import { seedGrant, seedHostedRun, seedPage, seedPerson } from '@uw/db/test-seed';
import { software, type Caller, type Kernel } from '@uw/harness';
import { createApp } from '../app.tsx';
import { createAccessFixture, type AccessFixture } from '../testing/access-keys.ts';
import {
  callableFailures,
  toolSurfaceMismatches,
  type CallResult,
  type ToolSurface,
} from '../testing/conformance.ts';
import { kernelOn, personOn } from '../testing/kernel.ts';
import { platformStore } from '../ports/store.ts';
import { httpClient } from '../testing/mcp.ts';
import { postgresDeps } from '../testing/postgres.ts';
import type { McpHost, VerbContext } from './context.ts';
import { serveVerbsForTest } from '../testing/in-process.ts';
import { verbHandlers } from './verbs/index.ts';

const IAN_ID = '00000000-0000-4000-8000-000000000001';
const OWNER = {
  id: '00000000-0000-4000-8000-000000001901',
  email: 'conformance-owner@unfoldingword.org',
};
const ADMIN_GRANT = '00000000-0000-4000-8000-000000001902';
const EDITOR_GRANT = '00000000-0000-4000-8000-000000001903';
const MISSING = '00000000-0000-4000-8000-000000001999';
const hostBasis = new Map<McpHost, CostBasis>([
  ['external', 'subscription'],
  ['workflow', 'metered'],
]);

type Body = Record<string, unknown>;
type SettableClock = { now(): Date; advance(milliseconds: number): void };
type Hosts = { readonly external: Client; readonly workflow: Client };
type Rig = {
  readonly db: Database;
  readonly clock: SettableClock;
  readonly fixture: AccessFixture;
  readonly kernel: Kernel;
  readonly ian: Principal;
  readonly owner: Principal;
  readonly drop: () => Promise<void>;
};
type Scene = {
  readonly harnessId: string;
  readonly laptopItem: string;
  readonly workflowItem: string;
  readonly hiddenItem: string;
  readonly hiddenHarness: string;
  readonly undelegatedHarness: string;
  readonly delegationId: string;
  readonly beat: Principal;
  readonly pageId: string;
  readonly workflowRunId: string;
};

let rigged: Promise<Rig> | null = null;
let scenes = 0;

function settableClock(): SettableClock {
  let current = Date.now();
  return { now: () => new Date(current), advance: (ms) => void (current += ms) };
}

function grantRow(id: string, personId: string, role: 'admin' | 'editor') {
  const grantedAt = new Date('2026-01-01T00:00:00.000Z');
  const scope = { scopeKind: 'jd_area' as const, scopeArea: '80-89' };
  return { id, personId, role, ...scope, grantedAt, expiresAt: null };
}

async function seedSpendReading(db: Database, harnessId: string, at: Date): Promise<void> {
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

async function openRig(): Promise<Rig> {
  const database = await createMigratedDatabase(testServer ?? '');
  const db = createClient(database.connectionString);
  const clock = settableClock();
  await seedPerson(db, OWNER);
  await seedGrant(db, grantRow(ADMIN_GRANT, OWNER.id, 'admin'));
  await seedGrant(db, grantRow(EDITOR_GRANT, OWNER.id, 'editor'));
  const ian = await personOn(db, IAN_ID, 'ian.lindsley@unfoldingword.org', clock.now());
  const owner = await personOn(db, OWNER.id, OWNER.email, clock.now());
  const drop = async () => {
    await db.$client.end();
    await database.drop();
  };
  const fixture = await createAccessFixture();
  return { db, clock, fixture, kernel: kernelOn(db, clock), ian, owner, drop };
}

function rig(): Promise<Rig> {
  rigged ??= openRig();
  return rigged;
}

afterAll(async () => {
  if (rigged !== null) await (await rigged).drop();
});

function caller(actor: Principal): Caller {
  return { actor, traceId: crypto.randomUUID() };
}

function value<T>(outcome: { status: 'accepted'; value: T } | { status: 'error'; reason: string }) {
  if (outcome.status !== 'accepted') throw new Error(`refused: ${outcome.reason}`);
  return outcome.value;
}

async function harnessIn(r: Rig, key: string, area: string): Promise<string> {
  const harnessId = crypto.randomUUID();
  const activate = {
    harnessId,
    harnessKey: key,
    jdArea: area,
    template: software,
    repository: `unfoldingWord/${key}`,
  };
  value(await r.kernel.stages.activate(caller(r.ian), activate));
  const change = { agentPickup: 'allowed' as const };
  value(
    await r.kernel.stages.updateStage(caller(r.ian), { harnessId, stageKey: 'package', change }),
  );
  return harnessId;
}

async function enqueue(r: Rig, harnessId: string, title: string): Promise<string> {
  const input = { harnessId, title, pageId: null, priority: 1, due: null, delegationId: null };
  return value(await r.kernel.items.enqueue(caller(r.ian), input)).itemId;
}

async function pageIn(r: Rig): Promise<string> {
  const id = crypto.randomUUID();
  const frontmatter = { owner: `human:${OWNER.id}`, summary: 'A page both hosts read.' };
  const slug = `conformance-read-${id.slice(0, 8)}`;
  const page = { id, type: 'product' as const, status: 'draft' as const, slug, frontmatter };
  await seedPage(r.db, { ...page, jdArea: '80-89', title: 'Conformance', bodyMd: 'Read me.' });
  return id;
}

function builder(owner: Principal): Principal {
  return principalSchema.parse({
    ...owner,
    identity: 'agent:builder',
    kind: 'agent',
    email: null,
    interactive: false,
  });
}

async function delegated(r: Rig, harnessId: string) {
  const input = { harnessId, persona: 'agent:builder', capability: 'build' as const };
  const delegation = value(
    await r.kernel.delegations.grant(caller(r.owner), {
      ...input,
      expiresAt: null,
      supersedes: null,
    }),
  );
  const beat = value(
    await r.kernel.delegations.beat(caller(builder(r.owner)), { delegationId: delegation.id }),
  );
  return { delegationId: delegation.id, beat: beat.principal };
}

async function openScene(r: Rig): Promise<Scene> {
  scenes += 1;
  const harnessId = await harnessIn(r, `software-conformance-${scenes}`, '80-89');
  const hidden = await harnessIn(r, `software-hidden-${scenes}`, '30-39');
  const undelegated = await harnessIn(r, `software-undelegated-${scenes}`, '80-89');
  const { delegationId, beat } = await delegated(r, harnessId);
  await seedSpendReading(r.db, harnessId, r.clock.now());
  const workflowItem = await enqueue(r, harnessId, 'workflow item');
  const workflowRunId = crypto.randomUUID();
  const run = { id: workflowRunId, harnessId, itemId: workflowItem, delegationId };
  await seedHostedRun(r.db, { ...run, persona: beat.identity });
  return {
    harnessId,
    laptopItem: await enqueue(r, harnessId, 'laptop item'),
    workflowItem,
    workflowRunId,
    hiddenItem: await enqueue(r, hidden, 'hidden item'),
    hiddenHarness: hidden,
    undelegatedHarness: undelegated,
    delegationId,
    beat,
    pageId: await pageIn(r),
  };
}

function workflowContext(r: Rig, principal: Principal): Omit<VerbContext, 'host'> {
  return {
    principal,
    at: r.clock.now(),
    traceId: crypto.randomUUID(),
    kernel: r.kernel,
    db: r.db,
    commit: 'test-commit',
    logger: createLogger(
      { traceId: 'trace', commit: 'test-commit', route: 'workflow', principal: null },
      () => undefined,
    ),
  };
}

async function hostsOf(
  r: Rig,
  inProcess: Principal,
  headers: Record<string, string> = {},
): Promise<Hosts> {
  const token = await r.fixture.signForMcp({ email: OWNER.email });
  const app = createApp(postgresDeps(r.db, r.fixture, undefined, r.clock));
  const external = await httpClient(app, {
    'cf-access-jwt-assertion': token,
    'x-uw-device': 'laptop',
    ...headers,
  });
  const workflow = await serveVerbsForTest(workflowContext(r, inProcess));
  return { external, workflow };
}

async function withHosts(work: (r: Rig, scene: Scene, hosts: Hosts) => Promise<void>) {
  const r = await rig();
  const scene = await openScene(r);
  const hosts = await hostsOf(r, scene.beat);
  try {
    await work(r, scene, hosts);
  } finally {
    await Promise.all([hosts.external.close(), hosts.workflow.close()]);
  }
}

function servedNames(): string[] {
  return verbRegistry
    .filter((verb) => verb.servedInV1 && !isForbiddenVerbName(verb.name))
    .map((verb) => verb.name);
}

type Call = { readonly verb: string; readonly args: Body };

function itemOn(host: McpHost, scene: Scene): string {
  return host === 'external' ? scene.laptopItem : scene.workflowItem;
}

function pageArgs(host: McpHost): Body {
  const pageId = crypto.randomUUID();
  return {
    pageId,
    type: 'product',
    jdArea: '80-89',
    slug: `conformance-${host}-${pageId.slice(0, 8)}`,
    title: `Written from the ${host} host`,
    parentId: null,
    frontmatter: { owner: `human:${OWNER.id}`, summary: 'A page the conformance check writes.' },
    bodyMd: 'Conformance.',
    expectedVersion: null,
  };
}

function itemCalls(host: McpHost, scene: Scene): Call[] {
  const itemId = itemOn(host, scene);
  const delegationId = host === 'external' ? null : scene.delegationId;
  const runId = host === 'external' ? crypto.randomUUID() : scene.workflowRunId;
  const run = { runId, step: 'work', tokensIn: 1, tokensOut: 1 };
  return [
    { verb: 'poll_queue', args: { harnessId: scene.harnessId, limit: 5 } },
    { verb: 'claim_item', args: { itemId, delegationId } },
    { verb: 'record_run_step', args: { itemId, ...run, costBasis: hostBasis.get(host) } },
    { verb: 'resolve_context', args: { itemId } },
    {
      verb: 'submit_to_gate',
      args: { itemId, evidence: {}, to: null, pullRequest: null, head: null },
    },
  ];
}

function sceneCalls(host: McpHost, scene: Scene): Call[] {
  const stageItems = { harnessId: scene.harnessId, stageKey: 'package' };
  return [
    ...itemCalls(host, scene),
    { verb: 'get_health', args: { harnessId: scene.harnessId } },
    { verb: 'search_pages', args: { query: 'conformance', type: null, limit: 10 } },
    { verb: 'read_page', args: { pageId: scene.pageId } },
    { verb: 'write_page', args: pageArgs(host) },
    { verb: 'query_entities', args: { query: 'stage_items', params: stageItems } },
    {
      verb: 'create_task',
      args: { title: `task from ${host}`, jdArea: '80-89', pageId: null, due: null },
    },
  ];
}

const expectedOutcomes = new Map<string, 'accepted' | ErrorReason>([
  ['poll_queue', 'accepted'],
  ['claim_item', 'accepted'],
  ['record_run_step', 'accepted'],
  ['resolve_context', 'accepted'],
  ['submit_to_gate', 'accepted'],
  ['get_health', 'accepted'],
  ['search_pages', 'accepted'],
  ['read_page', 'accepted'],
  ['write_page', 'accepted'],
  ['query_entities', 'accepted'],
  ['create_task', 'accepted'],
]);

function outcomeOf(client: Client, name: string, args: Body): Promise<unknown> {
  return client.callTool({ name, arguments: args }).then(
    (result) => result,
    (error: unknown) => error,
  );
}

async function callEach(host: McpHost, client: Client, scene: Scene): Promise<CallResult[]> {
  const calls = sceneCalls(host, scene);
  expect(calls.map((call) => call.verb).toSorted()).toEqual(servedNames().toSorted());
  const results: CallResult[] = [];
  for (const { verb, args } of calls) {
    const expected = expectedOutcomes.get(verb) ?? 'internal_error';
    results.push({ verb, outcome: await outcomeOf(client, verb, args), expected });
  }
  return results;
}

async function surfacesMatch(_r: Rig, _scene: Scene, hosts: Hosts): Promise<void> {
  const served = servedNames();
  expect(served.toSorted()).toEqual([...verbHandlers.keys()].toSorted());
  const surfaces: ToolSurface[] = [
    { host: 'workflow', tools: (await hosts.workflow.listTools()).tools },
    { host: 'external', tools: (await hosts.external.listTools()).tools },
  ];
  expect(toolSurfaceMismatches(surfaces, served)).toEqual([]);
  expect(surfaces.map((surface) => surface.tools.length)).toEqual([served.length, served.length]);
}

async function everyVerbCallable(_r: Rig, scene: Scene, hosts: Hosts): Promise<void> {
  const workflow = await callEach('workflow', hosts.workflow, scene);
  const external = await callEach('external', hosts.external, scene);
  expect(callableFailures('workflow', workflow)).toEqual([]);
  expect(callableFailures('external', external)).toEqual([]);
}

function textOf(outcome: unknown): string {
  if (typeof outcome !== 'object' || outcome === null || !('content' in outcome)) return '';
  const content = Array.isArray(outcome.content) ? outcome.content : [];
  const block: unknown = content[0];
  return typeof block === 'object' && block !== null && 'text' in block ? String(block.text) : '';
}

async function body(client: Client, name: string, args: Body): Promise<Body> {
  return JSON.parse(textOf(await outcomeOf(client, name, args)));
}

function step(itemId: string, costBasis: CostBasis, runId: string = crypto.randomUUID()): Body {
  return { itemId, runId, step: 'work', tokensIn: 1, tokensOut: 1, costBasis };
}

function basisRefusal(expected: CostBasis): Body {
  return {
    status: 'error',
    reason: 'not_permitted',
    detail: { why: 'cost_basis_is_the_hosts', expected },
  };
}

async function claimBoth(scene: Scene, hosts: Hosts): Promise<void> {
  const laptop = await body(hosts.external, 'claim_item', {
    itemId: scene.laptopItem,
    delegationId: null,
  });
  expect(laptop['leaseExpiresAt']).toEqual(expect.any(String));
  const claim = { itemId: scene.workflowItem, delegationId: scene.delegationId };
  expect((await body(hosts.workflow, 'claim_item', claim))['leaseExpiresAt']).toEqual(
    expect.any(String),
  );
}

async function hostSetsCostBasis(r: Rig, scene: Scene, hosts: Hosts): Promise<void> {
  await claimBoth(scene, hosts);
  expect(await body(hosts.external, 'record_run_step', step(scene.laptopItem, 'metered'))).toEqual(
    basisRefusal('subscription'),
  );
  expect(
    await body(hosts.workflow, 'record_run_step', step(scene.workflowItem, 'subscription')),
  ).toEqual(basisRefusal('metered'));
  const external = await body(
    hosts.external,
    'record_run_step',
    step(scene.laptopItem, 'subscription'),
  );
  expect(external['leaseWarning']).toBe(false);
  const workflow = await body(
    hosts.workflow,
    'record_run_step',
    step(scene.workflowItem, 'metered', scene.workflowRunId),
  );
  expect(workflow['leaseWarning']).toBe(false);
  await overriddenHost(r, scene);
}

async function overriddenHost(r: Rig, scene: Scene): Promise<void> {
  const context: VerbContext = { ...workflowContext(r, scene.beat), host: 'external' };
  const client = await serveVerbsForTest(context);
  try {
    expect(await body(client, 'record_run_step', step(scene.workflowItem, 'subscription'))).toEqual(
      basisRefusal('metered'),
    );
  } finally {
    await client.close();
  }
}

async function unknownOnBoth(_r: Rig, _scene: Scene, hosts: Hosts): Promise<void> {
  for (const client of [hosts.workflow, hosts.external]) {
    const error = await outcomeOf(client, 'approve_item', {});
    expect(error instanceof McpError && error.code).toBe(-32602);
    expect(error instanceof Error ? error.message : '').toContain('Unknown tool: approve_item');
  }
}

type Probe = {
  readonly verb: string;
  readonly args: (id: string) => Body;
  readonly hidden: (scene: Scene) => string;
};

const probes: readonly Probe[] = [
  {
    verb: 'claim_item',
    args: (itemId) => ({ itemId, delegationId: null }),
    hidden: (scene) => scene.hiddenItem,
  },
  { verb: 'resolve_context', args: (itemId) => ({ itemId }), hidden: (scene) => scene.hiddenItem },
  {
    verb: 'get_health',
    args: (harnessId) => ({ harnessId }),
    hidden: (scene) => scene.hiddenHarness,
  },
];

async function hiddenAndAbsent(client: Client, scene: Scene, probe: Probe) {
  const hiddenId = probe.hidden(scene);
  const hidden = textOf(await outcomeOf(client, probe.verb, probe.args(hiddenId)));
  const absent = textOf(await outcomeOf(client, probe.verb, probe.args(MISSING)));
  return { hidden, absent: absent.replace(MISSING, hiddenId) };
}

async function beatSeesOnlyItsHarness(_r: Rig, scene: Scene, hosts: Hosts): Promise<void> {
  const health = (harnessId: string) => outcomeOf(hosts.workflow, 'get_health', { harnessId });
  expect((await body(hosts.workflow, 'get_health', { harnessId: scene.harnessId }))['status']).toBe(
    'ok',
  );
  const missing = textOf(await health(MISSING));
  expect(missing).toContain('harness_not_found');
  for (const harnessId of [scene.undelegatedHarness, scene.hiddenHarness]) {
    expect(textOf(await health(harnessId))).toBe(missing.replace(MISSING, harnessId));
  }
}

function delegatedLaptop(owner: Principal, delegationId: string): Principal {
  return principalSchema.parse({
    ...owner,
    identity: delegatedIdentity(`agent:${OWNER.id}/laptop`, 'builder', delegationId),
    kind: 'agent',
    email: null,
  });
}

async function hiddenIsMissing(r: Rig, scene: Scene): Promise<void> {
  const delegation = { 'x-uw-persona': 'builder', 'x-uw-delegation': scene.delegationId };
  const hosts = await hostsOf(r, delegatedLaptop(r.owner, scene.delegationId), delegation);
  try {
    await hiddenOnBoth(scene, hosts);
  } finally {
    await Promise.all([hosts.external.close(), hosts.workflow.close()]);
  }
}

async function hiddenOnBoth(scene: Scene, hosts: Hosts): Promise<void> {
  const replies: string[][] = [];
  for (const [name, client] of Object.entries(hosts)) {
    const host: string[] = [];
    for (const probe of probes) {
      const { hidden, absent } = await hiddenAndAbsent(client, scene, probe);
      expect(absent).toContain('_not_found');
      expect(hidden, `${name} ${probe.verb}`).toBe(absent);
      host.push(hidden);
    }
    replies.push(host);
  }
  expect(replies[0]).toEqual(replies[1]);
}

describe.skipIf(!testServer)(
  'AB-7 the Workflow host and an external runner see the same verbs, and each is callable from both',
  () => {
    it('serves both hosts the registry, with the same schemas', () => withHosts(surfacesMatch));
    it('answers every served verb on both hosts with its output or a closed refusal', () =>
      withHosts(everyVerbCallable));
    it('takes the cost basis from the host, which a caller cannot override', () =>
      withHosts(hostSetsCostBasis));
    it('answers an unserved name with the same unknown-tool error on both hosts', () =>
      withHosts(unknownOnBoth));
    it('answers a hidden id byte-identically to a missing one on both hosts', () =>
      withHosts(hiddenIsMissing));
    it('answers the beat principal in process only for the harness its delegation names', () =>
      withHosts(beatSeesOnlyItsHarness));
  },
);
