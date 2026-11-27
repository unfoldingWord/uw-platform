import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  platformCommandNameSchema,
  verbNames,
  verbRegistry,
  type Principal,
  type VerbName,
} from '@uw/contracts';
import { createLogger } from '@uw/core/log';
import { personPrincipal, serviceTokenPrincipal } from '@uw/core/principal';
import { testServer } from '@uw/db/test-database';
import { DEFAULT_SPEND_CAP } from '@uw/harness';
import type { AppEnv } from '../deps.ts';
import type { McpHost, VerbContext } from '../mcp/context.ts';
import { callVerb } from '../mcp/dispatch.ts';
import { toolsFor } from '../mcp/tools.ts';
import { verbHandlers } from '../mcp/verbs/index.ts';
import { kernelOn } from '../testing/kernel.ts';
import { toBase64, utf8 } from './base64.ts';
import { bindCredential, unbindCredential } from './bindings.ts';
import { notConfiguredDataKeys } from './kms/not-configured.ts';
import { credentialRoutes } from './routes.ts';
import { exposeSecret, type Secret } from './secret.ts';
import { rotateCredential } from './store.ts';
import { dumpEveryTable, pgWorld, type PgWorld } from '../testing/credentials-world.ts';
import { agentOf, harnessId, now, people, person, runId, traceId } from './testing/store-world.ts';
import { useCredential, type CredentialUse } from './use.ts';

const first = 'uw-planted-credential-value-158-first';
const second = 'uw-planted-credential-value-158-second';
const name = 'Partner portal key';
const send = { harnessId, connectorKey: 'send' } as const;
const clock = { now: () => new Date(now) };

type Seen = { readonly where: string; readonly text: string };

let world: PgWorld;
let credentialId = '';
const seen: Seen[] = [];
const delivered: string[] = [];
const consoles = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) =>
  vi.spyOn(console, level).mockImplementation((...parts: unknown[]) => {
    seen.push({ where: `console.${level}`, text: parts.map(String).join(' ') });
  }),
);

function hex(text: string): string {
  return [...utf8(text)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function formsOf(value: string): string[] {
  const encoded = toBase64(utf8(value)).replaceAll('=', '');
  const urlSafe = encoded.replaceAll('+', '-').replaceAll('/', '_');
  return [value, encoded, urlSafe, hex(value), encodeURIComponent(value)];
}

const forms = [first, second].flatMap(formsOf);

function leaking(entries: readonly Seen[]): string[] {
  return entries
    .filter((entry) => forms.some((form) => entry.text.includes(form)))
    .map((entry) => entry.where);
}

function note(where: string, value: unknown): void {
  seen.push({ where, text: JSON.stringify(value) ?? String(value) });
}

function useOf(actor: Principal): CredentialUse {
  return { actor, ref: { credentialId }, usedBy: send, runId, traceId };
}

async function deliver(secret: Secret<string>) {
  delivered.push(exposeSecret(secret));
  return { outcome: 'succeeded', detail: { status: '202' } } as const;
}

async function credentialLife(): Promise<void> {
  const admin = person('admin');
  const agent = agentOf('editor');
  credentialId = await world.created(name, first);
  const change = { credentialId, ...send };
  note('bind', await bindCredential(world.deps, admin, change, traceId));
  note('use by an agent', await useCredential(world.deps, useOf(agent), deliver));
  const rotation = { credentialId, value: utf8(second), rotateBy: null, expiresAt: null };
  note('rotate', await rotateCredential(world.deps, admin, rotation, traceId));
  note('use after rotation', await useCredential(world.deps, useOf(agent), deliver));
  note('use by a viewer', await useCredential(world.deps, useOf(agentOf('viewer')), deliver));
  note(
    'use that throws the value',
    await useCredential(world.deps, useOf(agent), async (secret) => {
      throw new Error(`refused ${exposeSecret(secret)}`);
    }),
  );
  note(
    'use that answers the value',
    await useCredential(world.deps, useOf(agent), async (secret) => ({
      outcome: 'succeeded',
      detail: { echoed: exposeSecret(secret) },
    })),
  );
  world.keys.failNext('key_service_refused');
  note('use the key service refuses', await useCredential(world.deps, useOf(agent), deliver));
  const unconfigured = { ...world.deps, keys: notConfiguredDataKeys };
  note('use with no key service', await useCredential(unconfigured, useOf(agent), deliver));
  note('unbind', await unbindCredential(world.deps, admin, change, traceId));
  note('use when unbound', await useCredential(world.deps, useOf(agent), deliver));
  note('bind again', await bindCredential(world.deps, admin, change, traceId));
}

function argumentsOf(): Readonly<Record<VerbName, readonly unknown[]>> {
  const ids = { credentialId, credential_ref: credentialId, itemId: credentialId };
  const page = { pageId: credentialId };
  return {
    search_pages: [
      { query: name, type: null, limit: 50 },
      { query: first, type: null, limit: 50 },
      { query: 'credential', type: null, limit: 50 },
    ],
    read_page: [page],
    write_page: [page],
    attach_file: [page],
    render_pdf: [{ target: { kind: 'page', ...page } }],
    resolve_context: [{ itemId: credentialId }],
    query_entities: [
      { query: 'credentials', params: ids },
      { query: 'credential_versions', params: ids },
      { query: 'credential_access_log', params: ids },
    ],
    create_task: [ids],
    read_collection: [{ collection: 'tasks' }],
    read_view: [{ viewId: credentialId, limit: 50, cursor: null }],
    create_row: [{ collection: 'tasks', rowId: credentialId, jdArea: '30-39', title: name }],
    set_property: [{ collection: 'tasks', rowId: credentialId, property: 'title', value: name }],
    list_gifts: [{ since: '2026-01-01' }],
    create_draft_journal_entry: [ids],
    poll_queue: [
      { harnessId, limit: 50 },
      { harnessId: null, limit: 50 },
    ],
    claim_item: [{ itemId: credentialId, delegationId: null }],
    submit_to_gate: [
      { itemId: credentialId, evidence: ids, to: null, pullRequest: null, head: null },
    ],
    record_run_step: [ids],
    get_health: [{ harnessId }],
    ...measureArguments(),
    set_reminder: [{ text: name, dueAt: '2027-01-01T09:00:00Z' }],
    cancel_reminder: [{ reminderId: credentialId }],
    list_reminders: [{}],
    read_my_calendar: [{}],
    find_free_time: [{ with: [`${name}@example.org`], minutes: 30 }],
    hold_time: [{ title: name, start: '2027-01-01T09:00:00Z', end: '2027-01-01T10:00:00Z' }],
    release_hold: [{ holdId: credentialId }],
    ...proposalArguments(),
  };
}

function measureArguments() {
  return {
    save_measure: [{ measureId: credentialId }],
    save_dashboard: [{ dashboardId: credentialId }],
    run_measure: [{ measureId: credentialId }],
    read_measure_run: [{ measureId: credentialId, runId: null }],
    read_metric: [{ measureId: credentialId, metric: 'score' }],
    read_observations: [{ measureId: credentialId }],
    preview_dashboard: [{ dashboardId: credentialId, hostPageId: null }],
  };
}

function proposalArguments() {
  const invite = {
    title: name,
    start: '2027-01-01T09:00:00Z',
    end: '2027-01-01T10:00:00Z',
    attendees: ['ana@example.org'],
  };
  return {
    propose_email: [{ to: ['ana@example.org'], subject: name, body: name }],
    propose_invite: [invite],
    propose_page_append: [{ pageId: credentialId, text: name }],
    search_web: [{ query: name }],
    read_web_page: [{ url: `https://${name}.example.org/` }],
    find_flights: [{ origin: 'NBO', destination: 'GVA', departDate: '2027-03-01' }],
  };
}

function contextOf(principal: Principal, host: McpHost): VerbContext {
  const logger = createLogger(
    { traceId, commit: 'test-commit', route: 'POST /mcp', principal: principal.identity },
    (line) => seen.push({ where: `log line of ${principal.identity} on ${host}`, text: line }),
  );
  return {
    principal,
    host,
    at: clock.now(),
    traceId,
    kernel: kernelOn(world.db, clock),
    db: world.db,
    commit: 'test-commit',
    cap: DEFAULT_SPEND_CAP,
    logger,
  };
}

async function callEveryVerb(principal: Principal, host: McpHost): Promise<number> {
  const context = contextOf(principal, host);
  note(`tools offered to ${principal.identity}`, toolsFor(principal, context.at));
  let calls = 0;
  for (const [verb, attempts] of Object.entries(argumentsOf())) {
    for (const args of attempts) {
      const where = `${verb} as ${principal.identity} on ${host}`;
      calls += 1;
      try {
        note(where, await callVerb(context, verb, args, verbHandlers));
      } catch (error) {
        note(where, error instanceof Error ? `${error.name}: ${error.message}` : error);
      }
    }
  }
  return calls;
}

const credentialCommands = platformCommandNameSchema.options.filter(
  (command) => command.includes('credential') || command.includes('reveal'),
);
const routeAnswers: { readonly where: string; readonly status: number; readonly text: string }[] =
  [];

function routesAs(principal: Principal): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const database = { db: world.db, ping: async () => undefined, release: async () => undefined };
  const logger = createLogger(
    { traceId, commit: 'test-commit', route: 'POST', principal: principal.identity },
    (line) => seen.push({ where: `route log line of ${principal.identity}`, text: line }),
  );
  app.use(async (c, next) => {
    c.set('database', database);
    c.set('principal', principal);
    c.set('traceId', traceId);
    c.set('now', clock.now());
    c.set('logger', logger);
    c.set('outcome', null);
    await next();
  });
  const noNetwork: typeof fetch = () => Promise.reject(new Error('no network in this test'));
  const timers = { after: () => new Promise<void>(() => undefined) };
  const platform = { fetch: noNetwork, timers, clock, newId: () => crypto.randomUUID() };
  app.route('/api/credentials', credentialRoutes(platform));
  return app;
}

function bodyFor(command: string): Record<string, unknown> {
  return {
    command,
    requestId: crypto.randomUUID(),
    credentialId,
    grantId: credentialId,
    harnessId,
    connectorKey: 'send',
    personId: people.admin,
    ownerId: people.admin,
    minutes: 60,
    jdArea: '20-29',
    jdRef: null,
    name: `Made by an agent ${crypto.randomUUID()}`,
    kind: 'api_key',
    rotateBy: null,
    expiresAt: null,
    value: 'a value an agent offers',
  };
}

async function callEveryRoute(principal: Principal): Promise<void> {
  const app = routesAs(principal);
  for (const command of credentialCommands) {
    const path = command === 'reveal_credential' ? 'reveal' : `commands/${command}`;
    const whole = bodyFor(command);
    for (const body of [whole, { command, requestId: whole['requestId'], credentialId }]) {
      const response = await app.request(`/api/credentials/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const text = await response.text();
      const where = `${command} route for ${principal.identity}`;
      routeAnswers.push({ where, status: response.status, text });
      seen.push({ where, text });
    }
  }
}

function notPeopleAtTheKeyboard(): Principal[] {
  const lender = person('admin');
  const lent = personPrincipal({
    personId: people.admin,
    email: lender.email ?? '',
    grants: lender.grants,
    interactive: false,
  });
  return [agentOf('admin'), agentOf('editor'), lent, serviceTokenPrincipal('a1b2c3d4.access')];
}

function routesRefused(): void {
  it('refuses every credential route to an agent, a lent person and a service token', () => {
    expect(credentialCommands).toHaveLength(9);
    expect(routeAnswers).toHaveLength(9 * 2 * 4);
    const letThrough = routeAnswers.filter((answer) => answer.status < 400);
    expect(letThrough.map((answer) => answer.where)).toEqual([]);
    const reasons = new Set(
      routeAnswers.map((answer) => String(JSON.parse(answer.text)['reason'] ?? '')),
    );
    expect([...reasons].sort()).toEqual(['not_permitted']);
  });

  it('let none of them write: no row of the five tables names one as the actor of a change', async () => {
    const rows = await world.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM credential_access_log
          WHERE action NOT IN ('use') AND actor NOT LIKE 'human:%' AND outcome = 'done'`,
    );
    expect([...rows][0]?.n).toBe(0);
    const made = await world.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM credentials WHERE name LIKE 'Made by an agent%'`,
    );
    expect([...made][0]?.n).toBe(0);
  });
}

let calls = 0;

function exercised(): void {
  it('did hand both values to the outside service, so the search below is not vacuous', () => {
    expect(delivered).toEqual([first, second]);
    expect(leaking([{ where: 'the outside service', text: delivered.join(' ') }])).toEqual([
      'the outside service',
    ]);
  });

  it('called every verb of the registry, as three agents on both hosts', () => {
    expect(Object.keys(argumentsOf()).sort()).toEqual([...verbNames].sort());
    expect(calls).toBeGreaterThanOrEqual(verbNames.length * 6);
    const answered = seen.filter((entry) => entry.where.includes(' as agent:'));
    expect(answered).toHaveLength(calls);
    expect(answered.some((entry) => entry.text.includes('"structuredContent"'))).toBe(true);
    expect(answered.some((entry) => entry.text.includes('"isError":true'))).toBe(true);
  });
}

function searched(): void {
  it('finds the value in no outcome, tool reply, tool listing, log line or console line', () => {
    expect(seen.length).toBeGreaterThan(calls);
    expect(leaking(seen)).toEqual([]);
  });

  it('finds the value in no row of any table, in plain text, base64 or hex', () => {
    const dump = seen.find((entry) => entry.where === 'every table of the database');
    expect(dump?.text).toContain(`credentials {"id":"${credentialId}"`);
    expect(dump?.text).toContain('credential_access_log');
    expect(leaking(dump === undefined ? [] : [dump])).toEqual([]);
  });
}

function refusedByReason(): void {
  it('answers the refusals by their closed-set reasons only', () => {
    const reasons = new Map(seen.map((entry) => [entry.where, entry.text]));
    expect(reasons.get('use by a viewer')).toBe('{"ok":false,"reason":"not_permitted"}');
    expect(reasons.get('use that throws the value')).toBe(
      '{"ok":false,"reason":"connector_failed"}',
    );
    expect(reasons.get('use that answers the value')).toBe(
      '{"ok":false,"reason":"value_in_outcome"}',
    );
    expect(reasons.get('use the key service refuses')).toBe(
      '{"ok":false,"reason":"key_service_refused"}',
    );
    expect(reasons.get('use with no key service')).toBe(
      '{"ok":false,"reason":"key_service_not_configured"}',
    );
    expect(reasons.get('use when unbound')).toBe('{"ok":false,"reason":"not_permitted"}');
  });
}

describe.skipIf(!testServer)('#158 an agent never sees the value of a credential', () => {
  beforeAll(async () => {
    world = await pgWorld(testServer ?? '');
    await credentialLife();
    for (const principal of [agentOf('editor'), agentOf('admin'), agentOf('outsider')]) {
      calls += await callEveryVerb(principal, 'external');
      calls += await callEveryVerb(principal, 'workflow');
    }
    for (const principal of notPeopleAtTheKeyboard()) await callEveryRoute(principal);
    seen.push({ where: 'every table of the database', text: await dumpEveryTable(world.db) });
  });

  afterAll(async () => {
    for (const spy of consoles) spy.mockRestore();
    await world.drop();
  });

  describe('what was exercised', exercised);
  describe('where the value was searched for', searched);
  describe('what a refusal says', refusedByReason);
  describe('#159 the credential routes', routesRefused);
});

describe('#158 no verb names a credential or answers a value', () => {
  const valueWords = /credential|secret|reveal|decrypt|plaintext/i;

  it('offers no verb whose name or summary speaks of a credential', () => {
    const speaking = verbRegistry.filter(
      (verb) => valueWords.test(verb.name) || valueWords.test(verb.summary),
    );
    expect(speaking.map((verb) => verb.name)).toEqual([]);
  });

  it('declares no input or output field that names a credential or its value', () => {
    const everyone = agentOf('admin');
    const schemas = toolsFor(everyone, clock.now()).map((tool) =>
      JSON.stringify([tool.inputSchema, tool.outputSchema]),
    );
    expect(schemas.length).toBeGreaterThan(0);
    expect(schemas.filter((schema) => valueWords.test(schema))).toEqual([]);
  });

  it('has no handler for a verb the registry does not hold', () => {
    const known = new Set<string>(verbNames);
    expect([...verbHandlers.keys()].filter((verb) => !known.has(verb))).toEqual([]);
  });
});
