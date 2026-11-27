import { describe, expect, it } from 'vitest';
import { siteOrigins } from './measure-hosts.ts';

describe('the origins one resource may reach', () => {
  it('is the origin and its www sibling, in the same scheme and port', () => {
    expect(siteOrigins('https://www.example.org')).toEqual([
      'https://www.example.org',
      'https://example.org',
    ]);
    expect(siteOrigins('https://example.org')).toEqual([
      'https://example.org',
      'https://www.example.org',
    ]);
    expect(siteOrigins('http://example.org:8080')).toEqual([
      'http://example.org:8080',
      'http://www.example.org:8080',
    ]);
  });

  it('adds no sibling to an address, a bare name or a www with nothing after it', () => {
    expect(siteOrigins('https://93.184.215.14')).toEqual(['https://93.184.215.14']);
    expect(siteOrigins('https://[2606:2800:220:1::1]')).toEqual(['https://[2606:2800:220:1::1]']);
    expect(siteOrigins('http://localhost')).toEqual(['http://localhost']);
    expect(siteOrigins('https://www.org')).toEqual(['https://www.org']);
    expect(siteOrigins('not an origin')).toEqual(['not an origin']);
  });
});
