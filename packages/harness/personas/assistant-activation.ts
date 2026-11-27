import { personaFrontmatterSchema, personaSlugOf, verbRegistry } from '@uw/contracts';
import { isProvisionerPrincipal } from '../access.ts';
import type { Caller } from '../caller.ts';
import { lockKeys } from '../lock-keys.ts';
import { refused, type KernelOutcome } from '../outcome.ts';
import type { Ports, StoreTransaction } from '../ports.ts';
import { dryRunThenFlip } from './flip.ts';
import { personaHarnessRefusal } from './harness-guard.ts';
import { forbiddenFinding, servedVerbs, unknownFinding } from './tool-check.ts';
import type { ActivatedPersona, Activation, Persona } from './types.ts';

type ActivationPorts = Pick<Ports, 'clock' | 'grants' | 'ids' | 'store'>;

export type AssistantActivationInput = {
  readonly harnessId: string;
  readonly pageId: string;
  readonly expectedVersion: number;
};

async function assistantPersona(
  tx: StoreTransaction,
  input: AssistantActivationInput,
): Promise<Persona | null> {
  const [page] = await tx.pages.read.facts([input.pageId]);
  const harness = await tx.harnesses.read.byId(input.harnessId);
  if (page?.type !== 'persona' || harness === null || harness.personId === null) return null;
  if (page.jdArea !== harness.jdArea) return null;
  const parsed = personaFrontmatterSchema.safeParse(page.frontmatter);
  if (!parsed.success || parsed.data.harness !== harness.id) return null;
  if (personaHarnessRefusal(parsed.data.identity, harness) !== null) return null;
  return { page, frontmatter: parsed.data, harness };
}

function toolRefusal(persona: Persona) {
  const { identity, toolset, requires_tools: required } = persona.frontmatter;
  const named = {
    personaSlug: personaSlugOf(identity) ?? identity,
    verbs: [...new Set([...required, ...toolset])],
  };
  const found = forbiddenFinding(named) ?? unknownFinding(named, servedVerbs(verbRegistry));
  return found === null ? null : refused(found.reason, { verb: found.verb });
}

async function activateIn(
  ports: ActivationPorts,
  tx: StoreTransaction,
  activation: Activation,
): Promise<KernelOutcome<ActivatedPersona>> {
  await tx.lock(lockKeys.personaActivation(activation.pageId));
  const persona = await assistantPersona(tx, activation);
  if (persona === null) return refused('page_not_found', { pageId: activation.pageId });
  if (persona.page.version !== activation.expectedVersion) {
    return refused('stale_version', { pageId: persona.page.id, version: persona.page.version });
  }
  if (persona.page.status !== 'suggested') {
    return refused('not_permitted', { why: 'not_suggested' });
  }
  return toolRefusal(persona) ?? dryRunThenFlip(ports, tx, activation, persona);
}

export async function activateAssistantPersona(
  ports: ActivationPorts,
  caller: Caller,
  input: AssistantActivationInput,
): Promise<KernelOutcome<ActivatedPersona>> {
  if (!isProvisionerPrincipal(caller.actor)) {
    return refused('not_permitted', { actor: caller.actor.identity });
  }
  const activation = { caller, ...input, at: ports.clock.now(), registry: verbRegistry };
  return ports.store.transaction((tx) => activateIn(ports, tx, activation));
}
