import type { KernelSettings } from '@uw/harness';
import type { JdArea } from '@uw/contracts';

export const ASSISTANTS_AREA: JdArea = '10-19';

export const platformKernelSettings: KernelSettings = {
  assistantsArea: ASSISTANTS_AREA,
  assistantSpendCapMinor: null,
};
