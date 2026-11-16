import type { ScreenKernel } from './frame.tsx';

export async function waitingCount(screen: ScreenKernel, harnessId: string): Promise<number> {
  const { rows } = await screen.kernel.views.gates(screen.caller, { at: screen.at });
  return rows.filter((row) => row.harness.id === harnessId).length;
}
