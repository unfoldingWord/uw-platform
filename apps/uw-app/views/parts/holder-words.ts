import { formatDuration } from '@uw/core/dates';
import type { Holder, HolderRole } from '@uw/harness';

const roleWords = {
  claimant: 'Claimed by',
  reviewer: 'Under review by',
  decider: 'Waiting on a person to decide',
} as const satisfies Record<HolderRole, string>;

export function holderText(holder: Holder | null, at: Date): string {
  if (holder === null) return 'Nobody';
  const words = roleWords[holder.role];
  const who = holder.identity === null ? words : `${words} ${holder.identity}`;
  if (holder.since === null) return who;
  return `${who}, for ${formatDuration(at.getTime() - holder.since.getTime())}`;
}
