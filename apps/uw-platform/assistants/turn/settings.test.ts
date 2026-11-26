import { describe, expect, it } from 'vitest';
import { assistantKernelSettings } from './settings.ts';

describe('PA-16 the optional assistants spend ceiling', () => {
  it('is unset by default and when the value is not a positive whole number', () => {
    expect(assistantKernelSettings({}).assistantSpendCapMinor).toBeNull();
    for (const value of ['', '0', '-5', '12.5', 'ten']) {
      expect(
        assistantKernelSettings({ ASSISTANT_SPEND_CAP_MINOR: value }).assistantSpendCapMinor,
      ).toBeNull();
    }
  });

  it('caps the pool at the configured minor units', () => {
    const settings = assistantKernelSettings({ ASSISTANT_SPEND_CAP_MINOR: '20000' });
    expect(settings).toEqual({ assistantsArea: null, assistantSpendCapMinor: 20000 });
  });
});
