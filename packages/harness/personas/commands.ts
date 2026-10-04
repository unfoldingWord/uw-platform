import { verbRegistry, type VerbDefinition } from '@uw/contracts';
import type { Caller } from '../caller.ts';
import type { KernelOutcome } from '../outcome.ts';
import type { Ports } from '../ports.ts';
import { agentRefusal } from '../stages/rules.ts';
import { activateIn } from './activate.ts';
import type { ActivatedPersona } from './types.ts';

type ActivateInput = {
  readonly pageId: string;
  readonly expectedVersion: number;
  readonly harnessId: string;
};

export type PersonaCommands = {
  activate(caller: Caller, input: ActivateInput): Promise<KernelOutcome<ActivatedPersona>>;
};

export function createPersonaCommands(
  ports: Pick<Ports, 'clock' | 'grants' | 'ids' | 'store'>,
  registry: readonly VerbDefinition[] = verbRegistry,
): PersonaCommands {
  return {
    activate: async (caller, input) => {
      const at = ports.clock.now();
      const agent = agentRefusal(caller);
      if (agent !== null) return agent;
      const activation = { caller, ...input, at, registry };
      return ports.store.transaction((tx) => activateIn(ports, tx, activation));
    },
  };
}
