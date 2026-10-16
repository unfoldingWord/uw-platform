import type { IndicatorStatus } from '@uw/contracts';
import type { BadgeTone } from '@uw/ui/components/badge.tsx';
import { reasonText } from '@uw/ui/components/text.ts';

const indicatorWords: ReadonlyMap<string, string> = new Map([
  ['commit', 'Deployed commit'],
  ['database', 'Database'],
  ['queue', 'Queue'],
  ['live_hub', 'Live hub'],
  ['harness', 'Harness'],
  ['spend', 'Spend this month'],
  ['breaker', 'Spend breaker'],
  ['runs_today', 'Runs today'],
  ['live_delegations', 'Live delegations'],
  ['gate_refusals_week', 'Gate refusals this week'],
  ['agent_writes', 'Agent writes today'],
  ['stale_learnings', 'Stale learnings'],
  ['reviewer_refutes', 'Reviewer refute rate'],
  ['github_sweep', 'GitHub sweep'],
]);

const statusWords: ReadonlyMap<IndicatorStatus, { words: string; tone: BadgeTone }> = new Map<
  IndicatorStatus,
  { words: string; tone: BadgeTone }
>([
  ['ok', { words: 'Healthy', tone: 'success' }],
  ['amber', { words: 'Watch', tone: 'held' }],
  ['red', { words: 'Needs attention', tone: 'neutral' }],
  ['not_wired', { words: 'Not wired', tone: 'neutral' }],
  ['not_configured', { words: 'Not configured', tone: 'neutral' }],
]);

export function indicatorText(name: string): string {
  return indicatorWords.get(name) ?? reasonText(name);
}

export function statusOf(status: IndicatorStatus): {
  readonly words: string;
  readonly tone: BadgeTone;
} {
  return statusWords.get(status) ?? { words: reasonText(status), tone: 'neutral' };
}
