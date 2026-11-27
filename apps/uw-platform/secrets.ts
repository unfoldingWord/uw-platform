import { createLogger, type LogSink } from '@uw/core/log';
import { workerSecrets, type SecretBindings } from '@uw/core/platform-secrets';
import { commitOf, type Bindings } from './env.ts';

export const platformSecretNames = [
  'ACCESS_SERVICE_TOKENS_API_TOKEN',
  'AI_GATEWAY_ANALYTICS_TOKEN',
  'AI_GATEWAY_TOKEN',
  'ANTHROPIC_API_KEY',
  'BUILDER_GITHUB_APP_PRIVATE_KEY',
  'CREDENTIALS_KMS_ACCESS_KEY_ID',
  'CREDENTIALS_KMS_SECRET_ACCESS_KEY',
  'GITHUB_APP_PRIVATE_KEY',
  'GOOGLE_WORKSPACE_KEY',
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
  'REVIEWER_CODEX_GITHUB_APP_PRIVATE_KEY',
  'REVIEWER_GITHUB_APP_PRIVATE_KEY',
  'VAPID_PRIVATE_JWK',
  'ZULIP_ADMIN_API_KEY',
  'ZULIP_BOT_API_KEY',
] as const satisfies readonly (keyof Bindings)[];

type PlatformSecretName = (typeof platformSecretNames)[number];

export type WorkerEnv = Bindings & SecretBindings<PlatformSecretName>;

const FRESH_MS = 300_000;
const RETRY_MS = 30_000;
const SECRETS_ROUTE = 'secrets';

const resolve = workerSecrets(platformSecretNames, {
  freshMs: FRESH_MS,
  retryMs: RETRY_MS,
  now: () => Date.now(),
});

export function withSecrets(
  env: WorkerEnv,
  sink: LogSink = (line) => console.log(line),
): Promise<Bindings> {
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
