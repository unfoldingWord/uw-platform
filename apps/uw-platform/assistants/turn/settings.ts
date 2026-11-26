import type { KernelSettings } from '@uw/harness';
import type { Bindings } from '../../env.ts';

const POSITIVE_INTEGER = /^[1-9]\d{0,14}$/;

export function assistantKernelSettings(
  env: Pick<Bindings, 'ASSISTANT_SPEND_CAP_MINOR'>,
): KernelSettings {
  const configured = env.ASSISTANT_SPEND_CAP_MINOR ?? '';
  const cap = POSITIVE_INTEGER.test(configured) ? Number(configured) : null;
  return { assistantsArea: null, assistantSpendCapMinor: cap };
}
