import type { JdArea } from '@uw/contracts';

export type KernelSettings = { readonly assistantsArea: JdArea | null };

export const unsetKernelSettings: KernelSettings = { assistantsArea: null };
