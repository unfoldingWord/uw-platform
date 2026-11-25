import type { Context } from 'hono';
import { jdAreaSchema, type JdArea } from '@uw/contracts';
import { readableAreas } from '@uw/core/acl';
import { formatDate } from '@uw/core/dates';
import type { Principal } from '@uw/core/principal';
import { Button, ButtonLink } from '@uw/ui/components/button.tsx';
import { EmptyState } from '@uw/ui/components/empty-state.tsx';
import { SelectField, TextField } from '@uw/ui/components/field.tsx';
import { ListRow, RowList } from '@uw/ui/components/list-row.tsx';
import { ListShape } from '@uw/ui/shapes/list.tsx';
import type { AppEnv } from '../../deps.ts';
import { searchWithSnippets, type SearchResult } from '../../pages/search.ts';
import { renderScreen, screenKernel, screenRefusal } from '../parts/frame.tsx';
import { areaLabel, everyArea, moduleCodes, pageNames } from '../parts/names.ts';
import { typeWords } from '../parts/page-shown.ts';
import { pagePath, searchPath, wikiPath } from '../parts/paths.ts';

const RESULTS = 30;
const ALL = '';
const EVERY_TYPE = 'all';

type Asked = {
  readonly text: string;
  readonly titlesOnly: boolean;
  readonly area: JdArea | null;
  readonly everyType: boolean;
  readonly mine: boolean;
  readonly changed: string;
};

function askedOf(c: Context<AppEnv>): Asked {
  const area = jdAreaSchema.safeParse(c.req.query('area'));
  return {
    text: (c.req.query('q') ?? '').slice(0, 200).trim(),
    titlesOnly: c.req.query('titles') === '1',
    area: area.success ? area.data : null,
    everyType: c.req.query('type') === EVERY_TYPE,
    mine: c.req.query('owner') === MINE,
    changed: changedDays.has(c.req.query('changed') ?? '') ? (c.req.query('changed') ?? ALL) : ALL,
  };
}

function areaChoices(actor: Principal, at: Date) {
  const readable = readableAreas(actor, at);
  const areas = readable.kind === 'all' ? everyArea() : readable.areas;
  return [
    { value: ALL, label: 'Every area you can read' },
    ...[...areas].sort().map((area) => ({ value: area, label: areaLabel(area) })),
  ];
}

const MINE = 'owned';
const DAY_MS = 86_400_000;
const changedDays: ReadonlyMap<string, number> = new Map([
  ['7', 7],
  ['31', 31],
  ['365', 365],
]);
const changedChoices = [
  { value: ALL, label: 'Any time' },
  { value: '7', label: 'In the past week' },
  { value: '31', label: 'In the past month' },
  { value: '365', label: 'In the past year' },
];
const ownerChoices = [
  { value: ALL, label: 'Anyone' },
  { value: MINE, label: 'Owned by you' },
];

function sinceOf(asked: Asked, at: Date): string | null {
  const days = changedDays.get(asked.changed);
  return days === undefined ? null : formatDate(new Date(at.getTime() - days * DAY_MS));
}

const typeChoices = [
  { value: ALL, label: 'Knowledge pages' },
  { value: EVERY_TYPE, label: 'Every kind of page' },
];

function Narrowing(props: { readonly asked: Asked }) {
  return (
    <>
      <SelectField
        name="owner"
        label="Owner"
        scope="search"
        choices={ownerChoices}
        selected={props.asked.mine ? MINE : ALL}
      />
      <SelectField
        name="changed"
        label="Changed"
        scope="search"
        choices={changedChoices}
        selected={props.asked.changed}
      />
    </>
  );
}

function SearchForm(props: {
  readonly asked: Asked;
  readonly areas: ReturnType<typeof areaChoices>;
}) {
  const { asked } = props;
  return (
    <form
      method="get"
      action={searchPath()}
      role="search"
      class="flex min-w-0 flex-1 flex-wrap items-end gap-3"
    >
      <TextField name="q" label="Search for" scope="search" value={asked.text} maxLength={200} />
      <SelectField
        name="area"
        label="Area"
        scope="search"
        choices={props.areas}
        selected={asked.area ?? ALL}
      />
      <SelectField
        name="type"
        label="Kind"
        scope="search"
        choices={typeChoices}
        selected={asked.everyType ? EVERY_TYPE : ALL}
      />
      <Narrowing asked={asked} />
      <label class="flex min-h-size-5 items-center gap-2 text-sm text-text">
        <input
          type="checkbox"
          name="titles"
          value="1"
          checked={asked.titlesOnly}
          class="rounded-sm outline-offset-2 outline-accent-text focus-visible:outline-2"
        />
        Titles only
      </label>
      <Button type="submit" variant="primary" icon="magnifying-glass">
        Search
      </Button>
    </form>
  );
}

function Snippet(props: { readonly result: SearchResult }) {
  return (
    <span class="block text-text-2">
      {props.result.snippet.map((part) =>
        part.hit ? (
          <mark class="rounded-sm bg-accent-soft px-1 font-semibold text-accent-text">
            {part.text}
          </mark>
        ) : (
          part.text
        ),
      )}
    </span>
  );
}

function Result(props: { readonly result: SearchResult }) {
  const { page } = props.result;
  return (
    <ListRow
      href={pagePath(page.id)}
      title={page.title}
      attrs={{ 'data-result': '' }}
      meta={
        <>
          <span class="block">{`${areaLabel(page.jdArea)} · ${typeWords[page.type] ?? page.type}`}</span>
          <Snippet result={props.result} />
        </>
      }
    />
  );
}

function Results(props: { readonly asked: Asked; readonly results: readonly SearchResult[] }) {
  if (props.asked.text === '') {
    return (
      <EmptyState
        title="Search the pages you can read"
        text="Search reads the title and the text of every page you can read. To jump to a page by name, press Ctrl or Cmd with O."
        action={<ButtonLink href={wikiPath()}>Browse by area</ButtonLink>}
      />
    );
  }
  if (props.results.length === 0) {
    return (
      <EmptyState
        title="No page you can read matches those words."
        text="Try fewer or other words, or search every area and kind of page."
      />
    );
  }
  const similar = props.results.every((result) => result.match === 'similar_title');
  return (
    <>
      {similar ? (
        <p data-similar="" class="m-0 text-sm text-text-3">
          No page you can read holds those words. These titles are close to them:
        </p>
      ) : null}
      <RowList label="Search results">
        {props.results.map((result) => (
          <Result result={result} />
        ))}
      </RowList>
    </>
  );
}

export async function searchScreen(c: Context<AppEnv>): Promise<Response> {
  const screen = screenKernel(c);
  const database = c.get('database');
  if (screen === null || database === null) return screenRefusal(c);
  const asked = askedOf(c);
  const { actor } = screen.caller;
  const query = {
    text: asked.text,
    type: asked.everyType ? null : ('knowledge' as const),
    area: asked.area,
    titlesOnly: asked.titlesOnly,
    liveOnly: true,
    similar: true,
    owner: asked.mine ? actor.identity : null,
    since: sinceOf(asked, screen.at),
    limit: RESULTS,
  };
  const results = await searchWithSnippets(database.db, actor, query, screen.at);
  const spec = {
    title: pageNames.search,
    current: wikiPath(),
    code: moduleCodes.pages,
    crumbs: [{ label: pageNames.wiki, href: wikiPath() }, { label: pageNames.search }],
  };
  return renderScreen(
    c,
    spec,
    <ListShape
      head={{ title: pageNames.search }}
      filters={<SearchForm asked={asked} areas={areaChoices(actor, screen.at)} />}
    >
      <Results asked={asked} results={results} />
    </ListShape>,
  );
}
