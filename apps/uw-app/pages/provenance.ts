import { learningSourceSchema, pullRequestRefSchema, type LearningSource } from '@uw/contracts';
import type { PullRequestRef } from '@uw/harness';

type Frontmatter = Readonly<Record<string, unknown>>;
type Refusal = 'malformed_command' | 'not_permitted';

const PLATFORM: LearningSource = 'platform';
const EXTERNAL: LearningSource = 'external';

export type ExternalWriter = { readonly repository: string | null };
export type Provenance = {
  readonly source: LearningSource;
  readonly pullRequest: PullRequestRef | null;
};
type ProvenanceInput = {
  readonly parsed: Frontmatter;
  readonly raw: Frontmatter;
  readonly prior: Provenance | null;
  readonly writer: ExternalWriter | null;
};
type ProvenanceCheck =
  | { readonly ok: true; readonly frontmatter: Frontmatter }
  | { readonly ok: false; readonly reason: Refusal };

export function provenanceOf(frontmatter: Frontmatter): Provenance {
  const source = learningSourceSchema.safeParse(frontmatter['source']);
  const pull = pullRequestRefSchema.safeParse(frontmatter['pull_request']);
  return {
    source: source.success ? source.data : PLATFORM,
    pullRequest: pull.success ? pull.data : null,
  };
}

function sameRepository(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function samePullRequest(left: PullRequestRef | null, right: PullRequestRef | null): boolean {
  if (left === null || right === null) return left === right;
  return sameRepository(left.repo, right.repo) && left.number === right.number;
}

function firstRefusal(
  source: LearningSource,
  given: Provenance,
  writer: ExternalWriter | null,
): Refusal | null {
  if (source === PLATFORM) return null;
  if (given.pullRequest === null) return 'malformed_command';
  const repository = writer?.repository ?? null;
  const same = repository !== null && sameRepository(repository, given.pullRequest.repo);
  return same ? null : 'not_permitted';
}

function laterRefusal(prior: Provenance, given: Provenance): Refusal | null {
  if (prior.source === PLATFORM) return null;
  return samePullRequest(prior.pullRequest, given.pullRequest) ? null : 'malformed_command';
}

export function learningProvenance(input: ProvenanceInput): ProvenanceCheck {
  const derived: LearningSource = input.writer === null ? PLATFORM : EXTERNAL;
  const source = input.prior?.source ?? derived;
  if (Object.hasOwn(input.raw, 'source') && input.raw['source'] !== source) {
    return { ok: false, reason: 'malformed_command' };
  }
  const given = provenanceOf(input.parsed);
  const refusal =
    input.prior === null
      ? firstRefusal(source, given, input.writer)
      : laterRefusal(input.prior, given);
  if (refusal !== null) return { ok: false, reason: refusal };
  return { ok: true, frontmatter: { ...input.parsed, source } };
}
