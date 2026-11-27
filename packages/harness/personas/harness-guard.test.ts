import { assistantIdentityOf, identitySchema } from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import { personaHarnessRefusal } from './harness-guard.ts';

const person = '00000000-0000-4000-8000-000000000105';
const other = '00000000-0000-4000-8000-000000000106';
const personal = { personId: person };
const workflow = { personId: null };
const refusal = {
  status: 'error',
  reason: 'not_permitted',
  detail: { why: 'persona_not_for_harness' },
};

function identity(text: string): ReturnType<typeof identitySchema.parse> {
  return identitySchema.parse(text);
}

describe('PA-1 a personal harness holds only its own person assistant', () => {
  it('lets the person assistant onto their own harness', () => {
    expect(personaHarnessRefusal(identity(assistantIdentityOf(person)), personal)).toBeNull();
  });

  it('refuses another person assistant on the harness', () => {
    expect(personaHarnessRefusal(identity(assistantIdentityOf(other)), personal)).toEqual(refusal);
  });

  it('refuses a workflow persona on a personal harness', () => {
    expect(personaHarnessRefusal(identity('agent:builder'), personal)).toEqual(refusal);
  });

  it('refuses an assistant on a workflow harness and keeps workflow personas there', () => {
    expect(personaHarnessRefusal(identity(assistantIdentityOf(person)), workflow)).toEqual(refusal);
    expect(personaHarnessRefusal(identity('agent:builder'), workflow)).toBeNull();
  });
});
