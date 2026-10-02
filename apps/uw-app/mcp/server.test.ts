import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/cfworker';
import {
  CONTRACT_VERSION,
  principalSchema,
  verbRegistry,
  type Grant,
  type HealthReport,
  type Principal,
  type Role,
} from '@uw/contracts';
import { createLogger } from '@uw/core/log';
import { createClient } from '@uw/db/client';
import { PortNotWiredError } from '@uw/harness';
import { platformKernel } from '../kernel.ts';
import { callTool } from '../testing/mcp.ts';
import type { VerbContext } from './context.ts';
import {
  gatedHandler,
  rowFilteredHandler,
  type RowFilteredHandler,
  type VerbHandler,
} from './handler.ts';
import { createVerbServer } from './server.ts';

const OWNER = '00000000-0000-4000-8000-000000000301';
const ITEM = '00000000-0000-4000-8000-000000000302';
const HARNESS = '00000000-0000-4000-8000-000000000303';
const at = new Date('2026-10-02T12:00:00.000Z');
const healthy: HealthReport = { status: 'ok', commit: 'test-commit', indicators: [] };

const UNKNOWN_NAMES = [
  'approve',
  'Approve',
  'APPROVE',
  'approve_item',
  'gate_approve',
  'merge',
  'merge_pr',
  'deploy',
  'publish',
  'publish_page',
  'advance',
  'advance_item',
  ' approve',
  'list_gifts',
  'nope',
];

function grant(role: Role, area: string): Grant {
  return {
    grantId: '00000000-0000-4000-8000-000000000304',
    role,
    scopeKind: 'jd_area',
    scopeArea: area,
    expiresAt: null,
  };
}

function agent(grants: readonly Grant[]): Principal {
  return principalSchema.parse({
    identity: `agent:${OWNER}/laptop`,
    kind: 'agent',
    personId: OWNER,
    email: null,
    grants,
    interactive: true,
  });
}

function contextFor(principal: Principal, lines: string[] = []): VerbContext {
  return {
    principal,
    host: 'external',
    at,
    traceId: '00000000-0000-4000-8000-000000000305',
    kernel: platformKernel(null),
    db: createClient('postgres://unused@127.0.0.1:1/unused'),
    commit: 'test-commit',
    logger: createLogger(
      { traceId: 'trace', commit: 'test-commit', route: 'POST /mcp', principal: null },
      (line) => lines.push(line),
    ),
  };
}

type Recorder = { readonly seen: Principal[]; readonly ran: string[] };

function stubHandlers(recorder: Recorder): ReadonlyMap<string, VerbHandler> {
  const health = gatedHandler({
    name: 'get_health',
    hiddenAs: 'harness_not_found',
    resource: async () => ({ kind: 'area', area: '80-89' }),
    run: async (context) => {
      recorder.seen.push(context.principal);
      recorder.ran.push('get_health');
      return { status: 'accepted', output: healthy };
    },
  });
  const claim = gatedHandler({
    name: 'claim_item',
    hiddenAs: 'item_not_found',
    resource: async () => ({ kind: 'area', area: '80-89' }),
    run: async () => {
      recorder.ran.push('claim_item');
      return {
        status: 'accepted',
        output: { itemId: ITEM, leaseExpiresAt: null, leaseWarning: false },
      };
    },
  });
  return new Map<string, VerbHandler>([
    [health.name, health],
    [claim.name, claim],
    ...throwingHandlers(recorder).map((handler): [string, VerbHandler] => [handler.name, handler]),
  ]);
}

function throwingHandlers(
  recorder: Recorder,
): RowFilteredHandler<'poll_queue' | 'search_pages' | 'query_entities'>[] {
  return [
    rowFilteredHandler({
      name: 'poll_queue',
      run: async () => {
        recorder.ran.push('poll_queue');
        throw new PortNotWiredError('store', 'transaction');
      },
    }),
    rowFilteredHandler({
      name: 'search_pages',
      run: async () => {
        recorder.ran.push('search_pages');
        throw new Error('boom');
      },
    }),
    rowFilteredHandler({
      name: 'query_entities',
      run: async () => ({
        status: 'accepted',
        output: { rows: [{ count: Number.POSITIVE_INFINITY }] },
      }),
    }),
  ];
}

async function connected(
  context: VerbContext,
  handlers: ReadonlyMap<string, VerbHandler>,
): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createVerbServer(context, handlers).connect(serverSide);
  const client = new Client(
    { name: 'uw-test', version: CONTRACT_VERSION },
    { jsonSchemaValidator: new CfWorkerJsonSchemaValidator() },
  );
  await client.connect(clientSide);
  return client;
}

async function rejection(work: Promise<unknown>): Promise<unknown> {
  try {
    await work;
  } catch (error) {
    return error;
  }
  return null;
}

function initializeRequest(): Request {
  return new Request('http://uw.test/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'raw', version: '1' },
      },
    }),
  });
}

async function rawInitialize(): Promise<Response> {
  const server = createVerbServer(contextFor(agent([grant('editor', '80-89')])));
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(initializeRequest());
  } finally {
    await server.close();
  }
}

function newRecorder(): Recorder {
  return { seen: [], ran: [] };
}

describe('AB-1 the verb server runs in workerd', () => {
  it('lists the served tools to an SDK client using the cfworker validator', async () => {
    const client = await connected(
      contextFor(agent([grant('editor', '80-89')])),
      stubHandlers(newRecorder()),
    );
    const { tools } = await client.listTools();
    const served = verbRegistry.filter((verb) => verb.servedInV1).map((verb) => verb.name);
    expect(tools.map((tool) => tool.name)).toEqual(served);
    await client.close();
  });

  it('answers a raw initialize over the web-standard transport with JSON', async () => {
    const response = await rawInitialize();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    const body = (await response.json()) as { result: { serverInfo: { name: string } } };
    expect(body.result.serverInfo.name).toBe('uw-platform');
  });
});

async function expectUnknownTool(client: Client, name: string): Promise<void> {
  const error = await rejection(client.callTool({ name, arguments: {} }));
  expect(error).toBeInstanceOf(McpError);
  expect(error).toMatchObject({ code: ErrorCode.InvalidParams });
  expect(error instanceof McpError && error.code).toBe(-32602);
  expect(error instanceof Error ? error.message : '').toContain(`Unknown tool: ${name}`);
}

describe('AB-1 a forbidden or unknown name is the unknown-tool error', () => {
  it.each(UNKNOWN_NAMES)('refuses %j as an unknown tool and runs no handler', async (name) => {
    const recorder = newRecorder();
    const client = await connected(
      contextFor(agent([grant('admin', '40-49'), grant('editor', '80-89')])),
      stubHandlers(recorder),
    );
    await expectUnknownTool(client, name);
    expect(recorder.ran).toEqual([]);
    await client.close();
  });
});

describe('AB-3 the handler receives the principal minted at the edge', () => {
  it('passes the principal given to the server to the handler, unchanged', async () => {
    const recorder = newRecorder();
    const principal = agent([grant('viewer', '80-89')]);
    const client = await connected(contextFor(principal), stubHandlers(recorder));
    const result = await callTool(client, 'get_health', { harnessId: HARNESS });
    expect(result).toEqual({ isError: false, body: healthy });
    expect(recorder.seen).toHaveLength(1);
    expect(recorder.seen[0]).toBe(principal);
    await client.close();
  });

  it('refuses a principal without the verb role on the area not_permitted, before the handler runs', async () => {
    const recorder = newRecorder();
    const client = await connected(
      contextFor(agent([grant('viewer', '80-89')])),
      stubHandlers(recorder),
    );
    const result = await callTool(client, 'claim_item', { itemId: ITEM, delegationId: null });
    expect(result).toEqual({
      isError: true,
      body: { status: 'error', reason: 'not_permitted', detail: {} },
    });
    expect(recorder.ran).toEqual([]);
    await client.close();
  });

  it('answers a principal that cannot read the area with the handler hiding reason', async () => {
    const recorder = newRecorder();
    const client = await connected(
      contextFor(agent([grant('viewer', '20-29')])),
      stubHandlers(recorder),
    );
    const result = await callTool(client, 'claim_item', { itemId: ITEM, delegationId: null });
    expect(result.body).toMatchObject({ status: 'error', reason: 'item_not_found' });
    expect(recorder.ran).toEqual([]);
    await client.close();
  });
});

type Refusal = { readonly result: Awaited<ReturnType<typeof callTool>>; readonly lines: string[] };

async function refusalOf(name: string, args: Record<string, unknown>): Promise<Refusal> {
  const lines: string[] = [];
  const context = contextFor(agent([grant('editor', '80-89')]), lines);
  const client = await connected(context, stubHandlers(newRecorder()));
  const result = await callTool(client, name, args);
  await client.close();
  return { result, lines };
}

describe('every refusal is a closed-set reason', () => {
  it('answers a port that is not wired not_wired', async () => {
    const { result } = await refusalOf('poll_queue', { harnessId: null, limit: 5 });
    expect(result).toEqual({
      isError: true,
      body: { status: 'error', reason: 'not_wired', detail: {} },
    });
  });

  it('answers a served verb with no handler not_wired', async () => {
    const { result } = await refusalOf('read_page', { pageId: ITEM });
    expect(result.body).toMatchObject({ status: 'error', reason: 'not_wired' });
  });

  it('answers an unexpected throw internal_error without its text, and logs it', async () => {
    const { result, lines } = await refusalOf('search_pages', { query: 'x', type: null, limit: 5 });
    expect(result).toEqual({
      isError: true,
      body: { status: 'error', reason: 'internal_error', detail: {} },
    });
    expect(JSON.stringify(result.body)).not.toContain('boom');
    expect(lines.map((line) => JSON.parse(line) as Record<string, unknown>)).toContainEqual(
      expect.objectContaining({
        level: 'error',
        message: 'verb failed',
        verb: 'search_pages',
        error_message: 'boom',
      }),
    );
  });

  it('answers an output that breaks its schema internal_error', async () => {
    const { result } = await refusalOf('query_entities', { query: 'open_tasks', params: {} });
    expect(result.body).toMatchObject({ status: 'error', reason: 'internal_error' });
  });

  it('answers bad arguments malformed_command naming the fields, never the values', async () => {
    const { result } = await refusalOf('get_health', { harnessId: 'not-a-harness-value' });
    expect(result).toEqual({
      isError: true,
      body: { status: 'error', reason: 'malformed_command', detail: { fields: ['harnessId'] } },
    });
    expect(JSON.stringify(result.body)).not.toContain('not-a-harness-value');
  });
});
