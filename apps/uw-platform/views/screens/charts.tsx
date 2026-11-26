import type { Context } from 'hono';
import { Section } from '@uw/ui/components/section.tsx';
import { Table } from '@uw/ui/components/table.tsx';
import { ListShape } from '@uw/ui/shapes/list.tsx';
import { standardCharts } from '../../charts/standard.ts';
import type { AppEnv } from '../../deps.ts';
import { renderScreen, screenKernel, screenRefusal } from '../parts/frame.tsx';
import { moduleCodes, pageNames } from '../parts/names.ts';
import { pageLink } from '../parts/page-shown.ts';
import { chartPath, chartsPath, measuresPath } from '../parts/paths.ts';

const columns = [
  { key: 'name', label: 'Chart' },
  { key: 'shows', label: 'What it shows' },
];

export async function chartsScreen(c: Context<AppEnv>): Promise<Response> {
  const screen = screenKernel(c);
  if (screen === null) return screenRefusal(c);
  const rows = [...standardCharts.values()].map((chart) => ({
    name: (
      <a href={chartPath(chart.key)} class={pageLink}>
        {chart.name}
      </a>
    ),
    shows: chart.lede,
  }));
  const spec = {
    title: pageNames.charts,
    current: measuresPath(),
    code: moduleCodes.measures,
    crumbs: [{ label: pageNames.measures, href: measuresPath() }, { label: pageNames.charts }],
  };
  const lede =
    'The standard charts, each defined once and drawn from the same rows its table and CSV hold.';
  return renderScreen(
    c,
    spec,
    <ListShape head={{ title: pageNames.charts, lede }}>
      <Section title="Standard charts" flush attrs={{ 'data-charts': chartsPath() }}>
        <Table caption="Standard charts" columns={columns} rows={rows} bare />
      </Section>
    </ListShape>,
  );
}
