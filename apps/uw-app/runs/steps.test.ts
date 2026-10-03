import { describe, expect, it } from 'vitest';
import type { VerbName } from '@uw/contracts';
import { MAX_BODY_BYTES } from '../http/body.ts';
import { countedHttp } from './steps.ts';

const served: ReadonlySet<VerbName> = new Set<VerbName>(['read_page', 'write_page']);

function call(name: string, padding = ''): Request {
  return new Request('http://mcp.internal/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: { padding } },
    }),
  });
}

function answering(isError: (name: string) => boolean) {
  const seen: string[] = [];
  const serve = async (request: Request): Promise<Response> => {
    const text = await request.text();
    const name = /"name":"([a-z_]+)"/.exec(text)?.[1] ?? '';
    seen.push(name);
    if (name === 'claim_item') {
      return Response.json({ jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'unknown' } });
    }
    const result = { content: [{ type: 'text', text: '{}' }], isError: isError(name) };
    return Response.json({ jsonrpc: '2.0', id: 1, result });
  };
  return { seen, serve };
}

async function servedOnly(): Promise<void> {
  const server = answering(() => false);
  const http = countedHttp(server.serve, served);
  for (const name of ['read_page', 'claim_item', 'write_page', 'read_page']) {
    await http.handle(call(name));
  }
  expect(server.seen).toEqual(['read_page', 'claim_item', 'write_page', 'read_page']);
  expect(http.called()).toEqual(['read_page', 'write_page']);
  expect(http.writes()).toBe(1);
}

async function refusedWritesUncounted(): Promise<void> {
  const server = answering((name) => name === 'write_page');
  const http = countedHttp(server.serve, served);
  await http.handle(call('write_page'));
  await http.handle(call('write_page'));
  expect(http.called()).toEqual(['write_page']);
  expect(http.writes()).toBe(0);
}

async function oversizedUncounted(): Promise<void> {
  const server = answering(() => false);
  const http = countedHttp(server.serve, served);
  const response = await http.handle(call('write_page', 'x'.repeat(MAX_BODY_BYTES)));
  expect(response.status).toBe(200);
  expect(server.seen).toEqual(['write_page']);
  expect(http.called()).toEqual([]);
  expect(http.writes()).toBe(0);
}

describe("a sandbox step's HTTP call counter", () => {
  it('records only the verbs the step serves', servedOnly);

  it('counts a write only when the call succeeded', refusedWritesUncounted);

  it('reads at most the body limit before it counts a call', oversizedUncounted);
});
