import type { CollectionRow, FilterGroup, PropertyDefinition, RowQuery } from '@uw/contracts';
import { rowQuerySchema } from '@uw/contracts';
import { EmptyState } from '@uw/ui/components/empty-state.tsx';
import { ListRow, RowList } from '@uw/ui/components/list-row.tsx';
import { Section } from '@uw/ui/components/section.tsx';
import { loadCollection } from '../../collections/definitions.ts';
import { valueOf } from '../../collections/display.ts';
import { readRows } from '../../collections/reader.ts';
import { pagesOwnedBy, type PageSummary } from '../../pages/reads.ts';
import { CellValue } from './collection-cells.tsx';
import type { ScreenKernel } from './frame.tsx';
import { collectionRowPath, pagePath } from './paths.ts';

type Db = Parameters<typeof loadCollection>[0];

const MOST_LISTED = 20;

type ListedRow = {
  readonly collection: string;
  readonly row: CollectionRow;
  readonly facts: readonly PropertyDefinition[];
};

export type ProfileLists = {
  readonly tasks: readonly ListedRow[];
  readonly work: readonly ListedRow[];
  readonly pages: readonly PageSummary[];
};

type Ask = {
  readonly key: string;
  readonly people: readonly string[];
  readonly also: FilterGroup['children'];
  readonly facts: readonly string[];
  readonly sort: string | null;
};

function holding(people: readonly string[], personId: string): FilterGroup {
  return {
    kind: 'group',
    conjunction: 'or',
    children: people.map((property) => ({
      kind: 'condition',
      property,
      operator: 'contains',
      value: personId,
    })),
  };
}

function queryOf(ask: Ask, personId: string): RowQuery {
  const filter: FilterGroup = {
    kind: 'group',
    conjunction: 'and',
    children: [holding(ask.people, personId), ...ask.also],
  };
  const sorts = ask.sort === null ? [] : [{ property: ask.sort, direction: 'asc' }];
  return rowQuerySchema.parse({ filter, sorts, limit: MOST_LISTED });
}

async function rowsFor(
  db: Db,
  screen: ScreenKernel,
  ask: Ask,
  personId: string,
): Promise<readonly ListedRow[]> {
  const stored = await loadCollection(db, ask.key);
  if (stored === null) return [];
  const { actor } = screen.caller;
  const read = await readRows(db, stored, actor, screen.at, {
    query: queryOf(ask, personId),
    view: null,
  });
  if (!read.ok) return [];
  const facts = stored.definition.properties.filter((p) => ask.facts.includes(p.key));
  return read.value.rows.map((row) => ({ collection: ask.key, row, facts }));
}

const notComplete: FilterGroup = {
  kind: 'group',
  conjunction: 'or',
  children: ['to_do', 'in_progress'].map((group) => ({
    kind: 'condition',
    property: 'status',
    operator: 'group_is',
    value: group,
  })),
};

const asks = {
  tasks: {
    key: 'tasks',
    people: ['assignees'],
    also: [notComplete],
    facts: ['status', 'due'],
    sort: 'due',
  },
  programs: { key: 'program', people: ['lead', 'team'], also: [], facts: ['health'], sort: null },
  projects: { key: 'project', people: ['manager', 'team'], also: [], facts: ['phase'], sort: null },
} as const satisfies Record<string, Ask>;

export async function profileLists(
  db: Db,
  screen: ScreenKernel,
  personId: string,
): Promise<ProfileLists> {
  const [tasks, programs, projects, pages] = await Promise.all([
    rowsFor(db, screen, asks.tasks, personId),
    rowsFor(db, screen, asks.programs, personId),
    rowsFor(db, screen, asks.projects, personId),
    pagesOwnedBy(db, screen.caller.actor, `human:${personId}`, screen.at, MOST_LISTED),
  ]);
  return { tasks, work: [...programs, ...projects], pages };
}

function Facts(props: { readonly listed: ListedRow }) {
  if (props.listed.facts.length === 0) return undefined;
  return (
    <span class="flex flex-wrap items-center gap-x-3 gap-y-1">
      {props.listed.facts.map((property) => (
        <CellValue
          property={property}
          value={valueOf(props.listed.row, property.key)}
          people={new Map()}
        />
      ))}
    </span>
  );
}

function Rows(props: {
  readonly label: string;
  readonly rows: readonly ListedRow[];
  readonly empty: string;
}) {
  if (props.rows.length === 0) return <EmptyState title={props.empty} />;
  return (
    <RowList label={props.label}>
      {props.rows.map((listed) => (
        <ListRow
          title={listed.row.title === '' ? 'Untitled' : listed.row.title}
          href={collectionRowPath(listed.collection, listed.row.id)}
          meta={Facts({ listed })}
        />
      ))}
    </RowList>
  );
}

function Owned(props: { readonly pages: readonly PageSummary[] }) {
  if (props.pages.length === 0) return <EmptyState title="None that you can read." />;
  return (
    <RowList label="Pages they own">
      {props.pages.map((page) => (
        <ListRow title={page.title} href={pagePath(page.id)} />
      ))}
    </RowList>
  );
}

export function ProfileListSections(props: { readonly lists: ProfileLists }) {
  const { lists } = props;
  const readable = 'Only what you can read';
  return (
    <>
      <Section title="Open tasks" sub={readable}>
        <Rows label="Open tasks" rows={lists.tasks} empty="No open tasks that you can read." />
      </Section>
      <Section title="Programs and projects" sub="Ones they lead, manage or are on the team of">
        <Rows label="Programs and projects" rows={lists.work} empty="None that you can read." />
      </Section>
      <Section title="Pages they own" sub={readable}>
        <Owned pages={lists.pages} />
      </Section>
    </>
  );
}
