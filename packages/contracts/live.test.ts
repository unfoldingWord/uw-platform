import { describe, expect, it } from 'vitest';
import { hubWakeSchema } from './live.ts';

const harnessId = '00000000-0000-4000-8000-0000000000cc';

describe('WB-3 the wake carries nothing but the news', () => {
  it('has exactly the fields type and harnessId', () => {
    expect(Object.keys(hubWakeSchema.shape).sort()).toEqual(['harnessId', 'type']);
  });

  it('refuses a wake that carries an event, an item, a body or a position', () => {
    for (const extra of [{ event: {} }, { itemId: harnessId }, { body: 'x' }, { position: 3 }]) {
      expect(hubWakeSchema.safeParse({ type: 'wake', harnessId, ...extra }).success).toBe(false);
    }
  });
});
