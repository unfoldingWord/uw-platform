import { verbIo } from '@uw/contracts';
import type { Caller } from '../caller.ts';
import { recordContext } from '../items/record.ts';
import { refused, type KernelOutcome, type Refused } from '../outcome.ts';
import type { Ports } from '../ports.ts';
import { drafted, type DraftedEffect } from './effect-drafts.ts';
import { addressed, turnSceneOf, type TurnAddress, type TurnScene } from './reminder-turn.ts';

export type HoldTimeInput = TurnAddress & {
  readonly title: string;
  readonly start: string;
  readonly end: string;
};
export type ReleaseHoldInput = TurnAddress & { readonly holdId: string };

type DraftPorts = Pick<Ports, 'clock' | 'grants' | 'ids' | 'store'>;

const HOUR_MS = 60 * 60_000;
const HOLD_LONGEST_MS = 24 * HOUR_MS;
const HOLD_FURTHEST_MS = 548 * 24 * HOUR_MS;

function windowRefusal(start: Date, end: Date, now: Date): Refused | null {
  if (start.getTime() < now.getTime()) return refused('malformed_command', { why: 'hold_in_past' });
  const length = end.getTime() - start.getTime();
  if (length <= 0 || length > HOLD_LONGEST_MS) {
    return refused('malformed_command', { why: 'hold_too_long' });
  }
  if (start.getTime() > now.getTime() + HOLD_FURTHEST_MS) {
    return refused('malformed_command', { why: 'hold_too_far' });
  }
  return null;
}

export async function holdTime(
  ports: DraftPorts,
  caller: Caller,
  input: HoldTimeInput,
): Promise<KernelOutcome<DraftedEffect>> {
  const { title, start, end } = input;
  const parsed = verbIo.hold_time.input.safeParse({ title, start, end });
  if (!parsed.success || !addressed(input)) {
    return refused('malformed_command', { why: 'hold_input' });
  }
  const context = recordContext(ports, caller, ports.clock.now());
  const startsAt = new Date(parsed.data.start);
  const endsAt = new Date(parsed.data.end);
  const outside = windowRefusal(startsAt, endsAt, context.at);
  if (outside !== null) return outside;
  const payload = {
    title: parsed.data.title,
    start: startsAt.toISOString(),
    end: endsAt.toISOString(),
  };
  return ports.store.transaction(async (tx) => {
    const scene = await turnSceneOf(tx, ports, context, caller, input);
    return 'status' in scene ? scene : drafted(scene, { kind: 'calendar_hold_added', payload });
  });
}

async function releaseIn(scene: TurnScene, holdId: string) {
  const hold = await scene.tx.assistantHolds.read.byId(holdId);
  if (hold === null || hold.harnessId !== scene.request.harnessId || hold.status !== 'held') {
    return refused('malformed_command', { why: 'hold_not_found', holdId });
  }
  return drafted(scene, { kind: 'calendar_hold_removed', payload: { holdId } });
}

export async function releaseHold(
  ports: DraftPorts,
  caller: Caller,
  input: ReleaseHoldInput,
): Promise<KernelOutcome<DraftedEffect>> {
  const parsed = verbIo.release_hold.input.safeParse({ holdId: input.holdId });
  if (!parsed.success || !addressed(input)) {
    return refused('malformed_command', { why: 'hold_input' });
  }
  const context = recordContext(ports, caller, ports.clock.now());
  return ports.store.transaction(async (tx) => {
    const scene = await turnSceneOf(tx, ports, context, caller, input);
    return 'status' in scene ? scene : releaseIn(scene, parsed.data.holdId);
  });
}
