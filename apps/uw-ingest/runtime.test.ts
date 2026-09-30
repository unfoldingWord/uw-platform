import { describe, expect, it } from 'vitest';

describe('worker runtime', () => {
  it('runs under the Workers pool', () => {
    expect(navigator.userAgent).toBe('Cloudflare-Workers');
  });
});
