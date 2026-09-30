import { describe, expect, it } from 'vitest';
import { modules } from '@uw/core/modules';

describe('uw-app wiring', () => {
  it('resolves the module registry that declares the agents module it hosts', () => {
    expect(modules.find((declared) => declared.key === 'agents')?.depends_on).toEqual(['core']);
  });
});
