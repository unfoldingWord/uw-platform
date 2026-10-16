import type { EpicPlace, Harness, ItemState } from '@uw/contracts';
import { isAgent } from '../access.ts';
import type { Caller } from '../caller.ts';
import { sameRepository } from '../github/identifiers.ts';
import { lockKeys } from '../lock-keys.ts';
import { accepted, refused, type KernelOutcome, type Refused } from '../outcome.ts';
import type { EpicFacts, IssueFact, IssueKey, Ports, StoreTransaction } from '../ports.ts';
import { blockerCycle } from './blockers.ts';
import { enqueueIn } from './enqueue.ts';
import { intakeWriter, recordNotReadyIn } from './not-ready.ts';
import { draft, recordContext, recordHarnessEvents, type RecordContext } from './record.ts';

type EpicPorts = Pick<Ports, 'clock' | 'githubFacts' | 'grants' | 'ids' | 'store'>;

export type EnqueueEpicInput = { readonly harnessId: string; readonly epic: IssueKey };
export type EpicEnqueued = { readonly items: readonly ItemState[]; readonly created: number };

type Planned = {
  readonly fact: IssueFact;
  readonly position: number;
  readonly itemId: string;
  readonly existing: ItemState | null;
};
type Edges = {
  readonly blockedBy: ReadonlyMap<number, readonly string[]>;
  readonly outside: readonly number[];
};
type Work = { readonly facts: EpicFacts; readonly plan: readonly Planned[]; readonly edges: Edges };

const TITLE_LIMIT = 200;
const DONE_WHEN_LIMIT = 100;

function titleOf(fact: IssueFact): string {
  const trimmed = fact.title.trim().slice(0, TITLE_LIMIT);
  return trimmed === '' ? `${fact.issue.repo}#${fact.issue.number}` : trimmed;
}

function shapeRefusal(facts: EpicFacts): Refused | null {
  if (facts.subIssueCount === 0) return refused('not_permitted', { why: 'not_an_epic' });
  if (facts.subIssues.length !== facts.subIssueCount) {
    return refused('not_permitted', { why: 'sub_issues_not_read' });
  }
  return null;
}

async function missingDoneWhen(
  tx: StoreTransaction,
  context: RecordContext,
  harnessId: string,
  fresh: readonly IssueFact[],
): Promise<Refused | null> {
  const missing = fresh.filter((fact) => fact.doneWhen.length === 0);
  for (const fact of missing) {
    const subject = {
      via: 'enqueue_epic' as const,
      issue: fact.issue,
      pageId: null,
      title: titleOf(fact),
    };
    await recordNotReadyIn(tx, context, harnessId, subject);
  }
  if (missing.length === 0) return null;
  return refused('done_when_missing', { issues: missing.map((fact) => `#${fact.issue.number}`) });
}

async function planned(
  tx: StoreTransaction,
  context: RecordContext,
  harness: Harness,
  facts: EpicFacts,
): Promise<readonly Planned[] | Refused> {
  const open = facts.subIssues.flatMap((fact, position) => (fact.open ? [{ fact, position }] : []));
  for (const githubId of open.map(({ fact }) => fact.issue.githubId).sort((a, b) => a - b)) {
    await tx.lock(lockKeys.githubIssue(githubId));
  }
  const plan: Planned[] = [];
  for (const { fact, position } of open) {
    const existing = await tx.harnessItems.read.byIssue(fact.issue.githubId);
    if (existing !== null && existing.harnessId !== harness.id) {
      return refused('not_permitted', { harnessId: harness.id, why: 'repository_mismatch' });
    }
    plan.push({ fact, position, itemId: existing?.itemId ?? context.ids.next(), existing });
  }
  return plan;
}

async function heldOutside(
  tx: StoreTransaction,
  harness: Harness,
  plan: readonly Planned[],
): Promise<ReadonlyMap<number, string>> {
  const inside = new Set(plan.map((entry) => entry.fact.issue.number));
  const named = new Set(plan.flatMap((entry) => entry.fact.blockedBy));
  if ([...named].every((number) => inside.has(number))) return new Map();
  const items = await tx.harnessItems.read.forHarness(harness.id);
  return new Map(
    items.flatMap((item) =>
      item.issue !== null &&
      named.has(item.issue.number) &&
      !inside.has(item.issue.number) &&
      sameRepository(item.issue.repo, harness.repository)
        ? [[item.issue.number, item.itemId] as const]
        : [],
    ),
  );
}

function edgesOf(
  plan: readonly Planned[],
  facts: EpicFacts,
  held: ReadonlyMap<number, string>,
): Edges {
  const itemOf = new Map(plan.map((entry) => [entry.fact.issue.number, entry.itemId]));
  const closed = new Set(
    facts.subIssues.filter((fact) => !fact.open).map((fact) => fact.issue.number),
  );
  const outside = new Set<number>();
  const blockedBy = new Map<number, readonly string[]>();
  for (const { fact } of plan) {
    const named = fact.blockedBy.filter((number) => !closed.has(number));
    for (const number of named.filter((entry) => !itemOf.has(entry) && !held.has(entry))) {
      outside.add(number);
    }
    blockedBy.set(
      fact.issue.number,
      named.flatMap((number) => itemOf.get(number) ?? held.get(number) ?? []),
    );
  }
  return { blockedBy, outside: [...outside].sort((a, b) => a - b) };
}

function cycleIn(plan: readonly Planned[]): readonly number[] {
  const numbers = new Set(plan.map((entry) => entry.fact.issue.number));
  const edges = new Map(
    plan.map((entry) => [
      entry.fact.issue.number,
      entry.fact.blockedBy.filter((number) => numbers.has(number)),
    ]),
  );
  return blockerCycle(edges);
}

function unionOf(facts: readonly IssueFact[]): readonly string[] {
  return [...new Set(facts.flatMap((fact) => fact.doneWhen))].slice(0, DONE_WHEN_LIMIT);
}

async function createAll(
  tx: StoreTransaction,
  context: RecordContext,
  harness: Harness,
  work: Work,
): Promise<KernelOutcome<EpicEnqueued>> {
  const place: Omit<EpicPlace, 'position'> = {
    issue: work.facts.epic.issue,
    title: titleOf(work.facts.epic),
  };
  const itemContext = { ...context, requestId: null };
  const items: ItemState[] = [];
  for (const entry of work.plan) {
    if (entry.existing !== null) {
      items.push(entry.existing);
      continue;
    }
    const recorded = await enqueueIn(tx, itemContext, harness, {
      itemId: entry.itemId,
      title: titleOf(entry.fact),
      pageId: null,
      priority: null,
      due: null,
      issue: entry.fact.issue,
      epic: { ...place, position: entry.position },
      blockedBy: work.edges.blockedBy.get(entry.fact.issue.number) ?? [],
    });
    if (recorded.status !== 'accepted') return recorded;
    items.push(recorded.value.item);
  }
  return accepted({ items, created: work.plan.filter((entry) => entry.existing === null).length });
}

async function recordEnqueued(
  tx: StoreTransaction,
  context: RecordContext,
  harnessId: string,
  work: Work,
): Promise<void> {
  const items = work.plan.map((entry) => ({
    itemId: entry.itemId,
    issue: entry.fact.issue,
    created: entry.existing === null,
    blockedBy: [...(work.edges.blockedBy.get(entry.fact.issue.number) ?? [])],
  }));
  const evidence = {
    epic: work.facts.epic.issue,
    title: titleOf(work.facts.epic),
    items,
    outside: [...work.edges.outside],
    doneWhen: [...unionOf(work.plan.map((entry) => entry.fact))],
  };
  await recordHarnessEvents(tx, context, harnessId, [draft('epic_enqueued', evidence)]);
}

async function admitted(
  ports: EpicPorts,
  tx: StoreTransaction,
  caller: Caller,
  facts: EpicFacts,
  input: { readonly harnessId: string; readonly at: Date },
): Promise<Harness | Refused> {
  const harness = await tx.harnesses.read.byId(input.harnessId);
  if (harness === null) return refused('harness_not_found', { harnessId: input.harnessId });
  if (!(await intakeWriter(ports, tx, caller.actor, harness, input.at))) {
    return refused('not_permitted', { harnessId: harness.id });
  }
  if (!sameRepository(facts.epic.issue.repo, harness.repository)) {
    return refused('not_permitted', { harnessId: harness.id, why: 'repository_mismatch' });
  }
  return harness;
}

async function enqueueEpicIn(
  ports: EpicPorts,
  tx: StoreTransaction,
  caller: Caller,
  facts: EpicFacts,
  input: { readonly harnessId: string; readonly at: Date },
): Promise<KernelOutcome<EpicEnqueued>> {
  const harness = await admitted(ports, tx, caller, facts, input);
  if ('status' in harness) return harness;
  const context = recordContext(ports, caller, input.at);
  const plan = await planned(tx, context, harness, facts);
  if ('status' in plan) return plan;
  const fresh = plan.flatMap((entry) => (entry.existing === null ? [entry.fact] : []));
  const missing = await missingDoneWhen(tx, context, harness.id, fresh);
  if (missing !== null) return missing;
  const cycle = cycleIn(plan);
  if (cycle.length > 0) {
    return refused('malformed_command', {
      why: 'blocker_cycle',
      issues: cycle.map((number) => `#${number}`),
    });
  }
  const work = { facts, plan, edges: edgesOf(plan, facts, await heldOutside(tx, harness, plan)) };
  const created = await createAll(tx, context, harness, work);
  if (created.status === 'accepted' && created.value.created > 0) {
    await recordEnqueued(tx, context, harness.id, work);
  }
  return created;
}

export async function enqueueEpic(
  ports: EpicPorts,
  caller: Caller,
  input: EnqueueEpicInput,
): Promise<KernelOutcome<EpicEnqueued>> {
  if (isAgent(caller.actor)) return refused('not_permitted', { why: 'person_command' });
  const facts = await ports.githubFacts.epic(input.epic);
  if (facts === null) {
    return refused('issue_not_found', { repository: input.epic.repo, number: input.epic.number });
  }
  const shape = shapeRefusal(facts);
  if (shape !== null) return shape;
  const at = ports.clock.now();
  return ports.store.transaction((tx) =>
    enqueueEpicIn(ports, tx, caller, facts, { harnessId: input.harnessId, at }),
  );
}
