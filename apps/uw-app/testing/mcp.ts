import type { Hono } from 'hono';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/cfworker';
import {
  CONTRACT_VERSION,
  principalSchema,
  type Grant,
  type Principal,
  type Role,
} from '@uw/contracts';
import { createLogger } from '@uw/core/log';
import { createClient } from '@uw/db/client';
import type { AppEnv } from '../deps.ts';
import { platformKernel } from '../kernel.ts';
import type { VerbContext } from '../mcp/context.ts';
import { fixtureAccessEnv } from './access-keys.ts';

type Transport = Parameters<Client['connect']>[0];

function relay(inner: StreamableHTTPClientTransport): Transport {
  const relayed: Transport = {
    start: async () => {
      inner.onmessage = (message) => relayed.onmessage?.(message);
      inner.onerror = (error) => relayed.onerror?.(error);
      inner.onclose = () => relayed.onclose?.();
      await inner.start();
    },
    send: (message, options) => inner.send(message, options),
    close: () => inner.close(),
    setProtocolVersion: (version) => inner.setProtocolVersion(version),
  };
  return relayed;
}

export async function httpClient(
  app: Hono<AppEnv>,
  headers: Record<string, string>,
): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL('http://uw.test/mcp'), {
    fetch: async (url, init) => app.request(url, init, fixtureAccessEnv),
    requestInit: { headers },
  });
  const client = new Client(
    { name: 'uw-test-runner', version: CONTRACT_VERSION },
    { jsonSchemaValidator: new CfWorkerJsonSchemaValidator() },
  );
  await client.connect(relay(transport));
  return client;
}

export async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<{ readonly isError: boolean; readonly body: Record<string, unknown> }> {
  const result = CallToolResultSchema.parse(await client.callTool({ name, arguments: args }));
  const text = result.content.find((block) => block.type === 'text');
  const body: unknown = JSON.parse(text?.type === 'text' ? text.text : '{}');
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Error(`tool ${name} answered a body that is not an object`);
  }
  return { isError: result.isError === true, body: Object.fromEntries(Object.entries(body)) };
}

const TEST_OWNER = '00000000-0000-4000-8000-000000000301';

export function areaGrant(role: Role, area: string, expiresAt: string | null = null): Grant {
  return {
    grantId: '00000000-0000-4000-8000-000000000304',
    role,
    scopeKind: 'jd_area',
    scopeArea: area,
    expiresAt,
  };
}

export function testAgent(grants: readonly Grant[]): Principal {
  return principalSchema.parse({
    identity: `agent:${TEST_OWNER}/laptop`,
    kind: 'agent',
    personId: TEST_OWNER,
    email: null,
    grants,
    interactive: true,
  });
}

export function testContext(principal: Principal, lines: string[] = []): VerbContext {
  return {
    principal,
    host: 'external',
    at: new Date('2026-10-02T12:00:00.000Z'),
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
