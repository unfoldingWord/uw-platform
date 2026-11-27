import { describe, expect, it } from 'vitest';
import { commandBody } from './command-body.ts';

const requestId = 'c8100000-0000-4000-8000-000000000001';
const effectId = 'c8100000-0000-4000-8000-000000000002';
const personId = 'c8100000-0000-4000-8000-000000000003';

describe('PA-7 the My Assistant forms build their command bodies', () => {
  it('turns on with the typed name, lowercased and trimmed', () => {
    expect(commandBody('enable_assistant', { name: ' Barnabas ' }, requestId)).toEqual({
      command: 'enable_assistant',
      requestId,
      name: 'barnabas',
    });
  });

  it('grants and renews to the end of the chosen day, or the default with no day', () => {
    expect(commandBody('grant_assist', { expiresOn: '2027-02-01' }, requestId)).toEqual({
      command: 'grant_assist',
      requestId,
      expiresAt: '2027-02-01T23:59:59.000Z',
    });
    expect(commandBody('renew_assist', { expiresOn: '' }, requestId)).toEqual({
      command: 'renew_assist',
      requestId,
      expiresAt: null,
    });
  });

  it('customises the three settings at the version the page showed', () => {
    const fields = {
      displayName: 'Barnabas',
      timezone: 'Africa/Nairobi',
      instructionsMd: 'Short answers.',
      expectedVersion: '2',
    };
    expect(commandBody('customise_assistant', fields, requestId)).toEqual({
      command: 'customise_assistant',
      requestId,
      displayName: 'Barnabas',
      timezone: 'Africa/Nairobi',
      instructionsMd: 'Short answers.',
      expectedVersion: 2,
    });
  });
});

describe('PA-7 the My Assistant undo and budget forms build their command bodies', () => {
  it('undoes one effect and carries nothing else for the plain commands', () => {
    expect(commandBody('undo_assistant_effect', { effectId }, requestId)).toEqual({
      command: 'undo_assistant_effect',
      requestId,
      effectId,
    });
    for (const command of ['revoke_assist', 'disable_assistant', 'delete_my_assistant_history']) {
      expect(commandBody(command, {}, requestId)).toEqual({ command, requestId });
    }
  });

  it('sets a budget in dollars as minor units, and blank as the default', () => {
    expect(
      commandBody('set_assistant_budget', { personId, monthlyDollars: '35.50' }, requestId),
    ).toEqual({ command: 'set_assistant_budget', requestId, personId, monthlyMinor: 3550 });
    expect(
      commandBody('set_assistant_budget', { personId, monthlyDollars: '' }, requestId),
    ).toEqual({ command: 'set_assistant_budget', requestId, personId, monthlyMinor: null });
    expect(
      commandBody('set_assistant_budget', { personId, monthlyDollars: 'lots' }, requestId),
    ).toBe(null);
  });

  it('decides one proposal on the digest the page showed', () => {
    const fields = { proposalId: effectId, decision: 'accept', digest: 'a'.repeat(64) };
    expect(commandBody('decide_assistant_proposal', fields, requestId)).toEqual({
      command: 'decide_assistant_proposal',
      requestId,
      proposalId: effectId,
      decision: 'accept',
      digest: 'a'.repeat(64),
    });
    expect(
      commandBody('decide_assistant_proposal', { ...fields, digest: 'short' }, requestId),
    ).toBeNull();
  });
});
