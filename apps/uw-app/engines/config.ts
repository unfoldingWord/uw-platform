import type { Bindings } from '../env.ts';

export type EngineFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type EngineSettingName =
  | 'AI_GATEWAY_ACCOUNT_ID'
  | 'AI_GATEWAY_ID'
  | 'AI_GATEWAY_TOKEN'
  | 'ANTHROPIC_API_KEY'
  | 'OPENAI_API_KEY'
  | 'OPENROUTER_API_KEY'
  | 'AI_GATEWAY_ANALYTICS_TOKEN'
  | 'AI_SPEND_CAP_MINOR'
  | 'ALWAYS_ON_MODEL'
  | 'ALWAYS_ON_PROVIDER'
  | 'SANDBOX_MINOR_PER_HOUR';

type EngineSettings = { readonly [Name in EngineSettingName]?: string | undefined };

export type EngineConfig = EngineSettings & { readonly fetch: EngineFetch };

export function engineConfigOf(env: Bindings, fetch: EngineFetch): EngineConfig {
  return {
    AI_GATEWAY_ACCOUNT_ID: env.AI_GATEWAY_ACCOUNT_ID,
    AI_GATEWAY_ID: env.AI_GATEWAY_ID,
    AI_GATEWAY_TOKEN: env.AI_GATEWAY_TOKEN,
    ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
    OPENAI_API_KEY: env.OPENAI_API_KEY,
    OPENROUTER_API_KEY: env.OPENROUTER_API_KEY,
    AI_GATEWAY_ANALYTICS_TOKEN: env.AI_GATEWAY_ANALYTICS_TOKEN,
    AI_SPEND_CAP_MINOR: env.AI_SPEND_CAP_MINOR,
    ALWAYS_ON_MODEL: env.ALWAYS_ON_MODEL,
    ALWAYS_ON_PROVIDER: env.ALWAYS_ON_PROVIDER,
    SANDBOX_MINOR_PER_HOUR: env.SANDBOX_MINOR_PER_HOUR,
    fetch,
  };
}
