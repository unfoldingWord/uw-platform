import { describe, expect, it } from 'vitest';
import { privateAddress, webAddressRefusal, type WebAddressParts } from './web-address.ts';

function parts(overrides: Partial<WebAddressParts>): WebAddressParts {
  return {
    href: 'https://conference.example.org/agenda',
    protocol: 'https:',
    username: '',
    password: '',
    hostname: 'conference.example.org',
    port: '',
    ...overrides,
  };
}

describe('PA-19 the web address guard', () => {
  it('lets a public http or https address on the default ports through', () => {
    expect(webAddressRefusal(parts({}))).toBeNull();
    expect(webAddressRefusal(parts({ protocol: 'http:' }))).toBeNull();
    expect(webAddressRefusal(parts({ protocol: 'http:', port: '443' }))).toBeNull();
    expect(webAddressRefusal(parts({ hostname: '93.184.215.14' }))).toBeNull();
    expect(
      webAddressRefusal(parts({ hostname: '[2606:2800:21f:cb07:6820:80da:af6b:8b2c]' })),
    ).toBeNull();
  });

  it('refuses every scheme but http and https', () => {
    for (const protocol of ['file:', 'ftp:', 'gopher:', 'data:', 'javascript:']) {
      expect(webAddressRefusal(parts({ protocol }))).toBe('not_web');
    }
  });

  it('refuses credentials in the address', () => {
    expect(webAddressRefusal(parts({ username: 'admin' }))).toBe('credentials');
    expect(webAddressRefusal(parts({ password: 'secret' }))).toBe('credentials');
  });

  it('refuses every port but 80 and 443', () => {
    for (const port of ['8080', '22', '6379', '5432', '1']) {
      expect(webAddressRefusal(parts({ port }))).toBe('port');
    }
  });

  it('refuses an address longer than the bound', () => {
    expect(webAddressRefusal(parts({ href: `https://a.example/${'x'.repeat(2048)}` }))).toBe(
      'too_long',
    );
  });
});

describe('PA-19 the web address guard on hosts', () => {
  it('refuses loopback, private, link-local, metadata and reserved IPv4 hosts', () => {
    for (const hostname of [
      '127.0.0.1',
      '127.8.9.10',
      '0.0.0.0',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '198.18.0.1',
      '224.0.0.1',
      '255.255.255.255',
    ]) {
      expect(webAddressRefusal(parts({ hostname }))).toBe('private_address');
    }
    expect(webAddressRefusal(parts({ hostname: '172.32.0.1' }))).toBeNull();
  });

  it('refuses loopback, private, link-local and IPv4-carrying IPv6 hosts', () => {
    for (const hostname of [
      '[::1]',
      '[::]',
      '[fe80::1]',
      '[fc00::1]',
      '[fd12:3456::1]',
      '[::ffff:7f00:1]',
      '[64:ff9b::a9fe:a9fe]',
      '[2002:7f00:1::]',
      '[2001:db8::1]',
      '[ff02::1]',
    ]) {
      expect(webAddressRefusal(parts({ hostname }))).toBe('private_address');
    }
  });
});

describe('PA-19 the web address guard on names and resolved addresses', () => {
  it('refuses local names, single labels and metadata names', () => {
    for (const hostname of [
      'localhost',
      'api.localhost',
      'metadata.google.internal',
      'printer.local',
      'router.lan',
      'host.home.arpa',
      'intranet',
      'metadata',
      'localhost.',
    ]) {
      expect(webAddressRefusal(parts({ hostname }))).toBe('private_address');
    }
  });

  it('judges a resolved address the same way', () => {
    expect(privateAddress('10.0.0.8')).toBe(true);
    expect(privateAddress('fd00::8')).toBe(true);
    expect(privateAddress('93.184.215.14')).toBe(false);
    expect(privateAddress('2606:4700::6810:84e5')).toBe(false);
    expect(privateAddress('not an address')).toBe(true);
  });
});
