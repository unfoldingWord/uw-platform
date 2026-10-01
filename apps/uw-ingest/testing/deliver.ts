import { sign } from '@octokit/webhooks-methods';
import { ingestEnvelopeSchema } from '@uw/contracts';
import { createIngestApp } from '../app.ts';
import type { IngestDeps } from '../deps.ts';
import type { IngestBindings } from '../env.ts';
import { memoryLedger, recordingQueue } from './doubles.ts';

export const FIXTURE_SECRET = 'fixture-webhook-secret';
export const FIXED_NOW = '2026-10-01T12:00:00.000Z';

export function harness(overrides: Partial<IngestDeps> = {}) {
  const lines: Record<string, unknown>[] = [];
  const rawLines: string[] = [];
  const ledger = memoryLedger();
  const queue = recordingQueue();
  const deps: IngestDeps = {
    openLedger: () => ({ ledger, release: async () => undefined }),
    newId: () => crypto.randomUUID(),
    now: () => new Date(FIXED_NOW),
    sink: (line) => {
      rawLines.push(line);
      lines.push(JSON.parse(line));
    },
    ...overrides,
  };
  const env: IngestBindings = {
    GITHUB_WEBHOOK_SECRET: FIXTURE_SECRET,
    INGEST_QUEUE: queue,
    COMMIT_SHA: 'abc1234',
  };
  const app = createIngestApp(deps);
  return { app, env, ledger, queue, lines, rawLines };
}

export type Delivery = {
  readonly body: string;
  readonly secret?: string;
  readonly signature?: string | null;
  readonly deliveryId?: string | null;
  readonly path?: string;
};

export async function post(
  h: ReturnType<typeof harness>,
  delivery: Delivery,
  env: IngestBindings = h.env,
): Promise<Response> {
  const headers = new Headers({ 'x-github-event': 'pull_request' });
  const signature =
    delivery.signature === undefined
      ? await sign(delivery.secret ?? FIXTURE_SECRET, delivery.body)
      : delivery.signature;
  if (signature !== null) headers.set('x-hub-signature-256', signature);
  if (delivery.deliveryId !== null) headers.set('x-github-delivery', delivery.deliveryId ?? 'd-1');
  return h.app.request(
    delivery.path ?? '/webhooks/github',
    { method: 'POST', headers, body: delivery.body },
    env,
  );
}

export function envelopesIn(h: ReturnType<typeof harness>) {
  return h.queue.sent.map((envelope) => ingestEnvelopeSchema.parse(envelope));
}
