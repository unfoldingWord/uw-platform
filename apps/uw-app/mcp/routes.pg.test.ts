import { beforeAll, describe, expect, it } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { principalSchema, verbRegistry, type Principal } from '@uw/contracts';
import { createLogger } from '@uw/core/log';
import type { Database } from '@uw/db/client';
import { seedGrant, seedHarness, seedPerson } from '@uw/db/test-seed';
import { createApp } from '../app.tsx';
import { platformKernel } from '../kernel.ts';
import {
  createAccessFixture,
  fixtureAccessEnv,
  type AccessFixture,
} from '../testing/access-keys.ts';
import { callTool, httpClient } from '../testing/mcp.ts';
import { postgresDeps, testServer, withAppDatabase } from '../testing/postgres.ts';
import { personOn } from '../testing/kernel.ts';
import { callVerb } from './dispatch.ts';
import { verbHandlers } from './verbs/index.ts';

const EDITOR = {
  id: '00000000-0000-4000-8000-000000001201',
  email: 'mcp-editor@unfoldingword.org',
};
const VIEWER = {
  id: '00000000-0000-4000-8000-000000001202',
  email: 'mcp-viewer@unfoldingword.org',
};
const HARNESS = '00000000-0000-4000-8000-000000001210';
const granted = new Date('2026-01-01T00:00:00.000Z');
const INDICATORS = [
  'harness',
  'database',
  'spend',
  'breaker',
  'runs_today',
  'live_delegations',
  'gate_refusals_week',
  'agent_writes',
  'stale_learnings',
];
const NOT_WIRED = INDICATORS.slice(2);

let fixture: AccessFixture;

beforeAll(async () => {
  fixture = await createAccessFixture();
});

function areaGrant(id: string, personId: string, role: 'viewer' | 'editor', area: string) {
  return {
    id,
    personId,
    role,
    scopeKind: 'jd_area' as const,
    scopeArea: area,
    grantedAt: granted,
    expiresAt: null,
  };
}

async function seed(db: Database): Promise<void> {
  await seedPerson(db, EDITOR);
  await seedPerson(db, VIEWER);
  await seedGrant(
    db,
    areaGrant('00000000-0000-4000-8000-000000001203', EDITOR.id, 'editor', '80-89'),
  );
  await seedGrant(
    db,
    areaGrant('00000000-0000-4000-8000-000000001204', VIEWER.id, 'viewer', '20-29'),
  );
  await seedHarness(db, { id: HARNESS, key: 'software', jdArea: '80-89' });
}

async function editorClient(db: Database): Promise<Client> {
  const token = await fixture.sign({ email: EDITOR.email });
  return httpClient(createApp(postgresDeps(db, fixture)), {
    'cf-access-jwt-assertion': token,
    'x-uw-device': 'laptop',
  });
}

async function rawMcp(db: Database, method: string, jwt: string | null): Promise<Response> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'x-uw-device': 'laptop',
    ...(jwt === null ? {} : { 'cf-access-jwt-assertion': jwt }),
  };
  const body =
    method === 'POST' ? JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) : null;
  return createApp(postgresDeps(db, fixture)).request(
    '/mcp',
    { method, headers, body },
    fixtureAccessEnv,
  );
}

async function tampered(): Promise<string> {
  const token = await fixture.sign({ email: EDITOR.email });
  const [header, payload, signature] = token.split('.');
  return `${header}.${payload}.${signature?.startsWith('A') ? 'B' : 'A'}${signature?.slice(1) ?? ''}`;
}

type Indicator = { readonly name: string; readonly status: string };

function indicatorsOf(body: Record<string, unknown>): Indicator[] {
  const indicators = body['indicators'];
  return Array.isArray(indicators) ? indicators.map((entry: Indicator) => entry) : [];
}

function namesOf(indicators: readonly Indicator[]): string[] {
  return indicators.map((indicator) => indicator.name);
}

function withStatus(indicators: readonly Indicator[], status: string): Indicator[] {
  return indicators.filter((indicator) => indicator.status === status);
}

function servedNames(): string[] {
  return verbRegistry.filter((verb) => verb.servedInV1).map((verb) => verb.name);
}

async function listedNames(client: Client): Promise<string[]> {
  const { tools } = await client.listTools();
  return tools.map((tool) => tool.name);
}

async function unknownTool(client: Client): Promise<unknown> {
  try {
    await client.callTool({ name: 'approve', arguments: {} });
  } catch (error) {
    return error;
  }
  return null;
}

async function healthOverHttp(db: Database): Promise<Record<string, unknown>> {
  const client = await editorClient(db);
  try {
    const result = await callTool(client, 'get_health', { harnessId: HARNESS });
    expect(result.isError).toBe(false);
    return result.body;
  } finally {
    await client.close();
  }
}

describe.skipIf(!testServer)('AB-1 /mcp is a Streamable HTTP endpoint behind Access', () => {
  it('refuses a request with no Access JWT, and one with a tampered JWT, unauthenticated', () =>
    withAppDatabase(async (db) => {
      await seed(db);
      expect((await rawMcp(db, 'POST', null)).status).toBe(401);
      const refused = await rawMcp(db, 'POST', await tampered());
      expect(refused.status).toBe(401);
      expect(await refused.json()).toEqual({ status: 'error', reason: 'unauthenticated' });
    }));

  it('initialises an SDK client for an editor on a laptop and lists the served verbs', () =>
    withAppDatabase(async (db) => {
      await seed(db);
      const client = await editorClient(db);
      expect(await listedNames(client)).toEqual(servedNames());
      expect(await unknownTool(client)).toBeInstanceOf(McpError);
      await client.close();
    }));

  it('answers get_health on a harness in 80-89 with every indicator, the WB-10 ones not wired', () =>
    withAppDatabase(async (db) => {
      await seed(db);
      const body = await healthOverHttp(db);
      const indicators = indicatorsOf(body);
      expect(namesOf(indicators)).toEqual(INDICATORS);
      expect(namesOf(withStatus(indicators, 'not_wired'))).toEqual(NOT_WIRED);
      expect(namesOf(withStatus(indicators, 'ok'))).toEqual(['harness', 'database']);
      expect(body['status']).toBe('ok');
    }));

  it('answers GET and DELETE 405 with Allow: POST', () =>
    withAppDatabase(async (db) => {
      await seed(db);
      const token = await fixture.sign({ email: EDITOR.email });
      for (const method of ['GET', 'DELETE']) {
        const response = await rawMcp(db, method, token);
        expect(response.status).toBe(405);
        expect(response.headers.get('allow')).toBe('POST');
        expect(await response.json()).toEqual({ status: 'error', reason: 'not_wired' });
      }
    }));
});

function viewerAgent(person: Principal): Principal {
  return principalSchema.parse({
    ...person,
    identity: `agent:${VIEWER.id}/laptop`,
    kind: 'agent',
    email: null,
  });
}

async function healthAs(db: Database, principal: Principal) {
  const handle = { db, ping: async () => undefined, release: async () => undefined };
  const context = {
    principal,
    host: 'external' as const,
    at: new Date(),
    traceId: '00000000-0000-4000-8000-000000001220',
    kernel: platformKernel(handle),
    db,
    commit: 'test-commit',
    logger: createLogger(
      { traceId: 't', commit: 'c', route: 'mcp', principal: null },
      () => undefined,
    ),
  };
  return callVerb(context, 'get_health', { harnessId: HARNESS }, verbHandlers);
}

describe.skipIf(!testServer)('AB-3 get_health is gated on the harness area', () => {
  it('answers an agent that cannot read 80-89 harness_not_found', () =>
    withAppDatabase(async (db) => {
      await seed(db);
      const person = await personOn(db, VIEWER.id, VIEWER.email, new Date());
      const result = await healthAs(db, viewerAgent(person));
      expect(result.isError).toBe(true);
      expect(result.content).toEqual([
        {
          type: 'text',
          text: JSON.stringify({
            status: 'error',
            reason: 'harness_not_found',
            detail: { harnessId: HARNESS },
          }),
        },
      ]);
    }));
});
