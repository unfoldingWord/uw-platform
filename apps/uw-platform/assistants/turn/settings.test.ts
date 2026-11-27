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
    expect(settings).toEqual({
      assistantsArea: '10-19',
      assistantSpendCapMinor: 20000,
      appOrigin: null,
    });
  });
});

describe('PA-12 the link a proposal note carries', () => {
  it('takes the https app origin without a trailing slash, and nothing else', () => {
    expect(assistantKernelSettings({ APP_ORIGIN: 'https://uw.example.org/' }).appOrigin).toBe(
      'https://uw.example.org',
    );
    for (const value of ['http://uw.example.org', 'https://uw.example.org/path', 'javascript:x']) {
      expect(assistantKernelSettings({ APP_ORIGIN: value }).appOrigin).toBeNull();
    }
  });
});
