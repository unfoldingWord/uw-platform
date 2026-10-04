import { z } from 'zod';
import { principalSchema } from './principal.ts';

export const INGEST_PAYLOAD_LIMIT_BYTES = 120_000;

export const ingestSourceSchema = z.enum(['github', 'zulip']);

export const ingestRefusalSchema = z.enum([
  'unknown_source',
  'source_not_configured',
  'unsigned',
  'bad_signature',
  'malformed_delivery',
  'malformed_payload',
  'replayed',
  'replay_store_not_configured',
  'queue_not_configured',
  'enqueue_failed',
  'payload_too_large',
]);

export const ingestEnvelopeSchema = z.object({
  envelopeVersion: z.literal(1),
  traceId: z.uuid(),
  source: ingestSourceSchema,
  deliveryId: z.string().min(1).max(200),
  event: z.string().min(1).max(100),
  receivedAt: z.iso.datetime(),
  principal: principalSchema,
  payload: z.json().nullable(),
  payloadTruncated: z.boolean(),
});

export const ingestResponseSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('accepted') }),
  z.object({ status: z.literal('error'), reason: ingestRefusalSchema }),
]);

export type IngestSource = z.infer<typeof ingestSourceSchema>;
export type IngestRefusal = z.infer<typeof ingestRefusalSchema>;
export type IngestEnvelope = z.infer<typeof ingestEnvelopeSchema>;
export type IngestResponse = z.infer<typeof ingestResponseSchema>;
