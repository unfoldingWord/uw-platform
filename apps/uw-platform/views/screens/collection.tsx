import type { Context } from 'hono';
import type { Child } from 'hono/jsx';
import type { SavedView } from '@uw/contracts';
import { can } from '@uw/core/acl';
import { Button, ButtonLink } from '@uw/ui/components/button.tsx';
import { PlatformCommandForm } from '@uw/ui/components/command-form.tsx';
import { EmptyState } from '@uw/ui/components/empty-state.tsx';
import { SelectField, TextField } from '@uw/ui/components/field.tsx';
import { Menu, MenuLink, Popover } from '@uw/ui/components/menu.tsx';
import { domId, reasonText } from '@uw/ui/components/text.ts';
import { BoardShape } from '@uw/ui/shapes/board.tsx';
import type { Head } from '@uw/ui/shapes/head.tsx';
import { ListShape } from '@uw/ui/shapes/list.tsx';
import type { AppEnv } from '../../deps.ts';
import { collectionReply } from '../../collections/replies.ts';
import { drawLayout } from '../parts/collection-draw.tsx';
import { COLLECTIONS_ENDPOINT } from '../parts/collection-edit.tsx';
import { collectionPrinted } from '../parts/collection-printed.ts';
import { collectionScene, type CollectionScene } from '../parts/collection-scene.ts';
import { renderScreen, screenKernel, screenRefusal, type ScreenKernel } from '../parts/frame.tsx';
import { areaLabel, everyArea, moduleCodes, pageNames } from '../parts/names.ts';
import {
  collectionExportPath,
  collectionPath,
  collectionSettingsPath,
  collectionsPath,
  collectionViewPath,
} from '../parts/paths.ts';
import { notFound } from './not-found.tsx';

type Template = { readonly id: string; readonly name: string };

function tabsOf(scene: CollectionScene) {
  const { stored, views, view } = scene;
  return views.map((each) => ({
    label:
      each.settings.scope === 'personal' ? `${each.settings.name} (yours)` : each.settings.name,
    href: collectionViewPath(stored.definition.key, each.id),
    current: each.id === view?.id,
  }));
}

function writableAreas(screen: ScreenKernel): readonly string[] {
  return everyArea().filter((area) =>
    can(screen.caller.actor, 'write', { kind: 'area', area }, screen.at),
  );
}

function templateChoices(templates: readonly Template[]) {
  return [{ value: '', label: 'None' }, ...templates.map((t) => ({ value: t.id, label: t.name }))];
}

function NewRowForm(props: {
  readonly scene: CollectionScene;
  readonly areas: readonly string[];
  readonly templates: readonly Template[];
}) {
  const { stored, view } = props.scene;
  const key = stored.definition.key;
  const chosen = view?.settings.defaultTemplate ?? props.templates[0]?.id ?? '';
  return (
    <PlatformCommandForm
      endpoint={COLLECTIONS_ENDPOINT}
      command="create_row"
      scope={key}
      done="Created"
    >
      <input type="hidden" name="collection" value={key} />
      <input type="hidden" name="rowId" value={crypto.randomUUID()} />
      <TextField name="title" label="Title" scope={key} maxLength={200} required />
      <SelectField
        name="jdArea"
        label="Area"
        scope={key}
        choices={props.areas.map((area) => ({ value: area, label: areaLabel(area) }))}
      />
      {props.templates.length === 0 ? null : (
        <SelectField
          name="template"
          label="Template"
          scope={key}
          selected={chosen}
          choices={templateChoices(props.templates)}
        />
      )}
      <Button type="submit">Create</Button>
    </PlatformCommandForm>
  );
}

function NewRow(props: {
  readonly scene: CollectionScene;
  readonly areas: readonly string[];
  readonly templates: readonly Template[];
}) {
  if (props.areas.length === 0) return null;
  const id = domId('new-row', props.scene.stored.definition.key);
  return (
    <>
      <Button variant="primary" icon="plus" attrs={{ popovertarget: id }}>
        New row
      </Button>
      <Popover id={id} label="New row" role="dialog" wide>
        <div class="flex flex-col gap-3 p-3">
          <p class="m-0 text-sm text-text-3">Created in the area you choose</p>
          <NewRowForm {...props} />
        </div>
      </Popover>
    </>
  );
}

function Body(props: { readonly scene: CollectionScene }) {
  const { scene } = props;
  if (scene.view === null) {
    return (
      <EmptyState
        title="This collection has no saved view yet."
        text="Save a view under Properties to see its rows here."
      />
    );
  }
  if (scene.refusal !== null || scene.layout === null) {
    return (
      <EmptyState
        title={`This view cannot be shown to you: ${reasonText(scene.refusal ?? 'not_permitted').toLowerCase()}.`}
      />
    );
  }
  return <>{drawLayout(scene.view.settings.layout, scene.layout)}</>;
}

function monthQuery(scene: CollectionScene): string {
  const { view, layout } = scene;
  return view?.settings.layout === 'calendar' ? `&month=${layout?.month ?? ''}` : '';
}

function More(props: { readonly scene: CollectionScene }) {
  const { stored, view, layout } = props.scene;
  const next = layout?.reply.next ?? null;
  if (view === null || next === null) return null;
  const month = monthQuery(props.scene);
  return (
    <div>
      <ButtonLink
        href={collectionViewPath(stored.definition.key, view.id, `?cursor=${next}${month}`)}
        size="sm"
        attrs={{ 'data-pdf-hidden': '' }}
      >
        Next rows
      </ButtonLink>
    </div>
  );
}

function ExportMenu(props: { readonly scene: CollectionScene; readonly view: SavedView }) {
  const { key } = props.scene.stored.definition;
  const { view } = props;
  return (
    <Menu id={`export-${key}`} label="Export" icon="file-export" text="Export">
      <MenuLink href={collectionExportPath(key, view.id)} icon="table">
        Export CSV
      </MenuLink>
      <MenuLink
        href={collectionViewPath(key, view.id, `?format=pdf${monthQuery(props.scene)}`)}
        icon="file-lines"
      >
        Export as PDF
      </MenuLink>
    </Menu>
  );
}

function Actions(props: {
  readonly scene: CollectionScene;
  readonly admin: boolean;
  readonly newRow: Child;
}) {
  const { key } = props.scene.stored.definition;
  const view = props.scene.view;
  return (
    <span data-pdf-hidden="" class="flex flex-wrap items-center gap-2">
      {view === null ? null : <ExportMenu scene={props.scene} view={view} />}
      <ButtonLink href={collectionSettingsPath(key)} variant="ghost">
        {props.admin ? 'Properties and views' : 'Properties'}
      </ButtonLink>
      {props.newRow}
    </span>
  );
}

function specOf(scene: CollectionScene) {
  const { definition } = scene.stored;
  const view: SavedView | null = scene.view;
  return {
    title: view === null ? definition.name : `${definition.name}: ${view.settings.name}`,
    current: collectionPath(definition.key),
    code: moduleCodes.collections,
    crumbs: [{ label: pageNames.collections, href: collectionsPath() }, { label: definition.name }],
    tabs: tabsOf(scene),
  };
}

function Shaped(props: { readonly scene: CollectionScene; readonly head: Head }) {
  const { scene, head } = props;
  const body = (
    <>
      <Body scene={scene} />
      <More scene={scene} />
    </>
  );
  if (scene.view?.settings.layout === 'board' && scene.layout !== null) {
    return <BoardShape head={head}>{body}</BoardShape>;
  }
  return <ListShape head={head}>{body}</ListShape>;
}

async function renderCollection(c: Context<AppEnv>, viewId: string | null): Promise<Response> {
  const screen = screenKernel(c);
  const database = c.get('database');
  if (screen === null || database === null) return screenRefusal(c);
  const scene = await collectionScene(c, screen, viewId);
  if (scene === null) return notFound(c);
  const { definition } = scene.stored;
  const reply = await collectionReply(database.db, scene.stored, screen.caller.actor, screen.at);
  const areas = definition.rowSource === 'people' ? [] : writableAreas(screen);
  const head = {
    eyebrow: areaLabel(definition.jdArea),
    title: definition.name,
    lede: definition.description || undefined,
    actions: (
      <Actions
        scene={scene}
        admin={reply.capabilities.admin}
        newRow={<NewRow scene={scene} areas={areas} templates={reply.templates} />}
      />
    ),
  };
  return renderScreen(
    c,
    { ...specOf(scene), ...(await collectionPrinted(c, scene)) },
    <Shaped scene={scene} head={head} />,
  );
}

export function collectionScreen(c: Context<AppEnv>): Promise<Response> {
  return renderCollection(c, null);
}

export function collectionViewScreen(c: Context<AppEnv>): Promise<Response> {
  return renderCollection(c, c.req.param('viewId') ?? '');
}
