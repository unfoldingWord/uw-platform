import { describe, expect, it } from 'vitest';
import { egress, MCP_HOST, MODEL_HOST, type EgressRoutes } from './egress.ts';

type Seen = { readonly url: string; readonly headers: Readonly<Record<string, string>> };

function routesWith(refused: string[], mcpSeen: Request[]): EgressRoutes {
  return {
    model: {
      host: MODEL_HOST,
      upstream: 'https://gateway.ai.cloudflare.com/v1/account-1/harness-gateway/anthropic',
      headers: { 'x-api-key': 'organization-key', 'cf-aig-authorization': 'Bearer gateway-token' },
    },
    mcp: async (request) => {
      mcpSeen.push(request);
      return Response.json({ jsonrpc: '2.0', id: 1, result: { tools: [] } });
    },
    refused: (host) => {
      refused.push(host);
    },
  };
}

function upstream(seen: Seen[]) {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    seen.push({ url: request.url, headers: Object.fromEntries(request.headers.entries()) });
    return Response.json({ ok: true });
  };
}

async function keyInjected(): Promise<void> {
  const seen: Seen[] = [];
  const request = new Request(`http://${MODEL_HOST}/v1/messages?beta=true`, {
    method: 'POST',
    headers: {
      'x-api-key': 'sandbox-placeholder',
      authorization: 'Bearer sandbox-token',
      'cf-aig-authorization': 'Bearer forged',
      cookie: 'session=1',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model: 'claude-sonnet-5' }),
  });
  const response = await egress(request, routesWith([], []), upstream(seen));
  expect(response.status).toBe(200);
  expect(seen).toEqual([
    {
      url: 'https://gateway.ai.cloudflare.com/v1/account-1/harness-gateway/anthropic/v1/messages?beta=true',
      headers: {
        'x-api-key': 'organization-key',
        'cf-aig-authorization': 'Bearer gateway-token',
        'content-type': 'application/json',
      },
    },
  ]);
}

async function mcpRouted(): Promise<void> {
  const seen: Seen[] = [];
  const mcpSeen: Request[] = [];
  const request = new Request(`http://${MCP_HOST}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-uw-principal': 'human:forged' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  const response = await egress(request, routesWith([], mcpSeen), upstream(seen));
  expect(await response.json()).toEqual({ jsonrpc: '2.0', id: 1, result: { tools: [] } });
  expect(mcpSeen).toHaveLength(1);
  expect(seen).toEqual([]);
}

async function othersRefused(): Promise<void> {
  const seen: Seen[] = [];
  const refused: string[] = [];
  const hosts = [
    'https://api.github.com/repos/unfoldingWord/uw-platform/pulls',
    'https://github.com/unfoldingWord/uw-platform.git/info/refs?token=secret',
    'https://api.anthropic.com/v1/messages',
    'http://169.254.169.254/latest/meta-data/',
    `http://${MODEL_HOST}.evil.example/v1/messages`,
  ];
  for (const url of hosts) {
    const response = await egress(new Request(url), routesWith(refused, []), upstream(seen));
    expect(response.status).toBe(403);
    expect(await response.text()).toBe('egress refused');
  }
  expect(seen).toEqual([]);
  expect(refused).toEqual([
    'api.github.com',
    'github.com',
    'api.anthropic.com',
    '169.254.169.254',
    `${MODEL_HOST}.evil.example`,
  ]);
}

describe('the sandbox egress proxy', () => {
  it(
    "HE-8 the organization key is injected at the egress proxy and the sandbox's own credentials are dropped",
    keyInjected,
  );

  it("HE-8 the MCP host reaches the step's in-process surface as the run's principal", mcpRouted);

  it('HE-8 every other host is refused, GitHub included', othersRefused);
});
