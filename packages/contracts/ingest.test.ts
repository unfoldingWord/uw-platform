import { describe, expect, it } from 'vitest';
import {
  INGEST_PAYLOAD_LIMIT_BYTES,
  ingestEnvelopeSchema,
  ingestRefusalSchema,
  ingestResponseSchema,
  ingestSourceSchema,
} from './ingest.ts';

const envelope = {
  envelopeVersion: 1,
  traceId: '3f1d7c1e-8c53-4a53-9d6e-0a9b6a0f4d11',
  source: 'github',
  deliveryId: 'd-1',
  event: 'push',
  receivedAt: '2026-10-01T12:00:00.000Z',
  principal: {
    identity: 'agent:ingest',
    kind: 'agent',
    personId: null,
    email: null,
    grants: [],
    interactive: false,
  },
  payload: { ref: 'refs/heads/main' },
  payloadTruncated: false,
};

describe('FD-10 the ingest envelope', () => {
  it('carries a payload, or null when the payload was truncated', () => {
    expect(ingestEnvelopeSchema.safeParse(envelope).success).toBe(true);
    expect(
      ingestEnvelopeSchema.safeParse({ ...envelope, payload: null, payloadTruncated: true })
        .success,
    ).toBe(true);
  });

  it('refuses an envelope version other than 1', () => {
    expect(ingestEnvelopeSchema.safeParse({ ...envelope, envelopeVersion: 2 }).success).toBe(false);
  });

  it('knows one source and eleven refusal reasons', () => {
    expect(ingestSourceSchema.options).toEqual(['github']);
    expect(ingestRefusalSchema.options).toHaveLength(11);
    expect(ingestRefusalSchema.options.at(0)).toBe('unknown_source');
    expect(ingestRefusalSchema.options.at(-1)).toBe('payload_too_large');
  });

  it('answers accepted, or an error with an ingest refusal reason', () => {
    expect(ingestResponseSchema.safeParse({ status: 'accepted' }).success).toBe(true);
    expect(
      ingestResponseSchema.safeParse({ status: 'error', reason: 'bad_signature' }).success,
    ).toBe(true);
    expect(
      ingestResponseSchema.safeParse({ status: 'error', reason: 'not_permitted' }).success,
    ).toBe(false);
  });

  it('limits a payload to 120000 bytes', () => {
    expect(INGEST_PAYLOAD_LIMIT_BYTES).toBe(120_000);
  });
});
