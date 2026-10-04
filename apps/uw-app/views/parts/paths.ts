import type { IssueRef } from '@uw/contracts';
import type { PullRequestRef } from '@uw/harness';

const segment = (value: string): string => encodeURIComponent(value);

export function homePath(): string {
  return '/';
}

export function gatesPath(): string {
  return '/gates';
}

export function flowPath(harnessId: string): string {
  return `/harnesses/${segment(harnessId)}`;
}

export function boardPath(harnessId: string, stageKey?: string): string {
  const board = `${flowPath(harnessId)}/board`;
  return stageKey === undefined ? board : `${board}?stage=${segment(stageKey)}`;
}

export function gatePath(harnessId: string, itemId: string): string {
  return `${flowPath(harnessId)}/gates/${segment(itemId)}`;
}

export function itemPath(harnessId: string, itemId: string): string {
  return `${flowPath(harnessId)}/items/${segment(itemId)}`;
}

export function personaPath(pageId: string): string {
  return `/personas/${segment(pageId)}`;
}

export function healthPath(indicator?: string): string {
  return indicator === undefined ? '/health' : `/health/${segment(indicator)}`;
}

function repoUrl(repo: string): string {
  return `https://github.com/${repo}`;
}

export function pullRequestUrl(ref: PullRequestRef): string {
  return `${repoUrl(ref.repo)}/pull/${ref.number}`;
}

export function checksUrl(ref: PullRequestRef): string {
  return `${pullRequestUrl(ref)}/checks`;
}

export function reviewUrl(ref: PullRequestRef, reviewId?: number): string {
  const pull = pullRequestUrl(ref);
  return reviewId === undefined ? `${pull}/files` : `${pull}#pullrequestreview-${reviewId}`;
}

export function issueUrl(issue: IssueRef): string {
  return `${repoUrl(issue.repo)}/issues/${issue.number}`;
}
