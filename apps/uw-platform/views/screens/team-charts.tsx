import type { Context } from 'hono';
import { can, DIRECTORY_AREA } from '@uw/core/acl';
import { ButtonLink } from '@uw/ui/components/button.tsx';
import { OverviewShape } from '@uw/ui/shapes/overview.tsx';
import { platformSources } from '../../charts/platform-sources.ts';
import { drawChart, type DrawnChart } from '../../charts/render.ts';
import { teamCharts, type StandardChart } from '../../charts/standard.ts';
import type { AppEnv } from '../../deps.ts';
import type { TeamRead } from '../../people/team-model.ts';
import { readTeam } from '../../people/team-reads.ts';
import { stewardsTeam } from '../../people/team-writes.ts';
import { ChartData, ChartLineageRows, ChartPicture } from '../parts/chart-parts.tsx';
import { renderScreen, screenKernel, screenRefusal, type ScreenKernel } from '../parts/frame.tsx';
import { moduleCodes, pageNames } from '../parts/names.ts';
import { collectionPath, teamChartsPath } from '../parts/paths.ts';
import { AllocationEditor, CommitmentEditor } from '../parts/team-chart-parts.tsx';
import {
  allocationList,
  colleagueChoices,
  commitmentsBy,
  peopleChoices,
  targetChoices,
} from '../parts/team-editing.ts';
import { notFound } from './not-found.tsx';

const prefixes: ReadonlyMap<string, string> = new Map([
  ['commitments_network', 'commitments'],
  ['staff_allocation', 'allocation'],
  ['people_and_portfolios', 'people'],
]);

type Drawn = { readonly chart: StandardChart; readonly drawn: DrawnChart; readonly prefix: string };

function idsOf(prefix: string) {
  return {
    heading: `${prefix}-chart-heading`,
    rows: `${prefix}-rows-heading`,
    lineage: `${prefix}-lineage-heading`,
  };
}

async function drawAll(screen: ScreenKernel, db: Parameters<typeof platformSources>[0]) {
  const sources = platformSources(db, screen);
  const drawn: Drawn[] = [];
  for (const chart of teamCharts) {
    const prefix = prefixes.get(chart.key) ?? chart.key;
    const outcome = await drawChart(sources, chart.spec({}), `team-${prefix}`);
    if (outcome.status === 'error') return null;
    drawn.push({ chart, drawn: outcome.value, prefix });
  }
  return drawn;
}

function Editors(props: { readonly read: TeamRead; readonly screen: ScreenKernel }) {
  const { actor } = props.screen.caller;
  const personId = actor.kind === 'person' ? actor.personId : null;
  const member = props.read.members.find((each) => each.id === personId);
  const steward = stewardsTeam(actor, props.screen.at);
  return (
    <>
      {member === undefined ? null : (
        <CommitmentEditor
          personId={member.id}
          mine={commitmentsBy(props.read, member.id)}
          colleagues={colleagueChoices(props.read, member.id)}
        />
      )}
      {steward ? (
        <AllocationEditor
          allocations={allocationList(props.read)}
          people={peopleChoices(props.read)}
          targets={targetChoices(props.read)}
        />
      ) : null}
    </>
  );
}

function head() {
  return {
    eyebrow: pageNames.directory,
    title: pageNames.teamCharts,
    lede: 'Commitments, staff allocations and portfolios, drawn from the directory. An entry that names more than one person, or no one, is left out and listed under its chart, never guessed.',
    actions: (
      <span data-pdf-hidden="">
        <ButtonLink href={`${teamChartsPath()}?format=pdf`} variant="secondary" icon="file-export">
          Print as PDF
        </ButtonLink>
      </span>
    ),
  };
}

const screenSpec = {
  title: pageNames.teamCharts,
  current: teamChartsPath(),
  code: moduleCodes.teamCharts,
  crumbs: [
    { label: pageNames.directory, href: collectionPath('directory') },
    { label: pageNames.teamCharts },
  ],
};

function Side(props: {
  readonly drawn: readonly Drawn[];
  readonly read: TeamRead;
  readonly screen: ScreenKernel;
}) {
  return (
    <>
      {props.drawn.map((each) => (
        <ChartLineageRows
          lineage={each.drawn.lineage}
          title={`${each.drawn.spec.title}: lineage`}
          ids={idsOf(each.prefix)}
        />
      ))}
      <Editors read={props.read} screen={props.screen} />
    </>
  );
}

function Charts(props: { readonly drawn: readonly Drawn[] }) {
  return (
    <>
      {props.drawn.map((each) => (
        <>
          <ChartPicture
            drawn={each.drawn}
            chartKey={each.chart.key}
            harnessId={null}
            ids={idsOf(each.prefix)}
          />
          <ChartData
            drawn={each.drawn}
            ids={idsOf(each.prefix)}
            title={`${each.drawn.spec.title}: rows drawn`}
          />
        </>
      ))}
    </>
  );
}

export async function teamChartsScreen(c: Context<AppEnv>): Promise<Response> {
  const screen = screenKernel(c);
  const database = c.get('database');
  if (screen === null || database === null) return screenRefusal(c);
  const { actor } = screen.caller;
  if (!can(actor, 'read', { kind: 'area', area: DIRECTORY_AREA }, screen.at)) return notFound(c);
  const read = await readTeam(database.db, actor, screen.at);
  const drawn = await drawAll(screen, database.db);
  if (read === null || drawn === null) return notFound(c);
  return renderScreen(
    c,
    screenSpec,
    <OverviewShape head={head()} side={<Side drawn={drawn} read={read} screen={screen} />}>
      <Charts drawn={drawn} />
    </OverviewShape>,
  );
}
