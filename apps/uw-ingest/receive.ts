import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import {
  INGEST_PAYLOAD_LIMIT_BYTES,
  ingestEnvelopeSchema,
  ingestSourceSchema,
  type IngestEnvelope,
  type IngestRefusal,
  type IngestSource,
} from '@uw/contracts';
import { ingestPrincipal } from '@uw/core/principal';
import type { IngestDeps, IngestEnv } from './deps.ts';
import type { DeliveryLedger } from './deliveries/ledger.ts';
import type { VerifiedDelivery } from './env.ts';
import { webhookSources } from './sources/registry.ts';

const refusalStatus = new Map<IngestRefusal, ContentfulStatusCode>([
  ['unknown_source', 404],
  ['unsigned', 401],
  ['bad_signature', 401],
  ['malformed_delivery', 400],
  ['malformed_payload', 400],
  ['replayed', 409],
  ['source_not_configured', 503],
  ['replay_store_not_configured', 503],
  ['queue_not_configured', 503],
  ['enqueue_failed', 503],
  ['payload_too_large', 413],
]);

const WEBHOOK_BODY_LIMIT_BYTES = 25 * 1024 * 1024;

type Queue = NonNullable<IngestEnv['Bindings']['INGEST_QUEUE']>;

function declaredTooLarge(headers: Headers): boolean {
  return Number(headers.get('content-length') ?? 0) > WEBHOOK_BODY_LIMIT_BYTES;
}

function parseJson(rawBody: string): { readonly value: unknown } | null {
  try {
    const value: unknown = JSON.parse(rawBody);
    return { value };
  } catch {
    return null;
  }
}

type Arrival = {
  readonly traceId: string;
  readonly source: IngestSource;
  readonly delivery: VerifiedDelivery;
};

function buildEnvelope(deps: IngestDeps, arrival: Arrival, rawBody: string, payload: unknown) {
  const { traceId, source, delivery } = arrival;
  const payloadTruncated =
    new TextEncoder().encode(rawBody).byteLength > INGEST_PAYLOAD_LIMIT_BYTES;
  return ingestEnvelopeSchema.safeParse({
    envelopeVersion: 1,
    traceId,
    source,
    deliveryId: delivery.deliveryId,
    event: delivery.event,
    receivedAt: deps.now().toISOString(),
    principal: ingestPrincipal(),
    payload: payloadTruncated ? null : payload,
    payloadTruncated,
  });
}

async function enqueue(
  ledger: DeliveryLedger,
  queue: Queue,
  envelope: IngestEnvelope,
): Promise<IngestRefusal | null> {
  if (!(await ledger.claim(envelope.source, envelope.deliveryId))) return 'replayed';
  try {
    await queue.send(envelope, { contentType: 'json' });
    return null;
  } catch {
    await ledger.release(envelope.source, envelope.deliveryId);
    return 'enqueue_failed';
  }
}

type Verified = {
  readonly source: IngestSource;
  readonly delivery: VerifiedDelivery;
  readonly rawBody: string;
  readonly payload: unknown;
};

async function verifiedDelivery(c: Context<IngestEnv>): Promise<Verified | IngestRefusal> {
  const name = ingestSourceSchema.safeParse(c.req.param('source'));
  const source = name.success ? webhookSources.get(name.data) : undefined;
  if (!name.success || !source) return 'unknown_source';
  const secret = source.secret(c.env);
  if (!secret) return 'source_not_configured';
  if (declaredTooLarge(c.req.raw.headers)) return 'payload_too_large';
  const rawBody = await c.req.text();
  const delivery = await source.verify(c.req.raw.headers, rawBody, secret);
  if (typeof delivery === 'string') return delivery;
  const parsed = parseJson(rawBody);
  if (!parsed) return 'malformed_payload';
  const payload = source.redact ? source.redact(parsed.value) : parsed.value;
  return { source: name.data, delivery, rawBody, payload };
}

async function admit(
  c: Context<IngestEnv>,
  deps: IngestDeps,
  ledger: DeliveryLedger | undefined,
): Promise<IngestRefusal | null> {
  const verified = await verifiedDelivery(c);
  if (typeof verified === 'string') return verified;
  if (!ledger) return 'replay_store_not_configured';
  const queue = c.env.INGEST_QUEUE;
  if (!queue) return 'queue_not_configured';
  const { source, delivery, rawBody, payload } = verified;
  const envelope = buildEnvelope(
    deps,
    { traceId: c.get('traceId'), source, delivery },
    rawBody,
    payload,
  );
  if (!envelope.success) return 'malformed_delivery';
  return enqueue(ledger, queue, envelope.data);
}

function acceptedFields(c: Context<IngestEnv>): Readonly<Record<string, boolean>> {
  const name = ingestSourceSchema.safeParse(c.req.param('source'));
  return (name.success ? webhookSources.get(name.data)?.accepted : undefined) ?? {};
}

export function receive(deps: IngestDeps) {
  return async (c: Context<IngestEnv>): Promise<Response> => {
    c.set('logger', c.get('logger').with({ principal: ingestPrincipal().identity }));
    const handle = deps.openLedger(c.env);
    try {
      const reason = await admit(c, deps, handle?.ledger);
      if (reason === null) {
        c.set('outcome', 'accepted');
        return c.json({ ...acceptedFields(c), status: 'accepted' }, 202);
      }
      c.set('outcome', reason);
      return c.json({ status: 'error', reason }, refusalStatus.get(reason) ?? 503);
    } finally {
      await handle?.release().catch(() => undefined);
    }
  };
}
