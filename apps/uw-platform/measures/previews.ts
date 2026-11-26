import type { z } from 'zod';
import type { AuthoringProblem, Panel, verbIo } from '@uw/contracts';
import { can } from '@uw/core/acl';
import { resourcesInContext, type ContextResource } from './context-resources.ts';
import { dashboardPageOf, readablePagesOfType, type DashboardPage } from './measure-pages.ts';
import type { Reader } from './metric-reads.ts';
import { panelBlocks } from './panel-blocks.ts';
import { metricContextOf, panelReader, type PanelData, type PanelRead } from './panel-reads.ts';
import { dashboardProblems } from './problems.ts';
import { previewMeasured, type ValueChecker } from './value-checks.ts';

export type DashboardPreview = z.infer<(typeof verbIo)['preview_dashboard']['output']>;
type PanelPreview = DashboardPreview['panels'][number];

const MOST_PROBLEMS = 100;
const NO_HOST = 'names no page you can read, and this dashboard shows the page it is shown on';

export async function readableDashboard(
  reader: Reader,
  dashboardId: string,
): Promise<DashboardPage | null> {
  const found = await dashboardPageOf(reader.db, dashboardId);
  if (found === null) return null;
  return can(reader.actor, 'read', { kind: 'area', area: found.jdArea }, reader.at) ? found : null;
}

async function hostProblems(reader: Reader, dashboard: DashboardPage, hostPageId: string | null) {
  if (dashboard.context.kind !== 'host') return [];
  const request = { ids: hostPageId === null ? [] : [hostPageId], types: null };
  const readable = await readablePagesOfType(reader.db, reader.actor, request, reader.at);
  return readable.size === 0 ? [{ path: 'hostPageId', message: NO_HOST }] : [];
}

function coverageOf(data: PanelData | null): PanelPreview['coverage'] {
  if (data === null) return null;
  return data.kind === 'metric' ? data.figures.coverage : data.table.coverage;
}

function ownProblems(problems: readonly AuthoringProblem[], index: number): AuthoringProblem[] {
  const prefix = `panels.${index}`;
  return problems.filter(
    (problem) => problem.path === prefix || problem.path.startsWith(`${prefix}.`),
  );
}

const position = /^panels\.(\d+)(.*)$/;

function placedAt(problem: AuthoringProblem, indexes: readonly number[]): AuthoringProblem {
  const match = position.exec(problem.path);
  if (match === null) return problem;
  const index = indexes.at(Number(match[1])) ?? Number(match[1]);
  return { ...problem, path: `panels.${String(index)}${match[2] ?? ''}` };
}

async function previewOf(
  read: (panel: Panel) => Promise<PanelRead | null>,
  panel: Panel,
  problems: readonly AuthoringProblem[],
  index: number,
): Promise<PanelPreview> {
  const own = ownProblems(problems, index);
  const drawn = own.length === 0 ? await read(panel) : null;
  const data = drawn?.data ?? null;
  return {
    index,
    kind: panel.kind,
    title: panel.title ?? null,
    drawn: data !== null,
    coverage: coverageOf(data),
    problems: own,
  };
}

function previewReader(checker: ValueChecker, resources: readonly ContextResource[]) {
  const problems: AuthoringProblem[] = [];
  const read = panelReader(checker, async (measure) => {
    const previewed = await previewMeasured(checker, measure, resources);
    problems.push(...previewed.problems);
    return previewed.measured;
  });
  return { read, problems };
}

export async function previewDashboard(
  reader: ValueChecker,
  dashboard: DashboardPage,
  hostPageId: string | null,
): Promise<DashboardPreview> {
  const blocks = panelBlocks(dashboard.bodyMd);
  const placed = blocks.flatMap((block) => ('panel' in block ? [block] : []));
  const panels = placed.map((block) => block.panel);
  const parsed = blocks.flatMap((block) => ('problems' in block ? block.problems : []));
  const found = await dashboardProblems(reader, { context: dashboard.context, panels });
  const checked = found.map((problem) =>
    placedAt(
      problem,
      placed.map((block) => block.index),
    ),
  );
  const problems = [...(await hostProblems(reader, dashboard, hostPageId)), ...parsed, ...checked];
  const context = metricContextOf(dashboard.context, hostPageId);
  const resources =
    context === null ? [] : await resourcesInContext(reader.db, reader.actor, context, reader.at);
  const valued = previewReader(reader, resources);
  const previews: PanelPreview[] = [];
  for (const block of placed)
    previews.push(await previewOf(valued.read, block.panel, problems, block.index));
  const all = [...problems, ...valued.problems];
  return { dashboardId: dashboard.id, panels: previews, problems: all.slice(0, MOST_PROBLEMS) };
}
