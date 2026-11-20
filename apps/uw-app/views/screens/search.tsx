import type { Context } from 'hono';
import { jdAreaSchema, type JdArea } from '@uw/contracts';
import { readableAreas } from '@uw/core/acl';
import type { Principal } from '@uw/core/principal';
import { Card } from '@uw/ui/components/card.tsx';
import { primaryButton } from '@uw/ui/components/command-form.tsx';
import { SelectField, TextField } from '@uw/ui/components/field.tsx';
import { PageHead } from '@uw/ui/components/page-head.tsx';
import type { AppEnv } from '../../deps.ts';
import { searchWithSnippets, type SearchResult } from '../../pages/search.ts';
import { renderScreen, screenKernel, screenRefusal } from '../parts/frame.tsx';
import { areaLabel, everyArea, moduleCodes, pageNames } from '../parts/names.ts';
import { pageLink, typeWords } from '../parts/page-shown.ts';
import { pagePath, searchPath, wikiPath } from '../parts/paths.ts';

const RESULTS = 30;
const ALL = '';
const EVERY_TYPE = 'all';

type Asked = {
  readonly text: string;
  readonly titlesOnly: boolean;
  readonly area: JdArea | null;
  readonly everyType: boolean;
};

function askedOf(c: Context<AppEnv>): Asked {
  const area = jdAreaSchema.safeParse(c.req.query('area'));
  return {
    text: (c.req.query('q') ?? '').slice(0, 200).trim(),
    titlesOnly: c.req.query('titles') === '1',
    area: area.success ? area.data : null,
    everyType: c.req.query('type') === EVERY_TYPE,
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

const typeChoices = [
  { value: ALL, label: 'Knowledge pages' },
  { value: EVERY_TYPE, label: 'Every kind of page' },
];

function SearchForm(props: {
  readonly asked: Asked;
  readonly areas: ReturnType<typeof areaChoices>;
}) {
  const { asked } = props;
  return (
    <Card>
      <form method="get" action={searchPath()} role="search" class="flex flex-wrap items-end gap-3">
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
        <label class="flex items-center gap-2 py-1 text-sm font-semibold text-text">
          <input
            type="checkbox"
            name="titles"
            value="1"
            checked={asked.titlesOnly}
            class="rounded-sm outline-offset-2 outline-accent-text focus-visible:outline-2"
          />
          Titles only
        </label>
        <button type="submit" class={primaryButton}>
          Search
        </button>
      </form>
    </Card>
  );
}

function Result(props: { readonly result: SearchResult }) {
  const { page, snippet } = props.result;
  return (
    <li
      data-result=""
      class="flex flex-col gap-1 rounded-md border border-line bg-surface px-4 py-3"
    >
      <h2 class="m-0 text-md font-heavy">
        <a href={pagePath(page.id)} class={pageLink}>
          {page.title}
        </a>
      </h2>
      <p class="m-0 text-xs font-semibold tracking-wide text-text-3 uppercase">
        {areaLabel(page.jdArea)} · {typeWords[page.type] ?? page.type}
      </p>
      <p class="m-0 text-sm text-text-2">
        {snippet.map((part) =>
          part.hit ? (
            <mark class="rounded-sm bg-accent-soft px-1 font-heavy text-accent-text">
              {part.text}
            </mark>
          ) : (
            part.text
          ),
        )}
      </p>
    </li>
  );
}

function Results(props: { readonly asked: Asked; readonly results: readonly SearchResult[] }) {
  if (props.asked.text === '') {
    return (
      <p class="m-0 text-sm text-text-2">
        Search reads the title and the text of every page you can read. To jump to a page by name,{' '}
        <a href={wikiPath()} class={pageLink}>
          browse Pages & Wiki
        </a>{' '}
        or press Ctrl or Cmd with O.
      </p>
    );
  }
  if (props.results.length === 0) {
    return <p class="m-0 text-sm text-text-2">No page you can read matches those words.</p>;
  }
  return (
    <ul class="m-0 flex list-none flex-col gap-3 p-0">
      {props.results.map((result) => (
        <Result result={result} />
      ))}
    </ul>
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
    <>
      <PageHead title={pageNames.search} />
      <div class="flex flex-col gap-5">
        <SearchForm asked={asked} areas={areaChoices(actor, screen.at)} />
        <Results asked={asked} results={results} />
      </div>
    </>,
  );
}
