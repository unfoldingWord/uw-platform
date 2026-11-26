import {
  ingestIdentity,
  principalSchema,
  type AssistantRequestInput,
  type Principal,
} from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import type { Ports } from '../ports.ts';
import { recordRequest } from './requests.ts';

const at = new Date('2026-10-01T09:00:00.000Z');
const input: AssistantRequestInput = {
  personId: '00000000-0000-4000-8000-000000000105',
  channel: 'zulip_dm',
  externalId: '101',
  threadKey: 'dm',
  replyAddress: 'zulip:5005',
  receivedAt: at.toISOString(),
  note: "What's on my schedule today?",
  untrustedParts: [],
};

function platform(identity: string): Principal {
  return principalSchema.parse({
    identity,
    kind: 'agent',
    personId: null,
    email: null,
    grants: [],
    interactive: false,
  });
}

function untouched(): Pick<Ports, 'clock' | 'ids' | 'store'> {
  const refuse = (): never => {
    throw new Error('the store was reached');
  };
  return {
    clock: { now: () => new Date(at) },
    ids: { next: refuse },
    store: { transaction: refuse, appliedMigrations: refuse },
  };
}

const traceId = '00000000-0000-4000-8000-0000000000e1';

describe('PA-2 only the platform records a request, and only a well-formed one', () => {
  it('refuses a person or an agent before reaching the store', async () => {
    const person = principalSchema.parse({
      identity: `human:${input.personId}`,
      kind: 'person',
      personId: input.personId,
      email: 'p@example.org',
      grants: [],
      interactive: true,
    });
    for (const actor of [person, platform('agent:builder')]) {
      const outcome = await recordRequest(untouched(), { actor, traceId }, input);
      expect(outcome).toMatchObject({ status: 'error', reason: 'not_permitted' });
    }
  });

  it('refuses a malformed request before reaching the store', async () => {
    const caller = { actor: platform(ingestIdentity), traceId };
    const long = {
      ...input,
      untrustedParts: Array.from({ length: 21 }, () => ({
        source: 'chat_quote' as const,
        text: 'x',
      })),
    };
    for (const bad of [{ ...input, personId: 'p' }, { ...input, externalId: '' }, long]) {
      const outcome = await recordRequest(untouched(), caller, bad);
      expect(outcome).toMatchObject({ status: 'error', reason: 'malformed_command' });
    }
  });

  it('lets the ingest principal through to the store', async () => {
    const caller = { actor: platform(ingestIdentity), traceId };
    await expect(recordRequest(untouched(), caller, input)).rejects.toThrow(
      'the store was reached',
    );
  });
});
