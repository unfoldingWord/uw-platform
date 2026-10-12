import { delegationIdOf, identitySchema, personaSlugOf, type Identity } from '@uw/contracts';
import { bareAgent } from '../access.ts';
import type { PageFacts, StoreTransaction } from '../ports.ts';

export function personaIdentityFor(identity: string): Identity | null {
  const slug = personaSlugOf(identity);
  if (slug === null) return null;
  if (!bareAgent(identity) && delegationIdOf(identity) === null) return null;
  const persona = identitySchema.safeParse(`agent:${slug}`);
  return persona.success ? persona.data : null;
}

export function activePersonaOn(
  tx: StoreTransaction,
  identity: Identity,
  harnessId: string,
): Promise<PageFacts | null> {
  return tx.personas.read.active(identity, harnessId);
}
