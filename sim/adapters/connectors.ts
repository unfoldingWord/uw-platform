import {
  sameRepository,
  type ConnectorOutcome,
  type ConnectorRequest,
  type Connectors,
  type EffectConnector,
  type ReviewOutcome,
  type ReviewRequest,
} from '@uw/harness';

export type SimConnectors = Connectors & {
  calls(): readonly ConnectorRequest[];
  refuseNext(connector: EffectConnector, reason: string): void;
  succeedNext(connector: EffectConnector): void;
  reviews(): readonly ReviewRequest[];
  refuseNextReview(reason: string): void;
};

const firstReviewId = 9200000001;

type Programmed =
  { readonly outcome: 'succeeded' } | { readonly outcome: 'refused'; readonly reason: string };

const wired: ReadonlySet<EffectConnector> = new Set<EffectConnector>(['merge']);

function effectKey(request: ConnectorRequest): string {
  return JSON.stringify([request.connector, request.itemId, request.expectedHead]);
}

function defaultFor(connector: EffectConnector): Programmed {
  return wired.has(connector)
    ? { outcome: 'succeeded' }
    : { outcome: 'refused', reason: 'not_wired' };
}

function createSimReviews() {
  const posted: ReviewRequest[] = [];
  let refusal: string | null = null;
  return {
    review: async (request: ReviewRequest): Promise<ReviewOutcome> => {
      if (!sameRepository(request.repository, request.pullRequest.repo)) {
        return { outcome: 'refused', reason: 'repository_mismatch' };
      }
      const reason = refusal;
      refusal = null;
      if (reason !== null) return { outcome: 'refused', reason };
      posted.push(structuredClone(request));
      return { outcome: 'posted', reviewId: firstReviewId + posted.length - 1 };
    },
    reviews: () => posted.map((request) => structuredClone(request)),
    refuseNextReview: (reason: string) => {
      refusal = reason;
    },
  };
}

export function createSimConnectors(): SimConnectors {
  const calls: ConnectorRequest[] = [];
  const programmed = new Map<EffectConnector, Programmed>();
  const effects = new Map<string, ConnectorOutcome>();
  return {
    ...createSimReviews(),
    run: async (request) => {
      calls.push(structuredClone(request));
      const next = programmed.get(request.connector) ?? defaultFor(request.connector);
      programmed.delete(request.connector);
      if (next.outcome === 'refused') return { outcome: 'refused', reason: next.reason };
      const outcome: ConnectorOutcome = { outcome: 'succeeded', detail: {} };
      effects.set(effectKey(request), outcome);
      return structuredClone(outcome);
    },
    outcomeOf: async (request) => {
      if (!wired.has(request.connector)) return { outcome: 'refused', reason: 'not_wired' };
      const outcome = effects.get(effectKey(request));
      return outcome === undefined ? null : structuredClone(outcome);
    },
    calls: () => calls.map((call) => structuredClone(call)),
    refuseNext: (connector, reason) => {
      programmed.set(connector, { outcome: 'refused', reason });
    },
    succeedNext: (connector) => {
      programmed.set(connector, { outcome: 'succeeded' });
    },
  };
}
