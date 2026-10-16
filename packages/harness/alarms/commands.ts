import type { Harness } from '@uw/contracts';
import { isSystemPrincipal } from '../access.ts';
import type { Caller } from '../caller.ts';
import { draft, recordContext, recordHarnessEvents } from '../items/record.ts';
import { lockKeys } from '../lock-keys.ts';
import { COOLDOWN_MS } from '../notify/rank.ts';
import { accepted, refused, type KernelOutcome } from '../outcome.ts';
import type { Ports } from '../ports.ts';
import { silenceOf } from './silence.ts';

type AlarmPorts = Pick<Ports, 'clock' | 'githubFacts' | 'ids' | 'store'>;

export type SoundInput = { readonly limit: number };
export type Sounded = { readonly sounded: readonly string[] };
export type AlarmCommands = {
  soundSilence(caller: Caller, input: SoundInput): Promise<KernelOutcome<Sounded>>;
};

const SOUND_LIMIT = 200;

function soundOne(ports: AlarmPorts, caller: Caller, harness: Harness, at: Date): Promise<boolean> {
  return ports.store.transaction(async (tx) => {
    await tx.lock(lockKeys.harnessEvents(harness.id));
    const silence = await silenceOf(ports, tx, harness, at);
    const [oldest] = [...silence.waiting].sort(
      (a, b) => a.enteredAt.getTime() - b.enteredAt.getTime(),
    );
    if (silence.level !== 'red' || oldest === undefined) return false;
    const recent = await tx.harnessEvents.read.recent({
      since: new Date(at.getTime() - COOLDOWN_MS),
      names: ['silence_alarm'],
      agentsOnly: false,
      limit: 1,
      harnessIds: [harness.id],
    });
    if (recent.length > 0) return false;
    await recordHarnessEvents(tx, recordContext(ports, caller, at), harness.id, [
      draft('silence_alarm', {
        level: 'red',
        waiting: silence.waiting.length,
        oldestEnteredAt: oldest.enteredAt.toISOString(),
        lastReviewStepAt: silence.lastReviewStepAt?.toISOString() ?? null,
      }),
    ]);
    return true;
  });
}

async function soundSilence(
  ports: AlarmPorts,
  caller: Caller,
  input: SoundInput,
): Promise<KernelOutcome<Sounded>> {
  if (!isSystemPrincipal(caller.actor)) {
    return refused('not_permitted', { actor: caller.actor.identity });
  }
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > SOUND_LIMIT) {
    return refused('malformed_command', { why: 'limit' });
  }
  const at = ports.clock.now();
  const harnesses = await ports.store.transaction((tx) => tx.harnesses.read.list());
  const sounded: string[] = [];
  for (const harness of harnesses.slice(0, input.limit)) {
    if (await soundOne(ports, caller, harness, at)) sounded.push(harness.id);
  }
  return accepted({ sounded });
}

export function createAlarmCommands(ports: AlarmPorts): AlarmCommands {
  return { soundSilence: (caller, input) => soundSilence(ports, caller, input) };
}
