import { eventEvidenceSchemas, type GateView, type HarnessEvent } from '@uw/contracts';

const VERDICTS_SHOWN = 20;

function refutedKeys(events: readonly HarnessEvent[]): ReadonlySet<string> {
  return new Set(
    events
      .filter((event) => event.name === 'finding_refuted')
      .map((event) => `${String(event.evidence['runId'])} ${String(event.evidence['index'])}`),
  );
}

export function verdictsOf(events: readonly HarnessEvent[]): GateView['verdicts'] {
  const refuted = refutedKeys(events);
  const verdicts = events.flatMap((event) => {
    if (event.name !== 'run_completed') return [];
    const { runId, review } = eventEvidenceSchemas.run_completed.parse(event.evidence);
    if (review === null || review.findings.length === 0) return [];
    const findings = review.findings.map((finding, index) => ({
      ...finding,
      refuted: refuted.has(`${runId} ${String(index)}`),
    }));
    const { reviewer, verdict } = review;
    return [{ runId, persona: event.actor, reviewer, verdict, findings }];
  });
  return verdicts.slice(-VERDICTS_SHOWN);
}
