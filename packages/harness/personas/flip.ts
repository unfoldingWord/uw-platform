import { draft, recordContext, recordHarnessEvents } from '../items/record.ts';
import { lockKeys } from '../lock-keys.ts';
import { accepted, refused, type KernelOutcome, type Refused } from '../outcome.ts';
import type { StoreTransaction } from '../ports.ts';
import { dryRun } from './dry-run.ts';
import type { ActivatedPersona, Activation, Persona, PersonaPorts } from './types.ts';

async function dryRunRefusal(
  ports: PersonaPorts,
  tx: StoreTransaction,
  activation: Activation,
  persona: Persona,
): Promise<Refused | null> {
  const { identity } = persona.frontmatter;
  const found = await dryRun({
    identity,
    frontmatter: persona.frontmatter,
    body: persona.page.bodyMd,
  });
  if (found === null) return null;
  await tx.lock(lockKeys.harnessEvents(persona.harness.id));
  const context = recordContext(ports, activation.caller, activation.at);
  await recordHarnessEvents(tx, context, persona.harness.id, [
    draft('persona_activation_failed', {
      pageId: persona.page.id,
      persona: identity,
      verb: null,
      engine: null,
      reason: 'dry_run_failed',
      message: found.message,
      itemId: null,
    }),
  ]);
  return refused('dry_run_failed', { message: found.message });
}

async function identityInUse(tx: StoreTransaction, persona: Persona): Promise<boolean> {
  const { identity } = persona.frontmatter;
  await tx.lock(lockKeys.personaIdentity(identity));
  const row = await tx.personas.read.byIdentity(identity);
  if (row === null || row.pageId === persona.page.id) return false;
  const [holder] = await tx.pages.read.facts([row.pageId]);
  return (
    holder?.type === 'persona' &&
    holder.status === 'active' &&
    holder.frontmatter['identity'] === identity
  );
}

async function flip(
  ports: PersonaPorts,
  tx: StoreTransaction,
  activation: Activation,
  persona: Persona,
): Promise<KernelOutcome<ActivatedPersona>> {
  const { page, harness, frontmatter } = persona;
  const { identity } = frontmatter;
  const flipped = await tx.pages.write.activatePersona({
    pageId: page.id,
    expectedVersion: activation.expectedVersion,
    editSource: activation.caller.actor.identity,
    traceId: activation.caller.traceId,
  });
  if (flipped === null) return refused('stale_version', { pageId: page.id, version: page.version });
  await tx.personas.write.upsert({ identity, harnessId: harness.id, pageId: page.id });
  await tx.lock(lockKeys.harnessEvents(harness.id));
  const context = recordContext(ports, activation.caller, activation.at);
  await recordHarnessEvents(tx, context, harness.id, [
    draft('persona_activated', { pageId: page.id, persona: identity, version: flipped.version }),
  ]);
  return accepted({
    pageId: page.id,
    persona: identity,
    harnessId: harness.id,
    version: flipped.version,
  });
}

export async function dryRunThenFlip(
  ports: PersonaPorts,
  tx: StoreTransaction,
  activation: Activation,
  persona: Persona,
): Promise<KernelOutcome<ActivatedPersona>> {
  const failed = await dryRunRefusal(ports, tx, activation, persona);
  if (failed !== null) return failed;
  if (await identityInUse(tx, persona)) return refused('not_permitted', { why: 'identity_in_use' });
  return flip(ports, tx, activation, persona);
}
