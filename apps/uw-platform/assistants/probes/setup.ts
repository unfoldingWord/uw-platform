import { z } from 'zod';
import type { Bindings } from '../../env.ts';

export type ProbeEnv = Readonly<Record<string, string | undefined>>;
export type ProbeDeps = {
  readonly env: ProbeEnv;
  readonly fetcher: typeof fetch;
  readonly now: () => Date;
  readonly write: boolean;
  readonly suffix: string;
};

const bindingNames = [
  'ZULIP_SITE',
  'ZULIP_ADMIN_EMAIL',
  'ZULIP_ADMIN_API_KEY',
  'ASSISTANT_WEBHOOK_BASE',
  'GOOGLE_WORKSPACE_KEY',
  'GOOGLE_WORKSPACE_DOMAIN',
  'GOOGLE_WORKSPACE_ADMIN_SUBJECT',
  'GOOGLE_ASSISTANT_OU',
  'AI_GATEWAY_ACCOUNT_ID',
  'AI_GATEWAY_ID',
  'AI_GATEWAY_TOKEN',
  'OPENROUTER_API_KEY',
  'ALWAYS_ON_MODEL',
  'ALWAYS_ON_PROVIDER',
  'BRAVE_SEARCH_API_KEY',
  'DUFFEL_ACCESS_TOKEN',
] as const satisfies readonly (keyof Bindings)[];

export const WRITES_ONLY = 'writes to the realm or the domain; run again with --write';

const emailSchema = z.email();

export function setting(env: ProbeEnv, name: string): string | undefined {
  const value: unknown = Reflect.get(env, name);
  return typeof value === 'string' ? value : undefined;
}

export function bindingsOf(env: ProbeEnv): Bindings {
  return Object.fromEntries(bindingNames.map((name) => [name, setting(env, name)]));
}

export function addressOf(env: ProbeEnv, name: string): string | null {
  const parsed = emailSchema.safeParse(setting(env, name)?.trim().toLowerCase());
  return parsed.success ? parsed.data : null;
}

function missing(env: ProbeEnv, names: readonly string[]): string[] {
  return names.filter((name) => (setting(env, name) ?? '').trim() === '');
}

export function notConfigured(env: ProbeEnv, names: readonly string[]): string {
  const absent = missing(env, names);
  return absent.length > 0
    ? `not configured: set ${absent.join(', ')}`
    : `not configured: check the values of ${names.join(', ')}`;
}

export function errorName(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 300) : 'thrown';
}
