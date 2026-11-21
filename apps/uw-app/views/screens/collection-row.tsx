import type { Context } from 'hono';
import { raw } from 'hono/html';
import type { Child } from 'hono/jsx';
import { isWritableProperty, type CollectionRow, type PropertyDefinition } from '@uw/contracts';
import { can } from '@uw/core/acl';
import { Card } from '@uw/ui/components/card.tsx';
import { FactList, type ShownFact } from '@uw/ui/components/kanban-card.tsx';
import { PageHead } from '@uw/ui/components/page-head.tsx';
import type { AppEnv } from '../../deps.ts';
import { ensureBuiltIns } from '../../collections/builtins/seed.ts';
import {
  allCollections,
  loadCollection,
  type StoredCollection,
} from '../../collections/definitions.ts';
import { namesFor, valueOf, type Names } from '../../collections/display.ts';
import { incomingRelations, type Incoming } from '../../collections/incoming.ts';
import { mayReadCollection, readRow } from '../../collections/reader.ts';
import { renderPage } from '../../pages/render-page.ts';
import { readPage } from '../../pages/store.ts';
import { mayWriteDirectory, type DirectoryColumn } from '../../people/directory-entries.ts';
import { activePeople } from '../../people/directory.ts';
import { CellValue } from '../parts/collection-cells.tsx';
import { PropertyEditor, type Choice } from '../parts/collection-edit.tsx';
import { renderScreen, screenKernel, screenRefusal, type ScreenKernel } from '../parts/frame.tsx';
import { areaLabel, moduleCodes, pageNames } from '../parts/names.ts';
import { pageLink } from '../parts/page-shown.ts';
import {
  collectionPath,
  collectionRowPath,
  collectionsPath,
  pageCommentsPath,
  pageEditPath,
} from '../parts/paths.ts';
import { ProfileBodyCard, profileBody } from '../parts/profile-body.tsx';
import { ProfileListCards, profileLists } from '../parts/profile-lists.tsx';
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
  readonly names: Names;
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

function currentChoices(value: unknown, names: Names): readonly Choice[] {
  const list = Array.isArray(value) ? value : value === null || value === undefined ? [] : [value];
  return list.flatMap((item): Choice[] => {
    if (typeof item === 'object' && item !== null && 'id' in item && 'title' in item) {
      return [{ value: String(item.id), label: String(item.title) }];
    }
    return typeof item === 'string' ? [{ value: item, label: names.get(item) ?? item }] : [];
  });
}

function merged(choices: readonly Choice[], current: readonly Choice[]): readonly Choice[] {
  const known = new Set(choices.map((choice) => choice.value));
  return [...choices, ...current.filter((choice) => !known.has(choice.value))];
}

function factOf(screen: ScreenKernel, scene: RowScene, property: PropertyDefinition): ShownFact {
  const value = valueOf(scene.row, property.key);
  const found = scene.found.get(property.key);
  const current = currentChoices(value, scene.names);
  const editor = {
    collection: scene.stored.definition.key,
    rowId: scene.row.id,
    rowTitle: scene.row.title,
    property,
    value,
    compact: false,
    people: merged(scene.people, property.config.type === 'person' ? current : []),
    rows: merged(found?.choices ?? [], property.config.type === 'relation' ? current : []),
  };
  return {
    label: property.name,
    value: (
      <>
        <CellValue property={property} value={value} names={scene.names} />
        {mayEdit(screen, scene, property) ? (
          <details id={property.key} open={scene.finding.property === property.key}>
            <summary class="cursor-pointer text-xs text-text-3 outline-offset-2 outline-accent-text focus-visible:outline-2">{`Change ${property.name.toLowerCase()}`}</summary>
            <div class="mt-2 flex flex-col gap-3">
              {found === undefined ? null : (
                <RelationFinder
                  path={collectionRowPath(scene.stored.definition.key, scene.row.id)}
                  property={property}
                  found={found}
                />
              )}
              <PropertyEditor target={editor} />
            </div>
          </details>
        ) : null}
      </>
    ),
  };
}

function Relations(props: { readonly scene: RowScene }) {
  if (props.scene.incoming.length === 0) return null;
  const byId = new Map([...props.scene.collections.values()].map((s) => [s.id, s]));
  return (
    <Card title="Linked from">
      <ul class="m-0 flex list-none flex-col gap-1 p-0 text-sm">
        {props.scene.incoming.map((link) => {
          const source = link.collectionId === null ? undefined : byId.get(link.collectionId);
          const [, key = ''] = link.rel.split('.');
          const via = source?.definition.properties.find((p) => p.key === key)?.name ?? key;
          return (
            <li>
              <a href={collectionRowPath(source?.definition.key ?? '', link.id)} class={pageLink}>
                {link.title}
              </a>
              <span class="text-text-3">{` · ${source?.definition.name ?? ''} ${via}`}</span>
            </li>
          );
        })}
      </ul>
    </Card>
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
      <ProfileBodyCard body={body} />
      <ProfileListCards lists={lists} />
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
    names: await namesFor(db, [row], stored.definition.properties),
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
      {writable ? (
        <a href={pageEditPath(page.id)} class={pageLink}>
          Edit body
        </a>
      ) : null}
      <a href={pageCommentsPath(page.id)} class={pageLink}>
        Comments
      </a>
    </>
  );
  return (
    <Card title="Page" actions={actions}>
      {page.bodyMd.trim() === '' ? (
        <p class="m-0 text-sm text-text-3">Nothing written yet.</p>
      ) : (
        <div data-page-body="">{raw(rendered.html)}</div>
      )}
    </Card>
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
  return renderScreen(
    c,
    spec,
    <>
      <PageHead eyebrow={definition.name} title={rowTitle} lede={lede} />
      <div class="flex flex-col gap-5">
        {sectionsOf(shownProperties(scene)).map(([name, properties]) => (
          <Card title={name}>
            <FactList roomy facts={properties.map((property) => factOf(screen, scene, property))} />
          </Card>
        ))}
        <Relations scene={scene} />
        {await profileOf(database.db, screen, scene)}
        {await bodyOf(database.db, screen, scene)}
      </div>
    </>,
  );
}
