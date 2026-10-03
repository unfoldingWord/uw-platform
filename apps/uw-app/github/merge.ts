import { z } from 'zod';
import {
  fullSha,
  sameRepository,
  type ConnectorOutcome,
  type ConnectorRequest,
  type Connectors,
  type DecidedBase,
} from '@uw/harness';
import type { GitHubAppConfig } from './app-config.ts';
import type { GitHubFailure, GitHubResult } from './failures.ts';
import { commitOf } from './merge-commit.ts';
import { pullSchema } from './payloads.ts';
import { createShipWrites, type ShipWrites } from './ship-writes.ts';
import type { GitHubTransport } from './transport.ts';

export type MergeGitHub = { readonly app: GitHubAppConfig; readonly transport: GitHubTransport };

type Target = {
  readonly repo: string;
  readonly number: number;
  readonly itemId: string;
  readonly head: string;
  readonly base: DecidedBase | null;
  readonly repository: string;
  readonly title: string;
  readonly overrideReason: string | null;
};

type Live = {
  readonly merged: boolean;
  readonly open: boolean;
  readonly head: string | null;
  readonly headRef: string;
  readonly headRepo: string | null;
  readonly base: string | null;
  readonly baseRef: string;
  readonly defaultBranch: string | null;
  readonly mergeSha: string | null;
};

type Refusal = Extract<ConnectorOutcome, { outcome: 'refused' }>;

const kernelId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const liveBase = pullSchema.shape.base.extend({
  repo: z.object({ default_branch: z.string() }).nullable().optional(),
});
const livePull = pullSchema.extend({
  base: liveBase,
  merge_commit_sha: z.string().nullable().optional(),
});
const racedFailures: ReadonlySet<GitHubFailure> = new Set<GitHubFailure>([
  'conflict',
  'not_mergeable',
]);
const mergeRefusals = new Map<GitHubFailure, string>([
  ['conflict', 'head_mismatch'],
  ['not_mergeable', 'not_mergeable'],
]);

function refusal(reason: string): Refusal {
  return { outcome: 'refused', reason };
}

function isRefusal<T extends object>(value: T | Refusal): value is Refusal {
  return 'outcome' in value;
}

function decidedBase(base: DecidedBase | null): DecidedBase | null {
  const sha = base === null ? null : fullSha(base.sha);
  return base === null || sha === null || base.ref === '' ? null : { sha, ref: base.ref };
}

function targetOf(request: ConnectorRequest): Target | Refusal {
  const { pullRequest, repository, expectedHead, itemId } = request;
  if (!kernelId.test(itemId)) return refusal('malformed_request');
  if (repository === null) return refusal('repository_mismatch');
  if (pullRequest === null || expectedHead === null) return refusal('head_mismatch');
  if (!sameRepository(pullRequest.repo, repository)) return refusal('repository_mismatch');
  const head = fullSha(expectedHead);
  if (head === null) return refusal('head_mismatch');
  const base = decidedBase(request.expectedBase);
  const { title, overrideReason } = request;
  return { ...pullRequest, itemId, head, base, repository, title, overrideReason };
}

function liveOf(answer: unknown): Live | null {
  const parsed = livePull.safeParse(answer);
  if (!parsed.success) return null;
  const pull = parsed.data;
  return {
    merged: pull.merged === true || Boolean(pull.merged_at),
    open: pull.state === 'open',
    head: fullSha(pull.head.sha),
    headRef: pull.head.ref,
    headRepo: pull.head.repo?.full_name ?? null,
    base: fullSha(pull.base.sha),
    baseRef: pull.base.ref,
    defaultBranch: pull.base.repo?.default_branch ?? null,
    mergeSha: fullSha(pull.merge_commit_sha ?? ''),
  };
}

async function readLive(writes: ShipWrites, target: Target): Promise<Live | Refusal> {
  const answer = await writes.pullRequest(target.repo, target.number);
  if (!answer.ok) return refusal(`github_${answer.failure}`);
  return liveOf(answer.value) ?? refusal('github_malformed_response');
}

function tagOf(target: Target): string {
  return `harness/${target.itemId}`;
}

function identityRefusal(target: Target, live: Live): Refusal | null {
  if (live.headRepo === null || !sameRepository(live.headRepo, target.repository)) {
    return refusal('head_repository_mismatch');
  }
  if (live.headRef !== tagOf(target)) return refusal('head_ref_mismatch');
  return null;
}

function intoDefaultBranch(live: Live): boolean {
  return live.defaultBranch !== null && live.baseRef === live.defaultBranch;
}

function mergedAtHead(target: Target, live: Live): boolean {
  if (!live.merged || live.head !== target.head || !intoDefaultBranch(live)) return false;
  return target.base === null || live.baseRef === target.base.ref;
}

function readyRefusal(target: Target, live: Live): Refusal | null {
  if (live.merged) return refusal('head_mismatch');
  if (!live.open) return refusal('pr_not_open');
  if (live.head !== target.head) return refusal('head_mismatch');
  if (!intoDefaultBranch(live)) return refusal('base_not_default_branch');
  const { base } = target;
  if (base === null || live.base !== base.sha || live.baseRef !== base.ref) {
    return refusal('base_mismatch');
  }
  return null;
}

function succeeded(mergeSha: string, tag: string, already: boolean): ConnectorOutcome {
  return { outcome: 'succeeded', detail: { mergeSha, tag, already: String(already) } };
}

function tagNamed(target: Target, tag: GitHubResult<unknown>): string {
  if (tag.ok) return tagOf(target);
  return tag.failure === 'conflict' ? 'conflict' : 'failed';
}

async function tagged(
  writes: ShipWrites,
  target: Target,
  mergeSha: string,
  already: boolean,
): Promise<ConnectorOutcome> {
  const tag = await writes.tag(target.repo, tagOf(target), mergeSha);
  return succeeded(mergeSha, tagNamed(target, tag), already);
}

async function mergeShaOf(writes: ShipWrites, target: Target, live: Live): Promise<string | null> {
  if (live.mergeSha !== null) return live.mergeSha;
  const again = await readLive(writes, target);
  if (isRefusal(again) || identityRefusal(target, again) !== null) return null;
  return mergedAtHead(target, again) ? again.mergeSha : null;
}

async function alreadyMerged(
  writes: ShipWrites,
  target: Target,
  live: Live,
  tagOnly: boolean,
): Promise<ConnectorOutcome> {
  const mergeSha = await mergeShaOf(writes, target, live);
  if (mergeSha === null) return succeeded('unknown', 'none', true);
  if (!tagOnly) return tagged(writes, target, mergeSha, true);
  const tag = await writes.tagAt(target.repo, tagOf(target), mergeSha);
  return succeeded(mergeSha, tagNamed(target, tag), true);
}

async function afterRefusedMerge(
  writes: ShipWrites,
  target: Target,
  failure: GitHubFailure,
): Promise<ConnectorOutcome> {
  if (racedFailures.has(failure)) {
    const live = await readLive(writes, target);
    const won = !isRefusal(live) && identityRefusal(target, live) === null;
    if (won && mergedAtHead(target, live)) return alreadyMerged(writes, target, live, false);
  }
  return refusal(mergeRefusals.get(failure) ?? `github_${failure}`);
}

async function mergeOnce(writes: ShipWrites, target: Target): Promise<ConnectorOutcome> {
  const live = await readLive(writes, target);
  if (isRefusal(live)) return live;
  const mismatch = identityRefusal(target, live);
  if (mismatch !== null) return mismatch;
  if (mergedAtHead(target, live)) return alreadyMerged(writes, target, live, false);
  const notReady = readyRefusal(target, live);
  if (notReady !== null) return notReady;
  const merged = await writes.merge(target.repo, target.number, {
    sha: target.head,
    ...commitOf(target),
  });
  if (!merged.ok) return afterRefusedMerge(writes, target, merged.failure);
  return tagged(writes, target, merged.value.sha, false);
}

async function mergeAlreadyMade(
  writes: ShipWrites,
  target: Target,
): Promise<ConnectorOutcome | null> {
  const live = await readLive(writes, target);
  if (isRefusal(live)) return live;
  if (identityRefusal(target, live) !== null || !mergedAtHead(target, live)) return null;
  return alreadyMerged(writes, target, live, true);
}

export function mergeHandler(github: MergeGitHub): Omit<Connectors, 'review'> {
  const writesFor = () => createShipWrites(github.app, github.transport);
  return {
    run: async (request) => {
      const target = targetOf(request);
      return isRefusal(target) ? target : mergeOnce(writesFor(), target);
    },
    outcomeOf: async (request) => {
      const target = targetOf(request);
      return isRefusal(target) ? target : mergeAlreadyMade(writesFor(), target);
    },
  };
}
