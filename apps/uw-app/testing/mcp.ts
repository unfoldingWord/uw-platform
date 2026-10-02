import type { Hono } from 'hono';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/cfworker';
import { CONTRACT_VERSION } from '@uw/contracts';
import type { AppEnv } from '../deps.ts';
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
