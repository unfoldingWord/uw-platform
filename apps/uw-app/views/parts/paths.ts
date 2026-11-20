import type { IssueRef } from '@uw/contracts';
import type { PullRequestRef } from '@uw/harness';

const segment = (value: string): string => encodeURIComponent(value);

export function homePath(): string {
  return '/';
}

export function logOutPath(): string {
  return '/cdn-cgi/access/logout';
}

export function agentQueuesPath(): string {
  return '/agent-queues';
}

export function newWorkflowPath(): string {
  return '/agent-queues/new';
}

export function gatesPath(): string {
  return '/gates';
}

export function flowPath(harnessId: string): string {
  return `/harnesses/${segment(harnessId)}`;
}

export function queuePath(harnessId: string, stageKey?: string): string {
  const queue = `${flowPath(harnessId)}/queue`;
  return stageKey === undefined ? queue : `${queue}?stage=${segment(stageKey)}`;
}

export function waitingPath(harnessId: string): string {
  return `${flowPath(harnessId)}/waiting`;
}

export function controlsPath(harnessId: string): string {
  return `${flowPath(harnessId)}/controls`;
}

export function agentsPath(harnessId: string): string {
  return `${flowPath(harnessId)}/agents`;
}

export function runsPath(harnessId: string): string {
  return `${flowPath(harnessId)}/runs`;
}

export function runPath(harnessId: string, runId: string): string {
  return `${runsPath(harnessId)}/${segment(runId)}`;
}

export function routinesPath(harnessId: string): string {
  return `${agentsPath(harnessId)}/routines`;
}

export function routineChangePath(harnessId: string, routineId: string): string {
  return `${routinesPath(harnessId)}/${segment(routineId)}`;
}

export function newAgentPath(harnessId: string): string {
  return `${agentsPath(harnessId)}/new`;
}

export function gatePath(harnessId: string, itemId: string): string {
  return `${flowPath(harnessId)}/gates/${segment(itemId)}`;
}

export function shadowExportPath(harnessId: string): string {
  return `/api/harness/${segment(harnessId)}/shadow`;
}

export function itemPath(harnessId: string, itemId: string): string {
  return `${flowPath(harnessId)}/items/${segment(itemId)}`;
}

export function wikiPath(category?: string): string {
  return category === undefined ? '/wiki' : `/wiki/${segment(category)}`;
}

export function pagePath(pageId: string): string {
  return `/pages/${segment(pageId)}`;
}

export function pageEditPath(pageId: string): string {
  return `${pagePath(pageId)}/edit`;
}

export function withBack(path: string, back: string | null): string {
  return back === null ? path : `${path}?back=${segment(back)}`;
}

export function personaPath(pageId: string): string {
  return `/personas/${segment(pageId)}`;
}

export function healthPath(indicator?: string): string {
  return indicator === undefined ? '/health' : `/health/${segment(indicator)}`;
}

export function accessPath(filter?: { readonly scope?: string; readonly person?: string }): string {
  const query = new URLSearchParams();
  if (filter?.scope !== undefined) query.set('scope', filter.scope);
  if (filter?.person !== undefined) query.set('person', filter.person);
  const text = query.toString();
  return text === '' ? '/access' : `/access?${text}`;
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
