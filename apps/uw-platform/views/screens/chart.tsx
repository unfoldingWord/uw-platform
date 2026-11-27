import type { Context } from 'hono';
import type { Harness } from '@uw/contracts';
import { EmptyState } from '@uw/ui/components/empty-state.tsx';
import { Section } from '@uw/ui/components/section.tsx';
import { Table } from '@uw/ui/components/table.tsx';
import { OverviewShape } from '@uw/ui/shapes/overview.tsx';
import { platformSources } from '../../charts/platform-sources.ts';
import { drawChart } from '../../charts/render.ts';
import { standardCharts, type StandardChart } from '../../charts/standard.ts';
import type { AppEnv } from '../../deps.ts';
import { ChartData, ChartLineageRows, ChartPicture } from '../parts/chart-parts.tsx';
import { renderScreen, screenKernel, screenRefusal, type ScreenKernel } from '../parts/frame.tsx';
import { moduleCodes, pageNames } from '../parts/names.ts';
import { pageLink } from '../parts/page-shown.ts';
import { idParam } from '../parts/params.ts';
import { chartPath, chartsPath, measuresPath } from '../parts/paths.ts';
import { notFound } from './not-found.tsx';

function specOf(chart: StandardChart, harness: Harness | null) {
  const crumbs = [
    { label: pageNames.measures, href: measuresPath() },
    { label: pageNames.charts, href: chartsPath() },
    { label: chart.name },
  ];
  return {
    title: harness === null ? chart.name : `${chart.name}: ${harness.title}`,
    current: measuresPath(),
    code: moduleCodes.measures,
    crumbs,
  };
}

async function pickWorkflow(c: Context<AppEnv>, screen: ScreenKernel, chart: StandardChart) {
  const harnesses = await screen.kernel.views.harnesses(screen.caller, { at: screen.at });
  const rows = harnesses.map((harness) => ({
    workflow: (
      <a href={chartPath(chart.key, harness.id)} class={pageLink}>
        {harness.title}
      </a>
    ),
  }));
  return renderScreen(
    c,
    specOf(chart, null),
    <OverviewShape head={{ eyebrow: pageNames.charts, title: chart.name, lede: chart.lede }}>
      <Section title="Choose a workflow" flush>
        {rows.length === 0 ? (
          <EmptyState title="No workflow to chart." text="A workflow you may read appears here." />
        ) : (
          <Table
            caption="Workflows you may read"
            columns={[{ key: 'workflow', label: 'Workflow' }]}
            rows={rows}
            bare
          />
        )}
      </Section>
    </OverviewShape>,
  );
}

async function drawnScreen(
  c: Context<AppEnv>,
  screen: ScreenKernel,
  chart: StandardChart,
  harnessId: string,
) {
  const database = c.get('database');
  const scene = await screen.kernel.reads.harness(screen.caller, { harnessId }, { at: screen.at });
  if (database === null || scene.status === 'error') return notFound(c);
  const sources = platformSources(database.db, screen);
  const drawn = await drawChart(sources, chart.spec({ harnessId }), `chart-${chart.key}`);
  if (drawn.status === 'error') return notFound(c);
  const { harness } = scene.value;
  const head = {
    eyebrow: `${pageNames.charts} · ${harness.title}`,
    title: chart.name,
    lede: chart.lede,
  };
  return renderScreen(
    c,
    specOf(chart, harness),
    <OverviewShape
      head={head}
      side={<ChartLineageRows lineage={drawn.value.lineage} workflow={harness.title} />}
    >
      <ChartPicture drawn={drawn.value} chartKey={chart.key} harnessId={harness.id} />
      <ChartData drawn={drawn.value} />
    </OverviewShape>,
  );
}

export async function chartScreen(c: Context<AppEnv>): Promise<Response> {
  const screen = screenKernel(c);
  if (screen === null) return screenRefusal(c);
  const chart = standardCharts.get(c.req.param('chart') ?? '');
  if (chart === undefined || chart.scope !== 'workflow') return notFound(c);
  const raw = c.req.query('harnessId');
  if (raw === undefined) return pickWorkflow(c, screen, chart);
  const harnessId = idParam(raw);
  return harnessId === null ? notFound(c) : drawnScreen(c, screen, chart, harnessId);
}
