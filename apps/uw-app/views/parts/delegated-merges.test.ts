import { harnessSchema } from '@uw/contracts';
import type { DelegatedMergeRow } from '@uw/harness';
import { describe, expect, it } from 'vitest';
import { mergedCapNote } from './caps.ts';
import { DelegatedMerges } from './delegated-merges.tsx';

const harness = harnessSchema.parse({
  id: '00000000-0000-4000-8000-0000000000a1',
  key: 'board',
  template: 'software',
  jdArea: '80-89',
  repository: 'unfoldingWord/uw-platform',
  hostedBuilderEnabled: false,
  paused: false,
});

const row: DelegatedMergeRow = {
  harness,
  itemId: '00000000-0000-4000-8000-0000000000b1',
  title: 'Show the board',
  email: 'ian.lindsley@unfoldingword.org',
  expiresAt: new Date('2026-10-20T00:00:00.000Z'),
  at: new Date('2026-10-15T09:00:00.000Z'),
};

describe('MD-6 the delegated merges list says when it is capped', () => {
  it('MD-6 adds the at-least note only when the view read its limit', () => {
    expect(String(DelegatedMerges({ merged: { rows: [row], capped: true } }))).toContain(
      mergedCapNote,
    );
    expect(String(DelegatedMerges({ merged: { rows: [row], capped: false } }))).not.toContain(
      'At least',
    );
  });
});
