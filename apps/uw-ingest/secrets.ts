import { createLogger, type LogSink } from '@uw/core/log';
import { workerSecrets, type SecretBindings } from '@uw/core/platform-secrets';
import { commitOf, type IngestBindings } from './env.ts';

export const ingestSecretNames = [
  'GITHUB_WEBHOOK_SECRET',
  'ZULIP_WEBHOOK_TOKEN',
] as const satisfies readonly (keyof IngestBindings)[];

type IngestSecretName = (typeof ingestSecretNames)[number];

export type IngestWorkerEnv = IngestBindings & SecretBindings<IngestSecretName>;

const FRESH_MS = 300_000;
const RETRY_MS = 30_000;
const SECRETS_ROUTE = 'secrets';

const resolve = workerSecrets(ingestSecretNames, {
  freshMs: FRESH_MS,
  retryMs: RETRY_MS,
  now: () => Date.now(),
});

export function withSecrets(
  env: IngestWorkerEnv,
  sink: LogSink = (line) => console.log(line),
): Promise<IngestBindings> {
  return resolve(env, (names) => {
    const context = {
      traceId: crypto.randomUUID(),
      commit: commitOf(env),
      route: SECRETS_ROUTE,
      principal: null,
    };
    createLogger(context, sink).error('a Secrets Store binding could not be read', {
      outcome: 'secret_store_unreadable',
      secrets: names.join(','),
    });
  });
}
