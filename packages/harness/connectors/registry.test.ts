import { describe, expect, it } from 'vitest';
import { connectorRegistered, connectorRegistry } from './registry.ts';

describe('KN-18 a connector is written only when its handler is registered', () => {
  it('registers merge and publish, not deploy, send or post, and none always', () => {
    expect([...connectorRegistry]).toEqual(['merge', 'publish']);
    expect(connectorRegistered('merge')).toBe(true);
    expect(connectorRegistered('publish')).toBe(true);
    expect(connectorRegistered('deploy')).toBe(false);
    expect(connectorRegistered('send')).toBe(false);
    expect(connectorRegistered('post')).toBe(false);
    expect(connectorRegistered('none')).toBe(true);
  });
});
