import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpError, type Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  delegatedIdentity,
  isForbiddenVerbName,
  principalSchema,
  verbRegistry,
  type CostBasis,
  type Principal,
} from '@uw/contracts';
import { createLogger } from '@uw/core/log';
import { createClient, type Database } from '@uw/db/client';
import { createMigratedDatabase, testServer } from '@uw/db/test-database';
import { seedGrant, seedPerson } from '@uw/db/test-seed';
import { software, type Caller, type Kernel } from '@uw/harness';
import { createApp } from '../app.tsx';
import { createAccessFixture, type AccessFixture } from '../testing/access-keys.ts';
import {
  callableFailures,
  toolSurfaceMismatches,
  type ToolSurface,
} from '../testing/conformance.ts';
import { kernelOn, personOn } from '../testing/kernel.ts';
import { areaGrant, httpClient, testAgent, testContext } from '../testing/mcp.ts';
import { postgresDeps } from '../testing/postgres.ts';
import type { McpHost, VerbContext } from './context.ts';
import { connectInProcess } from './in-process.ts';
import { toolsFor } from './tools.ts';
import { verbHandlers } from './verbs/index.ts';

const IAN_ID = '00000000-0000-4000-8000-000000000001';
const OWNER = {
  id: '00000000-0000-4000-8000-000000001901',
  email: 'conformance-owner@unfoldingword.org',
};
const ADMIN_GRANT = '00000000-0000-4000-8000-000000001902';
const EDITOR_GRANT = '00000000-0000-4000-8000-000000001903';
const MISSING = '00000000-0000-4000-8000-000000001999';
const FIXTURES = join(import.meta.dirname, '../../../packages/contracts/verb-fixtures');
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
  readonly delegationId: string;
  readonly beat: Principal;
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
  const activate = { harnessId, harnessKey: key, jdArea: area, template: software };
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
  const { delegationId, beat } = await delegated(r, harnessId);
  return {
    harnessId,
    laptopItem: await enqueue(r, harnessId, 'laptop item'),
    workflowItem: await enqueue(r, harnessId, 'workflow item'),
    hiddenItem: await enqueue(r, hidden, 'hidden item'),
    hiddenHarness: hidden,
    delegationId,
    beat,
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
  const token = await r.fixture.sign({ email: OWNER.email });
  const app = createApp(postgresDeps(r.db, r.fixture, undefined, r.clock));
  const external = await httpClient(app, {
    'cf-access-jwt-assertion': token,
    'x-uw-device': 'laptop',
    ...headers,
  });
  const workflow = await connectInProcess(workflowContext(r, inProcess));
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

function firstValidInput(verb: string): Body {
  const dir = join(FIXTURES, verb, 'input', 'valid');
  const [first] = readdirSync(dir).toSorted();
  if (first === undefined) throw new Error(`verb ${verb} has no valid input fixture`);
  return JSON.parse(readFileSync(join(dir, first), 'utf8'));
}

function argsOn(host: McpHost, verb: string): Body {
  const input = firstValidInput(verb);
  return verb === 'record_run_step' ? { ...input, costBasis: hostBasis.get(host) } : input;
}

function outcomeOf(client: Client, name: string, args: Body): Promise<unknown> {
  return client.callTool({ name, arguments: args }).then(
    (result) => result,
    (error: unknown) => error,
  );
}

async function callEach(host: McpHost, client: Client) {
  const results: { verb: string; outcome: unknown }[] = [];
  for (const verb of servedNames()) {
    results.push({ verb, outcome: await outcomeOf(client, verb, argsOn(host, verb)) });
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

async function everyVerbCallable(_r: Rig, _scene: Scene, hosts: Hosts): Promise<void> {
  expect(callableFailures('workflow', await callEach('workflow', hosts.workflow))).toEqual([]);
  expect(callableFailures('external', await callEach('external', hosts.external))).toEqual([]);
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

function step(itemId: string, costBasis: CostBasis): Body {
  return { itemId, runId: crypto.randomUUID(), step: 'work', tokensIn: 1, tokensOut: 1, costBasis };
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
    step(scene.workflowItem, 'metered'),
  );
  expect(workflow['leaseWarning']).toBe(false);
  await overriddenHost(r, scene);
}

async function overriddenHost(r: Rig, scene: Scene): Promise<void> {
  const context: VerbContext = { ...workflowContext(r, scene.beat), host: 'external' };
  const client = await connectInProcess(context);
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
  },
);

const AT = new Date('2026-10-02T12:00:00.000Z');

function registryTools(): Tool[] {
  return toolsFor(testAgent([areaGrant('editor', '80-89')]), AT);
}

function surfacesWith(workflow: Tool[]): ToolSurface[] {
  return [
    { host: 'workflow', tools: workflow },
    { host: 'external', tools: registryTools() },
  ];
}

const approveItem: Tool = { name: 'approve_item', inputSchema: { type: 'object' } };

function widened(tool: Tool): Tool {
  if (tool.name !== 'claim_item') return tool;
  return { ...tool, inputSchema: { ...tool.inputSchema, required: [] } };
}

async function unservedOnWorkflow(): Promise<unknown> {
  const client = await connectInProcess(testContext(testAgent([areaGrant('editor', '80-89')])));
  try {
    return await outcomeOf(client, 'list_gifts', { since: '2026-01-01' });
  } finally {
    await client.close();
  }
}

describe('AB-7 the conformance check fails on a planted host-specific tool', () => {
  it('passes the registry served to both hosts', () => {
    expect(toolSurfaceMismatches(surfacesWith(registryTools()), servedNames())).toEqual([]);
  });

  it('names a tool only the workflow host serves', () => {
    const mismatches = toolSurfaceMismatches(
      surfacesWith([...registryTools(), approveItem]),
      servedNames(),
    );
    expect(mismatches).toEqual([
      'workflow serves unregistered approve_item',
      'approve_item is served by only one of workflow and external',
    ]);
  });

  it('names a verb the workflow host does not serve', () => {
    const tools = registryTools().filter((tool) => tool.name !== 'poll_queue');
    expect(toolSurfaceMismatches(surfacesWith(tools), servedNames())).toEqual([
      'workflow lacks poll_queue',
      'poll_queue is served by only one of workflow and external',
    ]);
  });

  it('names a verb whose input schema differs between hosts', () => {
    const tools = registryTools().map(widened);
    expect(toolSurfaceMismatches(surfacesWith(tools), servedNames())).toEqual([
      'claim_item inputSchema differs between workflow and external',
    ]);
  });

  it('names a verb a host answers as an unknown tool', async () => {
    const outcome = await unservedOnWorkflow();
    expect(callableFailures('workflow', [{ verb: 'list_gifts', outcome }])).toEqual([
      'workflow answered list_gifts as an unknown tool',
    ]);
  });

  it('names a verb answered with an open refusal or an output outside its schema', () => {
    const open = {
      content: [{ type: 'text', text: '{"status":"error","reason":"boom"}' }],
      isError: true,
    };
    const wrong = { content: [{ type: 'text', text: '{}' }], structuredContent: { pages: 1 } };
    const results = [
      { verb: 'claim_item', outcome: open },
      { verb: 'search_pages', outcome: wrong },
    ];
    expect(callableFailures('external', results)).toEqual([
      'external answered claim_item with neither its output nor a closed refusal',
      'external answered search_pages with neither its output nor a closed refusal',
    ]);
  });
});
