import type { Context } from 'hono';
import { raw } from 'hono/html';
import type { Child } from 'hono/jsx';
import { isWritableProperty, type CollectionRow, type PropertyDefinition } from '@uw/contracts';
import { can } from '@uw/core/acl';
import { ButtonLink } from '@uw/ui/components/button.tsx';
import { FactList, type ShownFact } from '@uw/ui/components/kanban-card.tsx';
import { ListRow, RowList } from '@uw/ui/components/list-row.tsx';
import { Section } from '@uw/ui/components/section.tsx';
import { DocumentShape } from '@uw/ui/shapes/document.tsx';
import type { AppEnv } from '../../deps.ts';
import { ensureBuiltIns } from '../../collections/builtins/seed.ts';
import {
  allCollections,
  loadCollection,
  type StoredCollection,
} from '../../collections/definitions.ts';
import { personIdsIn, valueOf } from '../../collections/display.ts';
import { incomingRelations, type Incoming } from '../../collections/incoming.ts';
import { mayReadCollection, readRow } from '../../collections/reader.ts';
import { renderPage } from '../../pages/render-page.ts';
import { readPage } from '../../pages/store.ts';
import { mayWriteDirectory, type DirectoryColumn } from '../../people/directory-entries.ts';
import { activePeople } from '../../people/directory.ts';
import { CellValue } from '../parts/collection-cells.tsx';
import { EditInPlace, PropertyEditor, type Choice } from '../parts/collection-edit.tsx';
import { renderScreen, screenKernel, screenRefusal, type ScreenKernel } from '../parts/frame.tsx';
import { areaLabel, moduleCodes, pageNames } from '../parts/names.ts';
import { personChipsFor, type PersonChips } from '../parts/person.tsx';
import {
  collectionPath,
  collectionRowPath,
  collectionsPath,
  pageCommentsPath,
  pageEditPath,
} from '../parts/paths.ts';
import { ProfileBodySection, profileBody } from '../parts/profile-body.tsx';
import { ProfileListSections, profileLists } from '../parts/profile-lists.tsx';
import { notFound } from './not-found.tsx';
import { withViews } from '../parts/view-embed.tsx';
import {
  findingOf,
  relationChoices,
  RelationFinder,
  type Finding,
  type Found,
} from '../parts/relation-picker.tsx';

type Db = NonNullable<AppEnv['Variables']['database']>['db'];

type RowScene = {
  readonly stored: StoredCollection;
  readonly row: CollectionRow;
  readonly personChips: PersonChips;
  readonly people: readonly Choice[];
  readonly found: ReadonlyMap<string, Found>;
  readonly finding: Finding;
  readonly incoming: readonly Incoming[];
  readonly collections: ReadonlyMap<string, StoredCollection>;
};

function mayEdit(screen: ScreenKernel, scene: RowScene, property: PropertyDefinition): boolean {
  if (!isWritableProperty(property) || property.config.type === 'title') return false;
  const { actor } = screen.caller;
  const { definition } = scene.stored;
  if (definition.rowSource === 'people') {
    const column = property.source.kind === 'column' ? property.source.column : '';
    return (
      column !== 'display_name' &&
      column !== 'email' &&
      mayWriteDirectory(actor, scene.row.id, column as DirectoryColumn, screen.at)
    );
  }
  return (
    scene.row.jdArea !== null &&
    can(actor, 'write', { kind: 'area', area: scene.row.jdArea }, screen.at)
  );
}

function shownProperties(scene: RowScene): readonly PropertyDefinition[] {
  return scene.stored.definition.properties.filter((property) => {
    if (property.config.type === 'title') return false;
    if (!Object.hasOwn(scene.row.values, property.key)) return false;
    const value = valueOf(scene.row, property.key);
    const empty =
      value === null || value === undefined || (Array.isArray(value) && value.length === 0);
    return !(property.hide_when_empty && empty);
  });
}

function sectionsOf(
  properties: readonly PropertyDefinition[],
): readonly [string, readonly PropertyDefinition[]][] {
  const sections = new Map<string, PropertyDefinition[]>();
  for (const property of properties) {
    const name = property.section ?? 'Properties';
    sections.set(name, [...(sections.get(name) ?? []), property]);
  }
  return [...sections.entries()];
}

function currentChoices(value: unknown, chips: PersonChips): readonly Choice[] {
  const list = Array.isArray(value) ? value : value === null || value === undefined ? [] : [value];
  return list.flatMap((item): Choice[] => {
    if (typeof item === 'object' && item !== null && 'id' in item && 'title' in item) {
      return [{ value: String(item.id), label: String(item.title) }];
    }
    return typeof item === 'string' ? [{ value: item, label: chips.get(item)?.name ?? item }] : [];
  });
}

function merged(choices: readonly Choice[], current: readonly Choice[]): readonly Choice[] {
  const known = new Set(choices.map((choice) => choice.value));
  return [...choices, ...current.filter((choice) => !known.has(choice.value))];
}

function editorOf(scene: RowScene, property: PropertyDefinition, value: unknown): Child {
  const found = scene.found.get(property.key);
  const current = currentChoices(value, scene.personChips);
  const target = {
    collection: scene.stored.definition.key,
    rowId: scene.row.id,
    rowTitle: scene.row.title,
    property,
    value,
    compact: false,
    people: merged(scene.people, property.config.type === 'person' ? current : []),
    rows: merged(found?.choices ?? [], property.config.type === 'relation' ? current : []),
  };
  return (
    <>
      {found === undefined ? null : (
        <RelationFinder
          path={collectionRowPath(scene.stored.definition.key, scene.row.id)}
          property={property}
          found={found}
        />
      )}
      <PropertyEditor target={target} />
    </>
  );
}

function factOf(screen: ScreenKernel, scene: RowScene, property: PropertyDefinition): ShownFact {
  const value = valueOf(scene.row, property.key);
  const shown = <CellValue property={property} value={value} people={scene.personChips} />;
  if (!mayEdit(screen, scene, property)) return { label: property.name, value: shown };
  return {
    label: property.name,
    value: (
      <EditInPlace
        id={property.key}
        open={scene.finding.property === property.key}
        label={`Change ${property.name.toLowerCase()}`}
        editor={editorOf(scene, property, value)}
      >
        {shown}
      </EditInPlace>
    ),
  };
}

function PropertySections(props: { readonly screen: ScreenKernel; readonly scene: RowScene }) {
  const { screen, scene } = props;
  return (
    <>
      {sectionsOf(shownProperties(scene)).map(([name, properties]) => (
        <Section title={name} tight>
          <FactList roomy facts={properties.map((property) => factOf(screen, scene, property))} />
        </Section>
      ))}
    </>
  );
}

function Relations(props: { readonly scene: RowScene }) {
  if (props.scene.incoming.length === 0) return null;
  const byId = new Map([...props.scene.collections.values()].map((s) => [s.id, s]));
  return (
    <Section title="Linked from" sub={String(props.scene.incoming.length)}>
      <RowList label="Linked from">
        {props.scene.incoming.map((link) => {
          const source = link.collectionId === null ? undefined : byId.get(link.collectionId);
          const [, key = ''] = link.rel.split('.');
          const via = source?.definition.properties.find((p) => p.key === key)?.name ?? key;
          return (
            <ListRow
              title={link.title}
              href={collectionRowPath(source?.definition.key ?? '', link.id)}
              meta={`${source?.definition.name ?? ''} ${via}`}
            />
          );
        })}
      </RowList>
    </Section>
  );
}

function opensRow(screen: ScreenKernel, stored: StoredCollection, row: CollectionRow): boolean {
  if (stored.definition.rowSource !== 'people') return true;
  const person = { kind: 'person', personId: row.id, status: 'active' } as const;
  return can(screen.caller.actor, 'read', person, screen.at);
}

async function profileOf(db: Db, screen: ScreenKernel, scene: RowScene): Promise<Child> {
  if (scene.stored.definition.rowSource !== 'people') return null;
  const [body, lists] = await Promise.all([
    profileBody(db, screen, scene.row.id),
    profileLists(db, screen, scene.row.id),
  ]);
  return (
    <>
      <ProfileBodySection body={body} />
      <ProfileListSections lists={lists} />
    </>
  );
}

async function sceneOf(c: Context<AppEnv>, db: Db, screen: ScreenKernel): Promise<RowScene | null> {
  await ensureBuiltIns(db, screen.at);
  const stored = await loadCollection(db, c.req.param('key') ?? '');
  if (stored === null || !mayReadCollection(stored, screen.caller.actor, screen.at)) return null;
  const row = await readRow(db, stored, screen.caller.actor, screen.at, c.req.param('rowId') ?? '');
  if (row === null || !opensRow(screen, stored, row)) return null;
  const collections = new Map((await allCollections(db)).map((s) => [s.definition.key, s]));
  const finding = findingOf(new URL(c.req.url).searchParams);
  const people = (await activePeople(db)).map((p) => ({ value: p.personId, label: p.email }));
  return {
    stored,
    row,
    personChips: await personChipsFor(
      db,
      { reader: screen.caller.actor, at: screen.at },
      personIdsIn([row], stored.definition.properties),
    ),
    people,
    found: await relationChoices(
      { db, actor: screen.caller.actor, at: screen.at, all: collections },
      stored,
      finding,
    ),
    finding,
    incoming:
      stored.definition.rowSource === 'pages'
        ? await incomingRelations(db, screen.caller.actor, row.id, screen.at)
        : [],
    collections,
  };
}

async function bodyOf(db: Db, screen: ScreenKernel, scene: RowScene): Promise<Child> {
  const props = { db, screen, scene };
  if (props.scene.stored.definition.rowSource !== 'pages') return null;
  const page = await readPage(
    props.db,
    props.screen.caller.actor,
    props.scene.row.id,
    props.screen.at,
  );
  if (page === null) return null;
  const rendered = await withViews(
    props.db,
    props.screen,
    await renderPage(props.db, props.screen.caller.actor, page, props.screen.at),
  );
  const writable = can(
    props.screen.caller.actor,
    'write',
    { kind: 'area', area: page.jdArea },
    props.screen.at,
  );
  const actions = (
    <>
      <ButtonLink href={pageCommentsPath(page.id)} variant="ghost" size="sm" icon="comment">
        Comments
      </ButtonLink>
      {writable ? (
        <ButtonLink href={pageEditPath(page.id)} size="sm" icon="pen">
          Edit body
        </ButtonLink>
      ) : null}
    </>
  );
  return (
    <Section title="Page" actions={actions}>
      {page.bodyMd.trim() === '' ? (
        <p class="m-0 text-sm text-text-3">Nothing written yet.</p>
      ) : (
        <div data-page-body="">{raw(rendered.html)}</div>
      )}
    </Section>
  );
}

export async function rowScreen(c: Context<AppEnv>): Promise<Response> {
  const screen = screenKernel(c);
  const database = c.get('database');
  if (screen === null || database === null) return screenRefusal(c);
  const scene = await sceneOf(c, database.db, screen);
  if (scene === null) return notFound(c);
  const { definition } = scene.stored;
  const rowTitle = scene.row.title === '' ? 'Untitled' : scene.row.title;
  const spec = {
    title: rowTitle,
    current: collectionPath(definition.key),
    code: moduleCodes.collections,
    crumbs: [
      { label: pageNames.collections, href: collectionsPath() },
      { label: definition.name, href: collectionPath(definition.key) },
      { label: rowTitle },
    ],
  };
  const lede = scene.row.jdArea === null ? undefined : areaLabel(scene.row.jdArea);
  const reading = [
    <Relations scene={scene} />,
    await profileOf(database.db, screen, scene),
    await bodyOf(database.db, screen, scene),
  ];
  const properties = <PropertySections screen={screen} scene={scene} />;
  const hasReading = scene.incoming.length > 0 || definition.rowSource !== 'tasks';
  return renderScreen(
    c,
    spec,
    <DocumentShape
      head={{ eyebrow: definition.name, title: rowTitle, lede }}
      rail={hasReading ? properties : undefined}
    >
      {hasReading ? reading : properties}
    </DocumentShape>,
  );
}
