import {
  eventEvidenceSchemas,
  type HarnessEvent,
  type ItemState,
  type PullRequestDeclaration,
  type Stage,
} from '@uw/contracts';
import { diffStat, type DiffStat } from '../github/diff-stat.ts';
import { sameRepository } from '../github/identifiers.ts';
import { refused, type Refused } from '../outcome.ts';
import type {
  DiffRange,
  DiffRead,
  Ports,
  PullRequestFacts,
  PullRequestRef,
  StoreTransaction,
} from '../ports.ts';
import { endRunDrafts } from '../runs/ends.ts';
import type { FixContext } from '../validators/context.ts';
import { FIX_VALIDATORS, runValidators } from '../validators/registry.ts';
import { draft, readAllEvents, recordItemEvents, type RecordContext } from './record.ts';

type DiffPorts = Pick<Ports, 'githubFacts' | 'store'>;

export type FixDiffs = {
  readonly start: string | null;
  readonly pull: DiffRead | null;
  readonly fix: DiffRead | null;
  readonly samePullRequest: boolean;
};

export type FixSubmission = {
  readonly item: ItemState;
  readonly stage: Stage;
  readonly context: RecordContext;
  readonly diffs: FixDiffs;
  readonly facts: PullRequestFacts | null;
};

const FIX_DIFF_BUDGET = 1_000_000;
export const unreadFix: FixDiffs = { start: null, pull: null, fix: null, samePullRequest: true };

type FixChange = { readonly head: string; readonly pullRequest: PullRequestRef };

async function fixClaimOn(ports: DiffPorts, itemId: string): Promise<ItemState | null> {
  return ports.store.transaction(async (tx) => {
    const item = await tx.harnessItems.read.byId(itemId);
    if (item === null || item.delegationId === null) return null;
    const delegation = await tx.delegations.read.byId(item.delegationId);
    return delegation?.capability === 'fix' ? item : null;
  });
}

async function readDiff(
  ports: DiffPorts,
  ref: PullRequestRef,
  range: DiffRange,
): Promise<DiffRead> {
  try {
    return await ports.githubFacts.diff(ref, range, FIX_DIFF_BUDGET);
  } catch {
    return { kind: 'unavailable', reason: 'diff_failed' };
  }
}

export async function readFixDiffs(
  ports: DiffPorts,
  itemId: string,
  change: FixChange | null,
  facts: PullRequestFacts | null,
): Promise<FixDiffs | null> {
  const item = await fixClaimOn(ports, itemId);
  if (item === null) return null;
  const start = item.expectedHead;
  const ref = item.pullRequest;
  const samePullRequest = ref === null || change === null || samePull(ref, change.pullRequest);
  if (start === null || ref === null || change === null || facts === null) {
    return { ...unreadFix, start, samePullRequest };
  }
  return {
    start,
    samePullRequest,
    pull: await readDiff(ports, ref, { base: facts.base, head: start }),
    fix: await readDiff(ports, ref, { base: start, head: change.head }),
  };
}

function samePull(item: PullRequestRef, named: PullRequestRef): boolean {
  return sameRepository(named.repo, item.repo) && named.number === item.number;
}

function measured(read: DiffRead | null): DiffStat | null {
  return read?.kind === 'diff' ? diffStat(read.text) : null;
}

function claimedDeclaration(events: readonly HarnessEvent[]) {
  const claimed = events.findLast((event) => event.name === 'fix_claimed');
  if (claimed === undefined) return { claimed: false, declared: null, head: null };
  const evidence = eventEvidenceSchemas.fix_claimed.parse(claimed.evidence);
  const declared: PullRequestDeclaration | null = evidence.declaration;
  return { claimed: true, declared, head: evidence.head };
}

function fixContextOf(submission: FixSubmission, events: readonly HarnessEvent[]): FixContext {
  const { diffs, item, facts } = submission;
  const { claimed, declared, head } = claimedDeclaration(events);
  const same = diffs.start !== null && diffs.start === head && diffs.start === item.expectedHead;
  return {
    pull: same ? measured(diffs.pull) : null,
    fix: same ? measured(diffs.fix) : null,
    declaration: facts?.declaration ?? null,
    claimed,
    declared,
    samePullRequest: diffs.samePullRequest,
  };
}

async function refuseFix(
  tx: StoreTransaction,
  submission: FixSubmission,
  failures: readonly string[],
): Promise<Refused> {
  const { item, stage, context } = submission;
  const ending = await endRunDrafts(tx, item, {
    outcome: 'stopped',
    why: 'released',
    at: context.at,
  });
  const released = item.holder === null ? [] : [draft('item_released', { holder: item.holder })];
  await recordItemEvents(tx, context, item.itemId, [
    draft('checks_failed', { stage: stage.key, failures: [...failures] }),
    ...released,
    ...ending.drafts,
  ]);
  const reason = failures.some((failure) => failure.startsWith('fix_size_cap'))
    ? 'fix_size_cap'
    : 'fix_keeps_purpose';
  return refused(reason, { stage: stage.key, failures: [...failures] });
}

export async function fixRefusal(
  tx: StoreTransaction,
  submission: FixSubmission,
): Promise<Refused | null> {
  const { item } = submission;
  const events = await readAllEvents(tx, item.harnessId, item.itemId);
  const fix = fixContextOf(submission, events);
  const failures = runValidators(FIX_VALIDATORS, {
    item,
    events,
    pages: new Map(),
    attaching: [],
    fix,
  });
  return failures.length === 0 ? null : refuseFix(tx, submission, failures);
}
