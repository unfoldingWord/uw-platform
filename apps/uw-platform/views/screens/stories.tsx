import type { Context } from 'hono';
import { Badge } from '@uw/ui/components/badge.tsx';
import { EmptyState } from '@uw/ui/components/empty-state.tsx';
import { Section } from '@uw/ui/components/section.tsx';
import { Table } from '@uw/ui/components/table.tsx';
import { ListShape } from '@uw/ui/shapes/list.tsx';
import type { AppEnv } from '../../deps.ts';
import { storyBankLines, type StoryLine } from '../../stories/reads.ts';
import { renderScreen, screenKernel, screenRefusal } from '../parts/frame.tsx';
import { areaLabel, moduleCodes, pageNames } from '../parts/names.ts';
import { pageLink } from '../parts/page-shown.ts';
import { pagePath, storiesPath } from '../parts/paths.ts';
import { consentWords, levelWords, precisionWords } from '../parts/story-words.ts';

const columns = [
  { key: 'title', label: 'Story' },
  { key: 'area', label: 'Area' },
  { key: 'happened', label: 'Happened' },
  { key: 'place', label: 'Place' },
  { key: 'programs', label: 'Programs' },
  { key: 'level', label: 'Level' },
  { key: 'consent', label: 'Consent' },
  { key: 'told', label: 'Expressions', numeric: true },
  { key: 'last', label: 'Last told' },
  { key: 'flags', label: 'Flags' },
  { key: 'review', label: 'Review on' },
];

function flagsOf(line: StoryLine): string {
  const counts = line.summary?.flags ?? { toldAboveLevel: 0, toldWithoutConsent: 0 };
  const shown = [
    counts.toldAboveLevel === 0 ? null : `${String(counts.toldAboveLevel)} told above its level`,
    counts.toldWithoutConsent === 0
      ? null
      : `${String(counts.toldWithoutConsent)} told without consent`,
  ].filter((each) => each !== null);
  return shown.length === 0 ? 'None' : shown.join(', ');
}

function Place(props: { readonly line: StoryLine }) {
  const { summary, precision } = props.line;
  return (
    <span class="flex flex-col">
      <span>{summary?.place ?? 'Not recorded'}</span>
      <span class="text-xs text-text-3">{precisionWords[precision ?? 'unconsented']}</span>
    </span>
  );
}

function told(line: StoryLine) {
  return {
    happened: line.summary?.occurredOn ?? 'Not recorded',
    place: <Place line={line} />,
    programs:
      line.programs.length === 0 ? 'None' : line.programs.map((each) => each.title).join(', '),
    told: String(line.summary?.expressionCount ?? 0),
    last: line.summary?.lastToldOn ?? 'Not told yet',
    flags: flagsOf(line),
  };
}

function rowOf(line: StoryLine) {
  return {
    title: (
      <a href={pagePath(line.id)} class={pageLink}>
        {line.title}
      </a>
    ),
    ...told(line),
    area: areaLabel(line.jdArea),
    level: (
      <Badge tone={line.level === 'internal' ? 'neutral' : 'info'}>{levelWords[line.level]}</Badge>
    ),
    consent: consentWords[line.consent],
    review: line.reviewOn ?? 'Not set',
  };
}

function Listing(props: { readonly lines: readonly StoryLine[] }) {
  return (
    <Section title="Stories" flush>
      {props.lines.length === 0 ? (
        <EmptyState
          title="No stories to show."
          text="An impact story appears here once someone files one in an area you can read."
        />
      ) : (
        <Table caption="Stories" columns={columns} rows={props.lines.map(rowOf)} bare />
      )}
    </Section>
  );
}

export async function storiesScreen(c: Context<AppEnv>): Promise<Response> {
  const screen = screenKernel(c);
  const database = c.get('database');
  if (screen === null || database === null) return screenRefusal(c);
  const lines = await storyBankLines(database.db, screen.caller.actor, screen.at);
  const spec = {
    title: pageNames.stories,
    current: storiesPath(),
    code: moduleCodes.stories,
    crumbs: [{ label: pageNames.stories }],
  };
  const lede =
    'The impact story records you may read: when and where each happened, the programs it shows, how widely it may be told, and every telling linked to it. A story starts internal; an area admin raises it once its consent is recorded.';
  return renderScreen(
    c,
    spec,
    <ListShape head={{ title: pageNames.stories, lede }}>
      <Listing lines={lines} />
    </ListShape>,
  );
}
