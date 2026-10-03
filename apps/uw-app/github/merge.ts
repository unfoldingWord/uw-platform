import { z } from 'zod';
import {
  fullSha,
  sameRepository,
  type ConnectorOutcome,
  type ConnectorRequest,
  type Connectors,
} from '@uw/harness';
import type { GitHubAppConfig } from './app-config.ts';
import type { GitHubFailure } from './failures.ts';
import { pullSchema } from './payloads.ts';
import { createShipWrites, type ShipWrites } from './ship-writes.ts';
import type { GitHubTransport } from './transport.ts';

export type MergeGitHub = { readonly app: GitHubAppConfig; readonly transport: GitHubTransport };

type Target = {
  readonly repo: string;
  readonly number: number;
  readonly itemId: string;
  readonly head: string;
  readonly base: string | null;
  readonly repository: string;
  readonly message: string;
};

type Live = {
  readonly merged: boolean;
  readonly open: boolean;
  readonly head: string | null;
  readonly headRef: string;
  readonly headRepo: string | null;
  readonly base: string | null;
  readonly mergeSha: string | null;
};

type Refusal = Extract<ConnectorOutcome, { outcome: 'refused' }>;

const livePull = pullSchema.extend({ merge_commit_sha: z.string().nullable().optional() });
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

function targetOf(request: ConnectorRequest): Target | Refusal {
  const { pullRequest, repository, expectedHead } = request;
  if (repository === null) return refusal('repository_mismatch');
  if (pullRequest === null || expectedHead === null) return refusal('head_mismatch');
  if (!sameRepository(pullRequest.repo, repository)) return refusal('repository_mismatch');
  const head = fullSha(expectedHead);
  if (head === null) return refusal('head_mismatch');
  const base = request.expectedBase === null ? null : fullSha(request.expectedBase);
  const { itemId, message } = request;
  return { ...pullRequest, itemId, head, base, repository, message };
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

function mergedAtHead(target: Target, live: Live): string | null {
  return live.merged && live.head === target.head ? live.mergeSha : null;
}

function readyRefusal(target: Target, live: Live): Refusal | null {
  if (live.merged) {
    return refusal(live.head === target.head ? 'github_malformed_response' : 'head_mismatch');
  }
  if (!live.open) return refusal('pr_not_open');
  if (live.head !== target.head) return refusal('head_mismatch');
  if (target.base === null || live.base !== target.base) return refusal('base_mismatch');
  return null;
}

function succeeded(mergeSha: string, tag: string, already: boolean): ConnectorOutcome {
  return { outcome: 'succeeded', detail: { mergeSha, tag, already: String(already) } };
}

async function tagged(
  writes: ShipWrites,
  target: Target,
  mergeSha: string,
  already: boolean,
): Promise<ConnectorOutcome> {
  const tag = await writes.tag(target.repo, tagOf(target), mergeSha);
  return succeeded(mergeSha, tag.ok ? tagOf(target) : 'failed', already);
}

function commitOf(target: Target): { readonly title: string; readonly message: string } {
  const [first = '', ...rest] = target.message.split('\n');
  const body = rest.join('\n').trim();
  const trailer = `Harness-Item: ${target.itemId}`;
  return {
    title: `${first.trim()} (#${target.number})`,
    message: body === '' ? trailer : `${body}\n\n${trailer}`,
  };
}

async function afterRefusedMerge(
  writes: ShipWrites,
  target: Target,
  failure: GitHubFailure,
): Promise<ConnectorOutcome> {
  if (racedFailures.has(failure)) {
    const live = await readLive(writes, target);
    const mergeSha =
      isRefusal(live) || identityRefusal(target, live) ? null : mergedAtHead(target, live);
    if (mergeSha !== null) return tagged(writes, target, mergeSha, true);
  }
  return refusal(mergeRefusals.get(failure) ?? `github_${failure}`);
}

async function mergeOnce(writes: ShipWrites, target: Target): Promise<ConnectorOutcome> {
  const live = await readLive(writes, target);
  if (isRefusal(live)) return live;
  const mismatch = identityRefusal(target, live);
  if (mismatch !== null) return mismatch;
  const already = mergedAtHead(target, live);
  if (already !== null) return tagged(writes, target, already, true);
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
  if (identityRefusal(target, live) !== null) return null;
  const mergeSha = mergedAtHead(target, live);
  if (mergeSha === null) return null;
  const tag = await writes.tagAt(target.repo, tagOf(target), mergeSha);
  return succeeded(mergeSha, tag.ok ? tagOf(target) : 'failed', true);
}

export function mergeHandler(github: MergeGitHub): Connectors {
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
