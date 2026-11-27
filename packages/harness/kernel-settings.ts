import type { JdArea } from '@uw/contracts';

export type KernelSettings = {
  readonly assistantsArea: JdArea | null;
  readonly assistantSpendCapMinor: number | null;
  readonly appOrigin: string | null;
};

export const unsetKernelSettings: KernelSettings = {
  assistantsArea: null,
  assistantSpendCapMinor: null,
  appOrigin: null,
};
