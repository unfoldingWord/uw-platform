import type { IngestEnvelope, IngestRefusal } from '@uw/contracts';

export type QueueSendOptions = { readonly contentType: 'json' };

export type IngestBindings = {
  COMMIT_SHA?: string;
  GITHUB_WEBHOOK_SECRET?: string;
  HYPERDRIVE?: { readonly connectionString: string };
  INGEST_QUEUE?: { send(body: IngestEnvelope, options?: QueueSendOptions): Promise<void> };
};

export type VerifiedDelivery = { readonly deliveryId: string; readonly event: string };

export type WebhookSource = {
  secret(env: IngestBindings): string | undefined;
  verify(
    headers: Headers,
    rawBody: string,
    secret: string,
  ): Promise<VerifiedDelivery | IngestRefusal>;
};

const UNKNOWN_COMMIT = 'unknown';

export function commitOf(env: IngestBindings): string {
  return env.COMMIT_SHA ?? UNKNOWN_COMMIT;
}
