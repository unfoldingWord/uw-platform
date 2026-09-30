import { describe, expect, it } from 'vitest';
import { modules } from '@uw/core/modules';

describe('@uw/db wiring', () => {
  it('resolves the module registry its tables will be declared against', () => {
    expect(modules.map((declared) => declared.key)).toContain('core');
  });
});
