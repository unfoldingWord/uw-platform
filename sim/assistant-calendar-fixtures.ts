import { personOf } from './wakes.ts';
import type { AssistantScene } from './assistant-fixtures.ts';
import type { OpenTurn } from './assistant-reminder-fixtures.ts';
import { simCaller } from './fixtures.ts';
import { value } from './runs.ts';

const HOUR_MS = 60 * 60_000;

export function addressOf(n: number): string {
  return `person${String(n)}@unfoldingword.org`;
}

export async function inTimezone(scene: AssistantScene, timezone: string): Promise<void> {
  const { world, person, harness } = scene;
  value(
    await world.kernel.assistants.customise(simCaller(world, person), {
      harnessId: harness.id,
      settings: { displayName: 'Barnabas', instructionsMd: '', timezone },
      expectedVersion: 0,
    }),
  );
}

export function seedEvent(
  scene: AssistantScene,
  title: string,
  startsAt: string,
  hours: number,
  description = '',
): string {
  const starts = new Date(startsAt);
  return scene.world.adapters.workspace.addEvent(personOf(scene.person), {
    title,
    startsAt: starts,
    endsAt: new Date(starts.getTime() + hours * HOUR_MS),
    description,
  });
}

function turnOf(open: OpenTurn) {
  return { requestId: open.id, turnId: open.turn.turnId };
}

export function readCalendar(
  scene: AssistantScene,
  open: OpenTurn,
  input: { readonly day?: string; readonly days?: number } = {},
) {
  const { world } = scene;
  return world.kernel.assistants.readMyCalendar(simCaller(world, open.turn.principal), {
    ...turnOf(open),
    ...input,
  });
}

export function findTime(
  scene: AssistantScene,
  open: OpenTurn,
  input: { readonly with: readonly string[]; readonly minutes: number; readonly day?: string },
) {
  const { world } = scene;
  return world.kernel.assistants.findFreeTime(simCaller(world, open.turn.principal), {
    ...turnOf(open),
    ...input,
  });
}

export function holdTime(
  scene: AssistantScene,
  open: OpenTurn,
  hold: { readonly title: string; readonly start: string; readonly end: string },
) {
  const { world } = scene;
  return world.kernel.assistants.holdTime(simCaller(world, open.turn.principal), {
    ...turnOf(open),
    ...hold,
  });
}

export function releaseHold(scene: AssistantScene, open: OpenTurn, holdId: string) {
  const { world } = scene;
  return world.kernel.assistants.releaseHold(simCaller(world, open.turn.principal), {
    ...turnOf(open),
    holdId,
  });
}

export function inHours(scene: AssistantScene, hours: number): string {
  return new Date(scene.world.adapters.clock.now().getTime() + hours * HOUR_MS).toISOString();
}
