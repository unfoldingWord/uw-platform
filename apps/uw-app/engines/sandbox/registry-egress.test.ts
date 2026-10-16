import { describe, expect, it } from 'vitest';
import { registryEgress, REGISTRY_HOST } from './registry-egress.ts';

function rig(open: boolean) {
  const refused: string[] = [];
  const sent: Request[] = [];
  const route = {
    registry: { open: () => open },
    refused: (host: string, path: string) => void refused.push(`${host}${path}`),
  };
  const fetcher = async (request: Request) => {
    sent.push(request);
    return new Response('{}', { status: 200 });
  };
  return { route, fetcher, refused, sent };
}

describe('FL-4 the package registry is reachable only while the declared checks run', () => {
  it('FL-4 forwards a GET to the npm registry with only accept and user-agent while open', async () => {
    const { route, fetcher, sent } = rig(true);
    const request = new Request(`http://${REGISTRY_HOST}/react?x=1`, {
      headers: { accept: 'application/json', authorization: 'Bearer leak', 'user-agent': 'npm' },
    });
    expect((await registryEgress(request, route, fetcher))?.status).toBe(200);
    expect(sent.map((one) => one.url)).toEqual(['https://registry.npmjs.org/react?x=1']);
    expect(sent[0]?.headers.get('authorization')).toBeNull();
  });

  it('FL-4 refuses while closed, and refuses any write while open', async () => {
    const closed = rig(false);
    const read = new Request(`http://${REGISTRY_HOST}/react`);
    expect((await registryEgress(read, closed.route, closed.fetcher))?.status).toBe(403);
    const open = rig(true);
    const put = new Request(`http://${REGISTRY_HOST}/react`, { method: 'PUT', body: '{}' });
    expect((await registryEgress(put, open.route, open.fetcher))?.status).toBe(403);
    expect([...closed.sent, ...open.sent]).toEqual([]);
    expect(closed.refused).toEqual([`${REGISTRY_HOST}/react`]);
    const elsewhere = new Request('http://example.com/');
    expect(await registryEgress(elsewhere, open.route, open.fetcher)).toBeNull();
  });
});
