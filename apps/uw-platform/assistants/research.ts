import type { Research } from '@uw/harness';
import type { Bindings } from '../env.ts';
import { platformResearch } from '../ports/research.ts';
import { researchConfigOf } from './research/config.ts';

type ResearchHost = { readonly env: Bindings; readonly fetch: typeof fetch };

export function researchOf({ env, fetch }: ResearchHost): Research {
  return platformResearch({ ...researchConfigOf(env), fetcher: fetch });
}
