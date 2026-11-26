import { INSTALL_WORST_MS, RESOURCE_WORST_MS } from './sandbox.ts';

export type StepKind = 'record' | 'sandbox';

type StepBudget = {
  readonly retries: {
    readonly limit: number;
    readonly delay: number;
    readonly backoff: 'exponential';
  };
  readonly timeout: number;
};

const MINUTE_MS = 60_000;

export const STEP_BUDGETS: Readonly<Record<StepKind, StepBudget>> = {
  record: {
    retries: { limit: 3, delay: 10_000, backoff: 'exponential' },
    timeout: 2 * MINUTE_MS,
  },
  sandbox: {
    retries: { limit: 5, delay: 30_000, backoff: 'exponential' },
    timeout: Math.max(INSTALL_WORST_MS, RESOURCE_WORST_MS) + 3 * MINUTE_MS,
  },
};
