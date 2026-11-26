import type { AuthoringProblem, MetricContext, Panel } from '@uw/contracts';
import { resourcesInContext, type ContextResource } from './context-resources.ts';
import type { DashboardPage } from './measure-pages.ts';
import type { Reader } from './metric-reads.ts';
import { panelBlocks } from './panel-blocks.ts';
import { metricContextOf, panelReader, storedMeasured, type PanelRead } from './panel-reads.ts';

type PlacedPanelRead = {
  readonly index: number;
  readonly panel: Panel;
  readonly read: PanelRead | null;
};

type UnreadablePanel = { readonly index: number; readonly problem: AuthoringProblem };

export type DashboardRead = {
  readonly context: MetricContext | null;
  readonly panels: readonly PlacedPanelRead[];
  readonly unreadable: readonly UnreadablePanel[];
  readonly areas: readonly string[];
};

function areasDrawn(
  panels: readonly PlacedPanelRead[],
  resources: readonly ContextResource[],
): readonly string[] {
  const drawn = panels.flatMap((placed) => (placed.read === null ? [] : [placed.read]));
  if (drawn.length === 0) return [];
  const areas = [
    ...drawn.map((read) => read.measure.jdArea),
    ...resources.map((each) => each.area),
  ];
  return [...new Set(areas)];
}

export async function dashboardRead(
  reader: Reader,
  dashboard: DashboardPage,
  hostPageId: string | null,
): Promise<DashboardRead> {
  const context = metricContextOf(dashboard.context, hostPageId);
  if (context === null) return { context, panels: [], unreadable: [], areas: [] };
  const resources = await resourcesInContext(reader.db, reader.actor, context, reader.at);
  const read = panelReader(reader, storedMeasured(reader, resources));
  const panels: PlacedPanelRead[] = [];
  const unreadable: UnreadablePanel[] = [];
  for (const block of panelBlocks(dashboard.bodyMd)) {
    if ('panel' in block)
      panels.push({ index: block.index, panel: block.panel, read: await read(block.panel) });
    else
      unreadable.push({
        index: block.index,
        problem: block.problems[0] ?? { path: '', message: 'unknown' },
      });
  }
  return { context, panels, unreadable, areas: areasDrawn(panels, resources) };
}
