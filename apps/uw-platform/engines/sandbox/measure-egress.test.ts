import { describe, expect, it } from 'vitest';
import { measureEgress, type MeasurePhase } from './measure-egress.ts';

type Rig = {
  readonly refused: string[];
  readonly sent: Request[];
  readonly route: Parameters<typeof measureEgress>[1];
  readonly fetcher: (request: Request) => Promise<Response>;
};

function rig(phase: MeasurePhase, addresses: readonly string[] = ['93.184.215.14']): Rig {
  const refused: string[] = [];
  const sent: Request[] = [];
  return {
    refused,
    sent,
    route: {
      phase: () => phase,
      resolve: async () => addresses,
      refused: (host) => void refused.push(host),
    },
    fetcher: async (request) => {
      sent.push(request);
      return new Response('upstream', { status: 302, headers: { location: 'https://x.test/' } });
    },
  };
}

const site: MeasurePhase = { kind: 'measure', origin: 'https://www.example.org' };

async function statusOf(one: Rig, request: Request): Promise<number> {
  return (await measureEgress(request, one.route, one.fetcher)).status;
}

describe('the measure egress while the package installs', () => {
  it('forwards reads of the Python package index with only harmless headers', async () => {
    const one = rig({ kind: 'install' });
    const simple = new Request('https://pypi.org/simple/geo-optimizer-skill/', {
      headers: { accept: 'application/vnd.pypi.simple.v1+json', authorization: 'Basic x' },
    });
    const wheel = new Request('https://files.pythonhosted.org/packages/ab/cd/tool.whl', {
      method: 'HEAD',
      headers: { cookie: 'a=1', 'user-agent': 'uv/0.9.5' },
    });
    expect(await statusOf(one, simple)).toBe(302);
    expect(await statusOf(one, wheel)).toBe(302);
    expect(one.sent.map((request) => `${request.method} ${request.url}`)).toEqual([
      'GET https://pypi.org/simple/geo-optimizer-skill/',
      'HEAD https://files.pythonhosted.org/packages/ab/cd/tool.whl',
    ]);
    expect(one.sent.map((request) => request.redirect)).toEqual(['manual', 'manual']);
    expect(one.sent[0]?.headers.get('authorization')).toBeNull();
    expect(one.sent[1]?.headers.get('cookie')).toBeNull();
    expect(one.sent[1]?.headers.get('user-agent')).toBe('uv/0.9.5');
    expect(one.refused).toEqual([]);
  });

  it('refuses the resource, a write, plain HTTP and any other path or host', async () => {
    const one = rig({ kind: 'install' });
    const tries = [
      new Request('https://www.example.org/'),
      new Request('https://pypi.org/simple/x/', { method: 'POST', body: '{}' }),
      new Request('http://pypi.org/simple/x/'),
      new Request('https://pypi.org/account/login/'),
      new Request('https://pypi.org:8443/simple/x/'),
      new Request('https://upload.pypi.org/legacy/'),
      new Request('http://mcp.internal/mcp'),
    ];
    for (const request of tries) expect(await statusOf(one, request)).toBe(403);
    expect(one.sent).toEqual([]);
    expect(one.refused).toEqual([
      'www.example.org',
      'pypi.org',
      'pypi.org',
      'pypi.org',
      'pypi.org:8443',
      'upload.pypi.org',
      'mcp.internal',
    ]);
  });
});

describe('the measure egress while the tool measures one resource', () => {
  it("forwards reads of the resource's own origin, keeping the redirect for the tool", async () => {
    const one = rig(site);
    const page = new Request('https://www.example.org/robots.txt?x=1', {
      headers: {
        accept: 'text/plain',
        authorization: 'Bearer x',
        cookie: 'a=1',
        range: 'bytes=0-9',
      },
    });
    const response = await measureEgress(page, one.route, one.fetcher);
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://x.test/');
    expect(one.sent.map((request) => request.url)).toEqual([
      'https://www.example.org/robots.txt?x=1',
    ]);
    expect(one.sent[0]?.redirect).toBe('manual');
    expect(one.sent[0]?.headers.get('authorization')).toBeNull();
    expect(one.sent[0]?.headers.get('cookie')).toBeNull();
    expect(one.sent[0]?.headers.get('range')).toBe('bytes=0-9');
  });

  it('refuses another host, another scheme or port, a write and the package index', async () => {
    const one = rig(site);
    const tries = [
      new Request('https://cdn.example.org/'),
      new Request('http://www.example.org/'),
      new Request('https://www.example.org:8443/'),
      new Request('https://www.example.org/form', { method: 'POST', body: 'x' }),
      new Request('https://pypi.org/simple/x/'),
      new Request('http://model.internal/v1/messages'),
    ];
    for (const request of tries) expect(await statusOf(one, request)).toBe(403);
    expect(one.sent).toEqual([]);
    expect(one.refused).toEqual([
      'cdn.example.org',
      'www.example.org',
      'www.example.org:8443',
      'www.example.org',
      'pypi.org',
      'model.internal',
    ]);
  });
});

describe("the measure egress reaches the www. sibling of the resource's origin", () => {
  it('forwards reads of the apex sibling of a www origin, and the www sibling of an apex', async () => {
    const one = rig(site);
    expect(await statusOf(one, new Request('https://example.org/'))).toBe(302);
    const apex = rig({ kind: 'measure', origin: 'https://example.org' });
    expect(await statusOf(apex, new Request('https://www.example.org/llms.txt'))).toBe(302);
    expect([...one.refused, ...apex.refused]).toEqual([]);
  });

  it('refuses a look-alike host, a second www., and the sibling in another scheme or port', async () => {
    const apex = rig({ kind: 'measure', origin: 'https://example.org' });
    const tries = [
      new Request('https://evil-www.example.org/'),
      new Request('https://wwwexample.org/'),
      new Request('https://www.www.example.org/'),
      new Request('https://www.example.org.evil.test/'),
      new Request('http://www.example.org/'),
      new Request('https://www.example.org:8443/'),
    ];
    for (const request of tries) expect(await statusOf(apex, request)).toBe(403);
    const www = rig(site);
    for (const request of [
      new Request('https://www.www.example.org/'),
      new Request('http://example.org/'),
      new Request('https://example.org:8443/'),
      new Request('https://org/'),
    ]) {
      expect(await statusOf(www, request)).toBe(403);
    }
    expect([...apex.sent, ...www.sent]).toEqual([]);
  });
});

describe('the measure egress refuses private and closed routes', () => {
  it('refuses the origin when its name resolves to a private address', async () => {
    const one = rig(site, ['93.184.215.14', '169.254.169.254']);
    expect(await statusOf(one, new Request('https://www.example.org/'))).toBe(403);
    const local = rig({ kind: 'measure', origin: 'http://127.0.0.1:8080' });
    expect(await statusOf(local, new Request('http://127.0.0.1:8080/'))).toBe(403);
    expect([...one.sent, ...local.sent]).toEqual([]);
    expect([...one.refused, ...local.refused]).toEqual(['www.example.org', '127.0.0.1:8080']);
  });

  it('refuses everything once the sandbox is closed', async () => {
    const one = rig({ kind: 'closed' });
    expect(await statusOf(one, new Request('https://www.example.org/'))).toBe(403);
    expect(await statusOf(one, new Request('https://pypi.org/simple/x/'))).toBe(403);
    expect(one.sent).toEqual([]);
    expect(one.refused).toEqual(['www.example.org', 'pypi.org']);
  });
});
