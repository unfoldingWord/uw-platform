import { eventEvidenceSchemas, type HarnessEvent } from '@uw/contracts';

export const REFUTE_WINDOW_MS = 30 * 24 * 3_600_000;
export const refuteNames = ['run_completed', 'finding_refuted'] as const;

export type RefuteTally = {
  readonly harnessId: string;
  readonly persona: string;
  readonly findings: number;
  readonly refuted: number;
};

type Counting = { harnessId: string; persona: string; findings: number; refuted: number };

function counting(tallies: Map<string, Counting>, harnessId: string, persona: string): Counting {
  const key = `${harnessId} ${persona}`;
  const held = tallies.get(key) ?? { harnessId, persona, findings: 0, refuted: 0 };
  tallies.set(key, held);
  return held;
}

function count(tallies: Map<string, Counting>, event: HarnessEvent): void {
  if (event.name === 'run_completed') {
    const { review } = eventEvidenceSchemas.run_completed.parse(event.evidence);
    if (review !== null) {
      counting(tallies, event.harnessId, event.actor).findings += review.findings.length;
    }
  }
  if (event.name === 'finding_refuted') {
    const { persona } = eventEvidenceSchemas.finding_refuted.parse(event.evidence);
    counting(tallies, event.harnessId, persona).refuted += 1;
  }
}

export function refuteTallies(events: readonly HarnessEvent[]): readonly RefuteTally[] {
  const tallies = new Map<string, Counting>();
  for (const event of events) count(tallies, event);
  return [...tallies.values()]
    .filter((tally) => tally.findings > 0 || tally.refuted > 0)
    .sort(
      (a, b) =>
        a.persona.localeCompare(b.persona, 'en') || a.harnessId.localeCompare(b.harnessId, 'en'),
    )
    .map((tally) => ({ ...tally }));
}

export function refuteSince(at: Date): Date {
  return new Date(at.getTime() - REFUTE_WINDOW_MS);
}
