import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { verbNames, verbRegistry, type Principal, type VerbName } from '@uw/contracts';
import { createLogger } from '@uw/core/log';
import { testServer } from '@uw/db/test-database';
import { DEFAULT_SPEND_CAP } from '@uw/harness';
import type { McpHost, VerbContext } from '../mcp/context.ts';
import { callVerb } from '../mcp/dispatch.ts';
import { toolsFor } from '../mcp/tools.ts';
import { verbHandlers } from '../mcp/verbs/index.ts';
import { kernelOn } from '../testing/kernel.ts';
import { toBase64, utf8 } from './base64.ts';
import { bindCredential, unbindCredential } from './bindings.ts';
import { notConfiguredDataKeys } from './kms/not-configured.ts';
import { exposeSecret, type Secret } from './secret.ts';
import { rotateCredential } from './store.ts';
import { dumpEveryTable, pgWorld, type PgWorld } from '../testing/credentials-world.ts';
import { agentOf, harnessId, now, person, runId, traceId } from './testing/store-world.ts';
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
    resolve_context: [{ itemId: credentialId }],
    query_entities: [
      { query: 'credentials', params: ids },
      { query: 'credential_versions', params: ids },
      { query: 'credential_access_log', params: ids },
    ],
    create_task: [ids],
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
    seen.push({ where: 'every table of the database', text: await dumpEveryTable(world.db) });
  });

  afterAll(async () => {
    for (const spy of consoles) spy.mockRestore();
    await world.drop();
  });

  describe('what was exercised', exercised);
  describe('where the value was searched for', searched);
  describe('what a refusal says', refusedByReason);
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
