import { principalSchema, type AssistantSettings } from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import type { AssistantSettingsRow, Ports } from '../ports.ts';
import { changedFields, customise } from './settings.ts';

const at = new Date('2026-10-01T09:00:00.000Z');
const personId = '00000000-0000-4000-8000-000000000105';
const harnessId = '00000000-0000-4000-8000-0000000000a1';
const traceId = '00000000-0000-4000-8000-0000000000e1';

const settings: AssistantSettings = {
  displayName: 'Ada',
  instructionsMd: 'Answer briefly.',
  timezone: 'Africa/Nairobi',
};

const before: AssistantSettingsRow = {
  harnessId,
  personId,
  ...settings,
  version: 1,
  updatedAt: at,
};

const person = principalSchema.parse({
  identity: `human:${personId}`,
  kind: 'person',
  personId,
  email: 'p@example.org',
  grants: [],
  interactive: true,
});

function untouched(): Pick<Ports, 'clock' | 'grants' | 'ids' | 'store'> {
  const refuse = (): never => {
    throw new Error('the store was reached');
  };
  return {
    clock: { now: () => new Date(at) },
    grants: { resolve: refuse, resolveIn: refuse, lockAndReread: refuse, holders: refuse },
    ids: { next: refuse },
    store: { transaction: refuse, appliedMigrations: refuse },
  };
}

describe('the customisation names only the fields it changes', () => {
  it('names every field for a first customisation', () => {
    expect(changedFields(null, settings)).toEqual(['display_name', 'instructions', 'timezone']);
  });

  it('names nothing when nothing changed, and one field when one changed', () => {
    expect(changedFields(before, settings)).toEqual([]);
    expect(changedFields(before, { ...settings, timezone: 'UTC' })).toEqual(['timezone']);
  });
});

describe('a malformed customisation is refused before reaching the store', () => {
  it('refuses an unknown timezone, an empty name, an overlong addendum and a bad version', async () => {
    const cases = [
      { settings: { ...settings, timezone: 'Mars/Olympus_Mons' }, expectedVersion: 0 },
      { settings: { ...settings, displayName: ' ' }, expectedVersion: 0 },
      { settings: { ...settings, instructionsMd: 'x'.repeat(8_001) }, expectedVersion: 0 },
      { settings, expectedVersion: -1 },
    ];
    for (const change of cases) {
      const outcome = await customise(
        untouched(),
        { actor: person, traceId },
        {
          harnessId,
          ...change,
        },
      );
      expect(outcome).toMatchObject({ status: 'error', reason: 'malformed_command' });
    }
  });

  it('reaches the store for a well-formed customisation', async () => {
    const input = { harnessId, settings, expectedVersion: 0 };
    await expect(customise(untouched(), { actor: person, traceId }, input)).rejects.toThrow(
      'the store was reached',
    );
  });
});
