import { deviceOwnerSegment, type RunHibernation } from '@uw/contracts';
import type { RunMark, RunSpend, RunSummary } from '@uw/harness';
import type { BadgeTone } from '@uw/ui/components/badge.tsx';
import { formatCount, formatMoney } from '@uw/core/money';
import { reasonText } from '@uw/ui/components/text.ts';

const sleeping: Readonly<Record<RunHibernation, string>> = {
  gate: 'Sleeping at a gate',
  paused: 'Paused',
  breaker: 'Held by the spend breaker',
};

export const sleepingMeaning: Readonly<Record<RunHibernation, string>> = {
  gate: 'It uses no machine until a person decides, and ends if nobody decides in time.',
  paused: 'Someone paused this stage. It carries on from the same step when the stage resumes.',
  breaker:
    'The month’s spend cap is close or reached. It carries on from the same step once spending is allowed again.',
};

type Status = { readonly text: string; readonly tone: BadgeTone };

export function statusOf(run: RunSummary): Status {
  if (run.outcome === 'running') return { text: 'Running', tone: 'info' };
  if (run.outcome === 'hibernated' && run.hibernatedFor !== null) {
    return {
      text: sleeping[run.hibernatedFor],
      tone: run.hibernatedFor === 'gate' ? 'person' : 'held',
    };
  }
  if (run.outcome === 'completed') return { text: 'Done', tone: 'success' };
  if (run.outcome === 'failed') {
    const why = run.failure === null ? '' : `: ${reasonText(run.failure)}`;
    return { text: `Failed${why}`, tone: 'neutral' };
  }
  return { text: 'Stopped', tone: 'neutral' };
}

export function spendText(spend: RunSpend): string {
  if (spend.basis === 'subscription')
    return `${formatCount(spend.tokens)} tokens, own subscription`;
  return formatMoney({ amountMinor: spend.amountMinor, currency: spend.currency });
}

export function stepCostText(
  step: {
    readonly costMinor: number | null;
    readonly computeMinor: number | null;
  },
  basis: RunSpend['basis'],
): string {
  if (basis === 'subscription') return 'own subscription';
  const amountMinor = (step.costMinor ?? 0) + (step.computeMinor ?? 0);
  return formatMoney({ amountMinor, currency: 'USD' });
}

export const resumeMeaning =
  'A step that fails is tried again, up to three times, and the run carries on from that step rather than starting over. A step shown twice was tried again.';

export function triedAgain(steps: readonly { readonly step: string }[], index: number): boolean {
  const step = steps.at(index)?.step;
  return steps.slice(0, index).some((earlier) => earlier.step === step);
}

export function markText(mark: RunMark): string {
  const why = mark.why === null ? '' : ` (${reasonText(mark.why)})`;
  if (mark.name === 'run_resumed') return `Woke up and carried on${why}`;
  if (mark.name === 'run_failed') return `A step failed${why}`;
  if (mark.name === 'run_hibernated') return `Went to sleep${why}`;
  return `Stopped${why}`;
}

export function agentName(run: Pick<RunSummary, 'agentTitle' | 'persona'>): string {
  if (run.agentTitle !== null) return run.agentTitle;
  return deviceOwnerSegment(run.persona) === null ? run.persona : 'A person’s own Claude Code';
}
