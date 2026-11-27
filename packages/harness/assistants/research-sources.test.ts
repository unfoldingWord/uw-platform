import { describe, expect, it } from 'vitest';
import { webAddressOf, writtenAddresses } from './research-sources.ts';

describe('PA-19 an offered address is compared in one form', () => {
  it('lowers the scheme and host and gives a bare host its path, keeping the rest', () => {
    expect(webAddressOf(' HTTPS://BTC2027.Example.org ')).toBe('https://btc2027.example.org/');
    expect(webAddressOf('https://btc2027.example.org?Tickets=1')).toBe(
      'https://btc2027.example.org/?Tickets=1',
    );
    expect(webAddressOf('https://btc2027.example.org/Agenda#Day1')).toBe(
      'https://btc2027.example.org/Agenda#Day1',
    );
    expect(webAddressOf('ftp://btc2027.example.org/')).toBeNull();
    expect(webAddressOf('see https://btc2027.example.org/')).toBeNull();
  });

  it('finds the addresses a person wrote, without the punctuation around them', () => {
    const note = 'Read https://a.example.org/agenda, then (https://b.example.org/tickets). Thanks!';
    expect(writtenAddresses(note)).toEqual([
      'https://a.example.org/agenda',
      'https://b.example.org/tickets',
    ]);
    expect(writtenAddresses('No address here, only example.org')).toEqual([]);
  });
});
