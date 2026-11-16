import type { ScreenKernel } from './frame.tsx';

export async function waitingCount(screen: ScreenKernel, harnessId: string): Promise<number> {
  const input = { harnessId };
  const { rows } = await screen.kernel.views.workflowGates(screen.caller, input, { at: screen.at });
  return rows.length;
}
