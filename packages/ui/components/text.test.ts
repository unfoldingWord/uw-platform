import { describe, expect, it } from 'vitest';
import { domId, reasonText } from './text.ts';

describe('ids and reasons for the pieces', () => {
  it('an id names each distinct key once, whatever its letters', () => {
    const ids = [
      domId('lane', 'build'),
      domId('lane', 'Build'),
      domId('lane', 'build!'),
      domId('lane', 'Строить'),
      domId('lane', 'Проверка'),
      domId('lane-build'),
      domId('a-b', 'c'),
      domId('a', 'b-c'),
      domId('a_2d_b', 'c'),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('a closed reason reads as a sentence, and other text passes through', () => {
    expect(reasonText('checks_not_green')).toBe('Checks not green');
    expect(reasonText('You cannot approve your own work')).toBe('You cannot approve your own work');
  });
});
