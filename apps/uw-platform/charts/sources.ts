import type { ChartStaleReason } from '@uw/contracts';
import {
  accepted,
  type Caller,
  type DailyPoint,
  type ItemHistoryRead,
  type Kernel,
  type KernelOutcome,
} from '@uw/harness';
import type { TeamRead } from '../people/team-model.ts';

export type ChartStale = { readonly since: Date; readonly reason: ChartStaleReason };

export type ChartSources = {
  readonly at: Date;
  daily(harnessId: string): Promise<KernelOutcome<readonly DailyPoint[]>>;
  history(harnessId: string): Promise<KernelOutcome<ItemHistoryRead>>;
  team(): Promise<KernelOutcome<TeamRead>>;
  freshness(): Promise<ChartStale | null>;
};

export type KernelReader = { readonly kernel: Kernel; readonly caller: Caller; readonly at: Date };

export type OtherSources = Pick<ChartSources, 'team' | 'freshness'>;

export function kernelSources(reader: KernelReader, others: OtherSources): ChartSources {
  const { kernel, caller, at } = reader;
  return {
    at,
    daily: async (harnessId) => {
      const scene = await kernel.reads.harness(caller, { harnessId }, { at });
      if (scene.status === 'error') return scene;
      return accepted(await kernel.views.daily(caller, { harnessId }, { at }));
    },
    history: (harnessId) => kernel.views.itemHistory(caller, { harnessId }, { at }),
    team: others.team,
    freshness: others.freshness,
  };
}
