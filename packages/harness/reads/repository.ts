import { allowed, isAgent } from '../access.ts';
import type { Caller } from '../caller.ts';
import { isImportPrincipal, type ImportTarget } from '../items/import.ts';
import { accepted, refused, type KernelOutcome } from '../outcome.ts';
import type { Ports, StoreTransaction } from '../ports.ts';

type RepositoryPorts = Pick<Ports, 'grants'>;

export async function importTarget(
  ports: RepositoryPorts,
  tx: StoreTransaction,
  caller: Caller,
  repository: string,
  at: Date,
): Promise<KernelOutcome<ImportTarget>> {
  const { actor } = caller;
  const hidden = refused('harness_not_found', { repository });
  if (isAgent(actor) && !isImportPrincipal(actor)) return hidden;
  const harness = await tx.harnesses.read.byRepository(repository);
  if (harness === null) return hidden;
  if (!isImportPrincipal(actor)) {
    if (actor.personId === null) return hidden;
    const grants = await ports.grants.resolveIn(tx, actor.personId, at);
    if (!allowed({ ...actor, grants: [...grants] }, 'read', harness, at)) return hidden;
  }
  return accepted({ harnessId: harness.id, jdArea: harness.jdArea });
}

export async function issueImported(
  tx: StoreTransaction,
  caller: Caller,
  githubId: number,
): Promise<KernelOutcome<boolean>> {
  if (!isImportPrincipal(caller.actor)) return refused('not_permitted', { githubId });
  return accepted((await tx.harnessItems.read.byIssue(githubId)) !== null);
}
