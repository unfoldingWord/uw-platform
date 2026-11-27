import { assistantDirectEffectSchema } from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import { classifyEffect } from './classify.ts';

describe('PA-4 only the closed low-risk set takes effect without a person', () => {
  it.each(assistantDirectEffectSchema.options)('classifies %s as direct', (kind) => {
    expect(classifyEffect(kind)).toBe('direct');
  });

  it.each(['email_to_others', 'calendar_invite', 'page_append', 'payment', ''])(
    'classifies %j as a proposal',
    (kind) => {
      expect(classifyEffect(kind)).toBe('proposal');
    },
  );
});
