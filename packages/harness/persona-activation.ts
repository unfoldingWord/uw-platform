import type { VerbDefinition } from '@uw/contracts';
import { livePorts } from './kernel.ts';
import { createPersonaCommands, type PersonaCommands } from './personas/commands.ts';
import type { Ports } from './ports.ts';

export type { PersonaCommands };

export function createPersonaActivation(
  ports: Ports,
  registry?: readonly VerbDefinition[],
): PersonaCommands {
  return createPersonaCommands(livePorts(ports), registry);
}
