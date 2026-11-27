import type { KernelSettings } from '@uw/harness';
import type { Bindings } from '../../env.ts';
import { ASSISTANTS_AREA } from '../area.ts';

const POSITIVE_INTEGER = /^[1-9]\d{0,14}$/;

export function assistantKernelSettings(
  env: Pick<Bindings, 'ASSISTANT_SPEND_CAP_MINOR'>,
): KernelSettings {
  const configured = env.ASSISTANT_SPEND_CAP_MINOR ?? '';
  const cap = POSITIVE_INTEGER.test(configured) ? Number(configured) : null;
  return { assistantsArea: ASSISTANTS_AREA, assistantSpendCapMinor: cap };
}
