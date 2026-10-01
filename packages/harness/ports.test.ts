import { describe, expect, it } from 'vitest';
import { portNames } from './index.ts';

describe('DX-1 the ports are the ten PRD section 9 names', () => {
  it('lists them in order', () => {
    expect(portNames).toEqual([
      'clock',
      'ids',
      'store',
      'grants',
      'githubFacts',
      'connectors',
      'modelEngine',
      'hub',
      'notifier',
      'runs',
    ]);
  });
});
