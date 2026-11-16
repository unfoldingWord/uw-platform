import type { DraftStage, Stage } from '@uw/contracts';

export const DRAFT_LOCK_MINUTES = 30;

const lockMs = DRAFT_LOCK_MINUTES * 60_000;

export function lockActive(touchedAt: Date, at: Date): boolean {
  return at.getTime() - touchedAt.getTime() < lockMs;
}

export function draftOf(stages: readonly Stage[]): readonly DraftStage[] {
  return [...stages]
    .sort((a, b) => a.position - b.position)
    .map((stage) => ({
      id: stage.id,
      key: stage.key,
      title: stage.title,
      bracket: stage.bracket,
      agentPickup: stage.agentPickup,
      exitGate: stage.exitGate,
      connector: stage.connector,
      wipLimit: stage.wipLimit,
      instructionsPageId: stage.instructionsPageId,
      validators: [...stage.validators],
      feeds: [...stage.feeds],
    }));
}

export function positionOf(index: number): number {
  return (index + 1) * 10;
}

export function sameStages(a: readonly Stage[], b: readonly Stage[]): boolean {
  const key = (stages: readonly Stage[]) =>
    JSON.stringify(
      [...stages]
        .sort((x, y) => (x.id < y.id ? -1 : 1))
        .map((stage) => ({ ...stage, paused: false })),
    );
  return key(a) === key(b);
}
