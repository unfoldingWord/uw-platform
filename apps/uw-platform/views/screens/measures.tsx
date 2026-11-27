import type { Context } from 'hono';
import { formatInstant } from '@uw/core/dates';
import { Badge } from '@uw/ui/components/badge.tsx';
import { EmptyState } from '@uw/ui/components/empty-state.tsx';
import { Section } from '@uw/ui/components/section.tsx';
import { Table } from '@uw/ui/components/table.tsx';
import { ListShape } from '@uw/ui/shapes/list.tsx';
import type { AppEnv } from '../../deps.ts';
import { measuresAndDashboards, type ListedMeasurePage } from '../../measures/listing.ts';
import { renderScreen, screenKernel, screenRefusal } from '../parts/frame.tsx';
import { pausedOf } from '../parts/measure-words.ts';
import { areaLabel, moduleCodes, pageNames } from '../parts/names.ts';
import { pageLink } from '../parts/page-shown.ts';
import { measuresPath, pagePath } from '../parts/paths.ts';

const columns = [
  { key: 'title', label: 'Name' },
  { key: 'area', label: 'Area' },
  { key: 'state', label: 'State' },
  { key: 'next', label: 'Next run' },
];

const statusWords: Readonly<Record<string, string>> = {
  draft: 'Draft',
  suggested: 'Suggested, waiting for a person',
  active: 'Active',
  retired: 'Retired',
};

function State(props: { readonly line: ListedMeasurePage }) {
  const { line } = props;
  const words = statusWords[line.status] ?? line.status;
  if (line.pausedReason !== null) return <Badge tone="held">{pausedOf(line.pausedReason)}</Badge>;
  if (line.status === 'suggested') return <Badge tone="held">{words}</Badge>;
  return <Badge tone={line.status === 'active' ? 'success' : 'neutral'}>{words}</Badge>;
}

function rowOf(line: ListedMeasurePage) {
  return {
    title: (
      <a href={pagePath(line.id)} class={pageLink}>
        {line.title}
      </a>
    ),
    area: areaLabel(line.jdArea),
    state: <State line={line} />,
    next:
      line.type === 'dashboard'
        ? 'Shows its measures'
        : line.nextRunAt === null
          ? 'Not scheduled'
          : formatInstant(line.nextRunAt),
  };
}

function Listing(props: {
  readonly title: string;
  readonly lines: readonly ListedMeasurePage[];
  readonly empty: string;
}) {
  return (
    <Section title={props.title} flush>
      {props.lines.length === 0 ? (
        <EmptyState title={`No ${props.title.toLowerCase()} to show.`} text={props.empty} />
      ) : (
        <Table caption={props.title} columns={columns} rows={props.lines.map(rowOf)} bare />
      )}
    </Section>
  );
}

export async function measuresScreen(c: Context<AppEnv>): Promise<Response> {
  const screen = screenKernel(c);
  const database = c.get('database');
  if (screen === null || database === null) return screenRefusal(c);
  const lines = await measuresAndDashboards(database.db, screen.caller.actor, screen.at);
  const spec = {
    title: pageNames.measures,
    current: measuresPath(),
    code: moduleCodes.measures,
    crumbs: [{ label: pageNames.measures }],
  };
  const lede =
    'The measures and dashboards you may read. An agent writes them; a person runs the trial and activates each measure.';
  return renderScreen(
    c,
    spec,
    <ListShape head={{ title: pageNames.measures, lede }}>
      <Listing
        title="Measures"
        lines={lines.filter((line) => line.type === 'measure')}
        empty="A measure appears here once an agent saves one in an area you can read."
      />
      <Listing
        title="Dashboards"
        lines={lines.filter((line) => line.type === 'dashboard')}
        empty="A dashboard appears here once an agent saves one in an area you can read."
      />
    </ListShape>,
  );
}
