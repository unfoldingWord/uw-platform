import { pullRequestRefSchema, type Harness, type ItemState, type Stage } from '@uw/contracts';
import type { Caller } from '../caller.ts';
import { fullSha } from '../github/identifiers.ts';
import { requestsPlatformReviewer } from '../github/reviewers.ts';
import { lockKeys } from '../lock-keys.ts';
import { accepted, refused, type KernelOutcome } from '../outcome.ts';
import type { Ports, PullRequestRef, StoreTransaction } from '../ports.ts';
import { hasPackageStage } from '../stages/package.ts';
import { dispatchRefusal } from './dispatch.ts';
import { isImportPrincipal } from './import.ts';
import { createItem, recordContext, type RecordContext } from './record.ts';

type JoinPorts = Pick<Ports, 'clock' | 'ids' | 'store'>;

export type JoinInput = {
  readonly pullRequest: PullRequestRef;
  readonly head: string;
  readonly title: string;
  readonly requestedReviewers: readonly string[];
};
export type Joined = { readonly item: ItemState; readonly created: boolean };

type Joining = {
  readonly context: RecordContext;
  readonly input: JoinInput;
  readonly head: string;
};

const CHECK_STAGE = 'check';
const TITLE_LIMIT = 200;

function titleOf(input: JoinInput): string {
  const trimmed = input.title.trim().slice(0, TITLE_LIMIT);
  return trimmed === '' ? `${input.pullRequest.repo}#${input.pullRequest.number}` : trimmed;
}

async function joinedItem(
  tx: StoreTransaction,
  joining: Joining,
  harness: Harness,
  check: Stage,
): Promise<KernelOutcome<Joined>> {
  const { input, context, head } = joining;
  const { pullRequest } = input;
  const existing = await tx.harnessItems.read.byPullRequest(harness.id, pullRequest);
  if (existing !== null) return accepted({ item: existing, created: false });
  const recorded = await createItem(tx, context, {
    itemId: context.ids.next(),
    harnessId: harness.id,
    stageKey: check.key,
    title: titleOf(input),
    pageId: null,
    priority: 0,
    due: null,
    issue: null,
    pullRequest: { repo: pullRequest.repo, number: pullRequest.number },
    expectedHead: head,
  });
  return accepted({ item: recorded.item, created: true });
}

async function joinIn(tx: StoreTransaction, joining: Joining): Promise<KernelOutcome<Joined>> {
  const repository = joining.input.pullRequest.repo;
  const found = await tx.harnesses.read.byRepository(repository);
  if (found === null) return refused('no_harness_for_repo', { repository });
  await tx.lock(lockKeys.harnessStages(found.id));
  const harness = await tx.harnesses.read.byId(found.id);
  if (harness === null) return refused('no_harness_for_repo', { repository });
  const stages = await tx.harnessStages.read.forHarness(harness.id);
  if (hasPackageStage(stages)) {
    return refused('transition_not_allowed', { why: 'harness_has_package', harnessId: harness.id });
  }
  const check = stages.find((stage) => stage.key === CHECK_STAGE);
  if (check === undefined) return refused('stage_not_found', { stage: CHECK_STAGE });
  const undispatchable = await dispatchRefusal(tx, harness);
  if (undispatchable !== null) return undispatchable;
  return joinedItem(tx, joining, harness, check);
}

export async function joinByReviewRequest(
  ports: JoinPorts,
  caller: Caller,
  input: JoinInput,
): Promise<KernelOutcome<Joined>> {
  if (!isImportPrincipal(caller.actor)) {
    return refused('not_permitted', { actor: caller.actor.identity });
  }
  const head = fullSha(input.head);
  if (head === null || !pullRequestRefSchema.safeParse(input.pullRequest).success) {
    return refused('malformed_command', { field: 'pullRequest' });
  }
  if (!requestsPlatformReviewer(input.requestedReviewers)) {
    return refused('not_permitted', { why: 'reviewer_not_requested' });
  }
  const context = recordContext(ports, caller, ports.clock.now());
  return ports.store.transaction((tx) => joinIn(tx, { context, input, head }));
}
