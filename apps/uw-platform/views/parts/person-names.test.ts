import { describe, expect, it } from 'vitest';
import { shownAuthor } from './person-names.ts';

describe('shownAuthor names who suggested a change without showing a raw identity', () => {
  it('shows an agent as an agent when its person cannot be looked up', async () => {
    const shown = await shownAuthor(null, 'agent:00000000-0000-4000-8000-000000000a01/laptop');
    expect(shown).toEqual({ kind: 'text', text: 'An agent' });
  });

  it('keeps an identity it cannot parse as written', async () => {
    expect(await shownAuthor(null, 'platform')).toEqual({ kind: 'text', text: 'platform' });
  });
});
