import { describe, expect, it } from 'vitest';
import { dohResolver, isPublicAddress, publicHost } from './measure-address.ts';

describe('a measure reaches only public addresses', () => {
  it.each([
    '0.0.0.0',
    '10.1.2.3',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.255',
    '192.0.0.8',
    '192.168.1.1',
    '198.18.0.1',
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    '::ffff:127.0.0.1',
    '::ffff:a00:1',
    '64:ff9b::a00:1',
    '::7f00:1',
    '::a00:1',
    '64:ff9b:1::a00:1',
    'fc00::1',
    'fd00:ec2::254',
    'fe80::1',
    'ff02::1',
    '2001:db8::1',
    '[::1]',
    'not an address',
    '1.2.3',
    '1.2.3.256',
  ])('refuses %s', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(['1.1.1.1', '93.184.215.14', '172.32.0.1', '2606:4700::6810:84e5', '[2606:4700::1]'])(
    'admits %s',
    (address) => {
      expect(isPublicAddress(address)).toBe(true);
    },
  );
});

describe('a measure reaches a name only when it resolves to public addresses', () => {
  it('admits a name only when every address it resolves to is public', async () => {
    const answers: Record<string, readonly string[] | null> = {
      'example.org': ['93.184.215.14', '2606:4700::1'],
      'mixed.example': ['93.184.215.14', '10.0.0.1'],
      'gone.example': null,
      'empty.example': [],
    };
    const resolve = async (name: string) => answers[name] ?? null;
    expect(await publicHost('example.org', resolve)).toBe(true);
    expect(await publicHost('mixed.example', resolve)).toBe(false);
    expect(await publicHost('gone.example', resolve)).toBe(false);
    expect(await publicHost('empty.example', resolve)).toBe(false);
    expect(await publicHost('localhost', resolve)).toBe(false);
    expect(await publicHost('box.localhost', resolve)).toBe(false);
    expect(await publicHost('mcp.internal', resolve)).toBe(false);
    expect(await publicHost('127.0.0.1', resolve)).toBe(false);
    expect(await publicHost('[2606:4700::1]', resolve)).toBe(true);
  });
});

describe('the DNS-over-HTTPS resolver', () => {
  function dns(replies: Record<string, unknown>, seen: string[]) {
    return async (request: Request) => {
      seen.push(`${request.url} ${request.headers.get('accept') ?? ''}`);
      const type = new URL(request.url).searchParams.get('type') ?? '';
      const reply = replies[type];
      return reply === undefined ? new Response('', { status: 500 }) : Response.json(reply);
    };
  }

  it('asks for A and AAAA records and keeps only addresses', async () => {
    const seen: string[] = [];
    const resolve = dohResolver(
      dns(
        {
          A: {
            Status: 0,
            Answer: [
              { type: 5, data: 'cdn.example.net.' },
              { type: 1, data: '93.184.215.14' },
            ],
          },
          AAAA: { Status: 0, Answer: [{ type: 28, data: '2606:4700::1' }] },
        },
        seen,
      ),
    );
    expect(await resolve('example.org')).toEqual(['93.184.215.14', '2606:4700::1']);
    expect(seen).toEqual([
      'https://cloudflare-dns.com/dns-query?name=example.org&type=A application/dns-json',
      'https://cloudflare-dns.com/dns-query?name=example.org&type=AAAA application/dns-json',
    ]);
  });

  it('answers null for a name that does not resolve or a reply out of shape', async () => {
    const missing = dohResolver(dns({ A: { Status: 3 }, AAAA: { Status: 3 } }, []));
    expect(await missing('gone.example')).toBeNull();
    const broken = dohResolver(dns({ A: { Answer: 'x' } }, []));
    expect(await broken('example.org')).toBeNull();
    const ipv6Only = dohResolver(
      dns({ A: { Status: 0 }, AAAA: { Status: 0, Answer: [{ type: 28, data: '::1' }] } }, []),
    );
    expect(await ipv6Only('six.example')).toEqual(['::1']);
  });
});
