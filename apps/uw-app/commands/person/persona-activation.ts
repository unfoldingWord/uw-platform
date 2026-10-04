import type { Clock } from '@uw/harness';
import { createPersonaActivation, type PersonaCommands } from '@uw/harness/persona-activation';
import type { DatabaseHandle } from '../../database.ts';
import { hubWiring, platformPorts, type LiveWiring } from '../../kernel.ts';

export function personaActivation(
  database: DatabaseHandle,
  clock: Clock,
  live: LiveWiring,
): PersonaCommands {
  const wiring = hubWiring(live.hub, { runs: live.runs, notifier: live.notifier });
  return createPersonaActivation(platformPorts(database, clock, wiring));
}
