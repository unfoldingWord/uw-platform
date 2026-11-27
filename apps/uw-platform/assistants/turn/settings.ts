import type { KernelSettings } from '@uw/harness';
import type { Bindings } from '../../env.ts';
import { ASSISTANTS_AREA } from '../area.ts';

const POSITIVE_INTEGER = /^[1-9]\d{0,14}$/;

function httpsOrigin(configured: string): string | null {
  if (!URL.canParse(configured)) return null;
  const url = new URL(configured);
  const bare = url.pathname === '/' && url.search === '' && url.hash === '';
  return url.protocol === 'https:' && bare && url.username === '' ? url.origin : null;
}

export function assistantKernelSettings(
  env: Pick<Bindings, 'ASSISTANT_SPEND_CAP_MINOR' | 'APP_ORIGIN'>,
): KernelSettings {
  const configured = env.ASSISTANT_SPEND_CAP_MINOR ?? '';
  const cap = POSITIVE_INTEGER.test(configured) ? Number(configured) : null;
  return {
    assistantsArea: ASSISTANTS_AREA,
    assistantSpendCapMinor: cap,
    appOrigin: httpsOrigin(env.APP_ORIGIN ?? ''),
  };
}
