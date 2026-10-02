import {
  eventEvidenceSchemas,
  type Harness,
  type HarnessEvent,
  type IssueRef,
  type ItemState,
  type JdArea,
  type Principal,
} from '@uw/contracts';
import { allowed, isAgent, isIngestPrincipal, isSystemPrincipal } from '../access.ts';
import type { Caller } from '../caller.ts';
import { sameRepository } from '../github/identifiers.ts';
import { lockKeys } from '../lock-keys.ts';
import { accepted, refused, type KernelOutcome } from '../outcome.ts';
import type { Ports, StoreTransaction } from '../ports.ts';
import { enqueueIn } from './enqueue.ts';
import { draft, readAllEvents, recordContext, recordItemEvents } from './record.ts';

type ImportPorts = Pick<Ports, 'clock' | 'grants' | 'ids' | 'store'>;

export type ImportIssueInput = {
  readonly harnessId: string;
  readonly issue: IssueRef;
  readonly title: string;
  readonly pageId: string | null;
};
export type Imported = { readonly item: ItemState; readonly created: boolean };
export type LabelRemovedInput = {
  readonly githubId: number;
  readonly label: string;
  readonly githubUpdatedAt: string;
};
export type LabelRemoved = { readonly item: ItemState; readonly recorded: boolean };
export type ImportTarget = { readonly harnessId: string; readonly jdArea: JdArea };

export function isImportPrincipal(actor: Principal): boolean {
  return isIngestPrincipal(actor) || isSystemPrincipal(actor);
}

async function mayWrite(
  ports: ImportPorts,
  tx: StoreTransaction,
  actor: Principal,
  harness: Harness,
  at: Date,
): Promise<boolean> {
  if (isImportPrincipal(actor)) return true;
  if (actor.personId === null) return false;
  const grants = await ports.grants.resolveIn(tx, actor.personId, at);
  return allowed({ ...actor, grants: [...grants] }, 'write', harness, at);
}

export async function importIssue(
  ports: ImportPorts,
  caller: Caller,
  input: ImportIssueInput,
): Promise<KernelOutcome<Imported>> {
  const { harnessId, issue } = input;
  if (isAgent(caller.actor) && !isImportPrincipal(caller.actor)) {
    return refused('not_permitted', { harnessId });
  }
  const at = ports.clock.now();
  return ports.store.transaction(async (tx) => {
    await tx.lock(lockKeys.githubIssue(issue.githubId));
    const harness = await tx.harnesses.read.byId(harnessId);
    if (harness === null) return refused('harness_not_found', { harnessId });
    if (!(await mayWrite(ports, tx, caller.actor, harness, at))) {
      return refused('not_permitted', { harnessId });
    }
    if (!sameRepository(issue.repo, harness.repository)) {
      return refused('not_permitted', { harnessId, why: 'repository_mismatch' });
    }
    const existing = await tx.harnessItems.read.byIssue(issue.githubId);
    if (existing !== null && existing.harnessId !== harness.id) {
      return refused('not_permitted', { harnessId, why: 'repository_mismatch' });
    }
    if (existing !== null) return accepted({ item: existing, created: false });
    const context = recordContext(ports, caller, at);
    const { title, pageId } = input;
    const recorded = await enqueueIn(tx, context, harness, {
      title,
      pageId,
      priority: 0,
      due: null,
      issue,
    });
    if (recorded.status !== 'accepted') return recorded;
    return accepted({ item: recorded.value.item, created: true });
  });
}

function removedBefore(events: readonly HarnessEvent[], label: string): boolean {
  const folded = label.toLowerCase();
  return events.some((event) => {
    const recorded = event.evidence['label'];
    return (
      event.name === 'label_removed' &&
      typeof recorded === 'string' &&
      recorded.toLowerCase() === folded
    );
  });
}

function malformedField(input: LabelRemovedInput): string | null {
  const { shape } = eventEvidenceSchemas.label_removed;
  if (!shape.label.safeParse(input.label).success) return 'label';
  if (!shape.githubUpdatedAt.safeParse(input.githubUpdatedAt).success) return 'githubUpdatedAt';
  return null;
}

export async function labelRemoved(
  ports: ImportPorts,
  caller: Caller,
  input: LabelRemovedInput,
): Promise<KernelOutcome<LabelRemoved>> {
  const { githubId, label, githubUpdatedAt } = input;
  if (!isImportPrincipal(caller.actor)) return refused('not_permitted', { githubId });
  const field = malformedField(input);
  if (field !== null) return refused('malformed_command', { githubId, field });
  const at = ports.clock.now();
  return ports.store.transaction(async (tx) => {
    await tx.lock(lockKeys.githubIssue(githubId));
    const found = await tx.harnessItems.read.byIssue(githubId);
    const item = found === null ? null : await tx.harnessItems.read.lock(found.itemId);
    if (item?.issue == null) return refused('item_not_found', { githubId });
    const events = await readAllEvents(tx, item.harnessId, item.itemId);
    if (removedBefore(events, label)) return accepted({ item, recorded: false });
    const context = recordContext(ports, caller, at);
    const recorded = await recordItemEvents(tx, context, item.itemId, [
      draft('label_removed', { issue: item.issue, label, githubUpdatedAt }),
    ]);
    return accepted({ item: recorded.item, recorded: true });
  });
}
