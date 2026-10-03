import type { CostBasis, RunShape, runStepSchema } from '@uw/contracts';

type RunStep = (typeof runStepSchema.options)[number];

export const workflowRunSteps = [
  'read',
  'scout',
  'work',
  'submit',
] as const satisfies readonly RunStep[];

export const runShapes: Readonly<
  Record<RunShape, { readonly host: 'platform' | 'external'; readonly costBasis: CostBasis }>
> = {
  'workflow-run': { host: 'platform', costBasis: 'metered' },
  'external-run': { host: 'external', costBasis: 'subscription' },
};
