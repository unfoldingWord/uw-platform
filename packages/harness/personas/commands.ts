import { verbRegistry, type VerbDefinition } from '@uw/contracts';
import type { Caller } from '../caller.ts';
import type { KernelOutcome } from '../outcome.ts';
import type { Ports } from '../ports.ts';
import { agentRefusal } from '../stages/rules.ts';
import { activateIn } from './activate.ts';

export type PersonaCommands = {
  activate(caller: Caller, input: { readonly pageId: string }): Promise<KernelOutcome<never>>;
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
      const activation = { caller, pageId: input.pageId, at, registry };
      return ports.store.transaction((tx) => activateIn(ports, tx, activation));
    },
  };
}
