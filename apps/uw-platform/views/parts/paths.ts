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

export function searchPath(): string {
  return '/search';
}

export function pagePath(pageId: string): string {
  return `/pages/${segment(pageId)}`;
}

export function pageEditPath(pageId: string): string {
  return `${pagePath(pageId)}/edit`;
}

export function wikiAreaPath(area: string): string {
  return `/wiki/areas/${segment(area)}`;
}

export function wikiReviewPath(): string {
  return '/wiki/review';
}

export function pageExportPath(pageId: string): string {
  return `/api/pages/${segment(pageId)}/export`;
}

export function pageCommentsPath(pageId: string): string {
  return `${pagePath(pageId)}/comments`;
}

export function pageManagePath(pageId: string): string {
  return `${pagePath(pageId)}/manage`;
}

export function pageSuggestionPath(pageId: string, suggestionId: string): string {
  return `${pagePath(pageId)}/suggestions/${segment(suggestionId)}`;
}

export function pageConfirmPath(pageId: string): string {
  return `${pagePath(pageId)}/confirm`;
}

export function pagePolicyPath(pageId: string): string {
  return `${pagePath(pageId)}/policy`;
}

export function wikiPoliciesPath(): string {
  return '/wiki/policies';
}

export function pageVersionPath(pageId: string, version: number): string {
  return `${pagePath(pageId)}/versions/${String(version)}`;
}

export function wikiNewPath(from: { readonly category?: string; readonly parent?: string } = {}) {
  const query = new URLSearchParams();
  if (from.category !== undefined) query.set('category', from.category);
  if (from.parent !== undefined) query.set('parent', from.parent);
  const asked = query.toString();
  return asked === '' ? '/wiki/new' : `/wiki/new?${asked}`;
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

export function personPath(personId: string): string {
  return collectionRowPath('directory', personId);
}

export function credentialsPath(): string {
  return '/credentials';
}

export function credentialPath(credentialId: string): string {
  return `/credentials/${segment(credentialId)}`;
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

export function collectionsPath(): string {
  return '/collections';
}

export function collectionPath(key: string): string {
  return `/collections/${segment(key)}`;
}

export function collectionViewPath(key: string, viewId: string, query: string = ''): string {
  return `${collectionPath(key)}/views/${segment(viewId)}${query}`;
}

export function collectionRowPath(key: string, rowId: string): string {
  return `${collectionPath(key)}/rows/${segment(rowId)}`;
}

export function collectionSettingsPath(key: string): string {
  return `${collectionPath(key)}/settings`;
}

export function collectionExportPath(key: string, viewId: string): string {
  return `/api/collections/${segment(key)}/views/${segment(viewId)}/export`;
}

export function crosswalkPath(): string {
  return '/crosswalk';
}

export function crosswalkCellPath(area: string, tier: string): string {
  return `/crosswalk/areas/${segment(area)}/${segment(tier)}`;
}

export function crosswalkNodePath(nodeId: string): string {
  return `/crosswalk/nodes/${segment(nodeId)}`;
}

export function myAssistantPath(personId: string | null = null): string {
  return personId === null ? '/assistant' : `/assistant?person=${encodeURIComponent(personId)}`;
}

export function myAssistantPairingPath(): string {
  return '/assistant/pairing';
}

export function measuresPath(): string {
  return '/measures';
}

export function measureJsonPath(measureId: string): string {
  return `/api/measures/${segment(measureId)}`;
}

export function dashboardJsonPath(dashboardId: string, hostPageId: string | null = null): string {
  const host = hostPageId === null ? '' : `?host=${segment(hostPageId)}`;
  return `/api/measures/dashboards/${segment(dashboardId)}${host}`;
}

export function panelCsvPath(
  dashboardId: string,
  index: number,
  hostPageId: string | null,
): string {
  const host = hostPageId === null ? '' : `?host=${segment(hostPageId)}`;
  return `/api/measures/dashboards/${segment(dashboardId)}/panels/${String(index)}${host}`;
}
