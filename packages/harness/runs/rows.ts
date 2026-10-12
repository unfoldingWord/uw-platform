import type { Identity, ItemState, RunFailure, RunStepRecord } from '@uw/contracts';
import type { RunRow } from '../ports.ts';
import type { RunPersona } from './types.ts';

const UNREPORTED_MODEL = 'unreported';

type HostedRunInput = {
  readonly runId: string;
  readonly item: ItemState;
  readonly persona: RunPersona;
  readonly delegationId: string;
  readonly traceId: string;
  readonly at: Date;
};

type ExternalRunInput = {
  readonly runId: string;
  readonly item: ItemState;
  readonly persona: Identity;
  readonly model: string | null;
  readonly traceId: string;
  readonly at: Date;
};

type RunEnd =
  | { readonly outcome: 'stopped' | 'completed'; readonly failure?: null }
  | { readonly outcome: 'failed'; readonly failure: RunFailure };

const unstarted = {
  resolvedProvider: null,
  steps: [],
  outcome: 'running',
  hibernatedFor: null,
  failure: null,
  gates: [],
  prompts: [],
  endedAt: null,
} as const;

export function newHostedRun(input: HostedRunInput): RunRow {
  const { runId, item, persona, delegationId, traceId, at } = input;
  return {
    ...unstarted,
    id: runId,
    harnessId: item.harnessId,
    itemId: item.itemId,
    persona: persona.identity,
    personaPageId: persona.pageId,
    delegationId,
    runShape: 'workflow-run',
    engine: persona.engine,
    model: persona.model,
    pinnedProvider: persona.provider,
    costMinor: 0,
    computeMinor: 0,
    costBasis: 'metered',
    traceId,
    startedAt: at,
  };
}

export function newExternalRun(input: ExternalRunInput): RunRow {
  const { runId, item, persona, model, traceId, at } = input;
  return {
    ...unstarted,
    id: runId,
    harnessId: item.harnessId,
    itemId: item.itemId,
    persona,
    personaPageId: null,
    delegationId: item.delegationId,
    runShape: 'external-run',
    engine: 'external',
    model: model ?? UNREPORTED_MODEL,
    pinnedProvider: null,
    costMinor: null,
    computeMinor: null,
    costBasis: 'subscription',
    traceId,
    startedAt: at,
  };
}

function summed(total: number | null, added: number | null): number | null {
  if (total === null) return null;
  return total + (added ?? 0);
}

export function withStep(run: RunRow, record: RunStepRecord): RunRow {
  return {
    ...run,
    steps: [...run.steps, record],
    costMinor: summed(run.costMinor, record.costMinor),
    computeMinor: summed(run.computeMinor, record.computeMinor),
    resolvedProvider: run.resolvedProvider ?? record.resolvedProvider,
    prompts: [],
  };
}

export function ended(run: RunRow, end: RunEnd, at: Date): RunRow {
  return {
    ...run,
    outcome: end.outcome,
    hibernatedFor: null,
    failure: end.failure ?? null,
    endedAt: at,
  };
}

export function heldByRun(item: ItemState, run: RunRow): boolean {
  return item.holder === run.persona && item.delegationId === run.delegationId;
}
