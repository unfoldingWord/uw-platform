import type { Bindings, BrowserBinding } from '../../env.ts';

export type ResearchConfig = {
  readonly braveKey: string | null;
  readonly duffelToken: string | null;
  readonly browser: BrowserBinding | null;
};

const TOKEN = /^[A-Za-z0-9_.-]{8,512}$/;

function tokenOf(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return TOKEN.test(trimmed) ? trimmed : null;
}

export function researchConfigOf(
  env: Pick<Bindings, 'BRAVE_SEARCH_API_KEY' | 'DUFFEL_ACCESS_TOKEN' | 'BROWSER'>,
): ResearchConfig {
  return {
    braveKey: tokenOf(env.BRAVE_SEARCH_API_KEY),
    duffelToken: tokenOf(env.DUFFEL_ACCESS_TOKEN),
    browser: env.BROWSER ?? null,
  };
}
