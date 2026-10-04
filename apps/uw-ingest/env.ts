import type { IngestEnvelope, IngestRefusal } from '@uw/contracts';

export type QueueSendOptions = { readonly contentType: 'json' };

export type IngestBindings = {
  COMMIT_SHA?: string;
  GITHUB_WEBHOOK_SECRET?: string;
  HYPERDRIVE?: { readonly connectionString: string };
  INGEST_QUEUE?: { send(body: IngestEnvelope, options?: QueueSendOptions): Promise<void> };
  ZULIP_WEBHOOK_TOKEN?: string;
};

export type VerifiedDelivery = { readonly deliveryId: string; readonly event: string };

export type WebhookSource = {
  secret(env: IngestBindings): string | undefined;
  verify(
    headers: Headers,
    rawBody: string,
    secret: string,
  ): Promise<VerifiedDelivery | IngestRefusal>;
  redact?(payload: unknown): unknown;
  readonly accepted?: Readonly<Record<string, boolean>>;
};

const UNKNOWN_COMMIT = 'unknown';

export function commitOf(env: IngestBindings): string {
  return env.COMMIT_SHA ?? UNKNOWN_COMMIT;
}
