import type { WakeReason } from '@uw/contracts';

export const COOLDOWN_MS = 600_000;
export const POSTING_REASONS: ReadonlySet<WakeReason> = new Set<WakeReason>([
  'gate_waiting',
  'delegation_lapsed',
  'run_failed',
]);
export const wakeRank: Readonly<Record<WakeReason, 1 | 2 | 3>> = {
  gate_waiting: 3,
  delegation_lapsed: 3,
  run_failed: 2,
  stage_advanced: 1,
};

export function rankOf(reason: WakeReason): 1 | 2 | 3 {
  const { [reason]: rank } = wakeRank;
  return rank;
}

export type CooldownWindow = { readonly startedAt: Date; readonly rank: number };
export type CooldownChoice =
  | { readonly decision: 'send'; readonly window: CooldownWindow }
  | { readonly decision: 'coalesce' };

export function chooseInWindow(
  window: CooldownWindow | null,
  reason: WakeReason,
  at: Date,
): CooldownChoice {
  const rank = rankOf(reason);
  const open = window !== null && at.getTime() - window.startedAt.getTime() < COOLDOWN_MS;
  if (open && rank <= window.rank) return { decision: 'coalesce' };
  return { decision: 'send', window: { startedAt: at, rank } };
}
