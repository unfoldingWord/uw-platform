import type { Context } from 'hono';
import type { SavedView } from '@uw/contracts';
import { can } from '@uw/core/acl';
import { Card } from '@uw/ui/components/card.tsx';
import { PlatformCommandForm, commandButton } from '@uw/ui/components/command-form.tsx';
import { SelectField, TextField } from '@uw/ui/components/field.tsx';
import { PageHead } from '@uw/ui/components/page-head.tsx';
import { reasonText } from '@uw/ui/components/text.ts';
import type { AppEnv } from '../../deps.ts';
import { collectionReply } from '../../collections/replies.ts';
import { drawLayout } from '../parts/collection-draw.tsx';
import { COLLECTIONS_ENDPOINT } from '../parts/collection-edit.tsx';
import { collectionScene, type CollectionScene } from '../parts/collection-scene.ts';
import { renderScreen, screenKernel, screenRefusal, type ScreenKernel } from '../parts/frame.tsx';
import { areaLabel, everyArea, moduleCodes, pageNames } from '../parts/names.ts';
import { pageLink } from '../parts/page-shown.ts';
import {
  collectionExportPath,
  collectionPath,
  collectionSettingsPath,
  collectionsPath,
  collectionViewPath,
} from '../parts/paths.ts';
import { notFound } from './not-found.tsx';

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

function NewRow(props: {
  readonly scene: CollectionScene;
  readonly areas: readonly string[];
  readonly templates: readonly { readonly id: string; readonly name: string }[];
}) {
  const { stored, view } = props.scene;
  const key = stored.definition.key;
  const chosen = view?.settings.defaultTemplate ?? props.templates[0]?.id ?? '';
  return (
    <Card title="New row" sub="Created in the area you choose">
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
            choices={[
              { value: '', label: 'None' },
              ...props.templates.map((t) => ({ value: t.id, label: t.name })),
            ]}
          />
        )}
        <button type="submit" class={commandButton}>
          Create
        </button>
      </PlatformCommandForm>
    </Card>
  );
}

function Body(props: { readonly scene: CollectionScene }) {
  const { scene } = props;
  if (scene.view === null)
    return <p class="m-0 text-sm text-text-2">This collection has no saved view yet.</p>;
  if (scene.refusal !== null || scene.layout === null) {
    return (
      <p class="m-0 rounded-md border border-dashed border-line p-4 text-sm text-text-2">{`This view cannot be shown to you: ${reasonText(scene.refusal ?? 'not_permitted').toLowerCase()}.`}</p>
    );
  }
  return <>{drawLayout(scene.view.settings.layout, scene.layout)}</>;
}

function More(props: { readonly scene: CollectionScene }) {
  const { stored, view, layout } = props.scene;
  const next = layout?.reply.next ?? null;
  if (view === null || next === null) return null;
  const month = view.settings.layout === 'calendar' ? `&month=${layout?.month ?? ''}` : '';
  return (
    <p class="m-0 text-sm">
      <a
        href={collectionViewPath(stored.definition.key, view.id, `?cursor=${next}${month}`)}
        class={pageLink}
      >
        Next rows
      </a>
    </p>
  );
}

function Actions(props: { readonly scene: CollectionScene; readonly admin: boolean }) {
  const { key } = props.scene.stored.definition;
  const view = props.scene.view;
  return (
    <>
      {view === null ? null : (
        <a href={collectionExportPath(key, view.id)} class={pageLink}>
          Export CSV
        </a>
      )}
      <a href={collectionSettingsPath(key)} class={pageLink}>
        {props.admin ? 'Properties and views' : 'Properties'}
      </a>
    </>
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

async function renderCollection(c: Context<AppEnv>, viewId: string | null): Promise<Response> {
  const screen = screenKernel(c);
  const database = c.get('database');
  if (screen === null || database === null) return screenRefusal(c);
  const scene = await collectionScene(c, screen, viewId);
  if (scene === null) return notFound(c);
  const { definition } = scene.stored;
  const reply = await collectionReply(database.db, scene.stored, screen.caller.actor, screen.at);
  const areas = definition.rowSource === 'people' ? [] : writableAreas(screen);
  return renderScreen(
    c,
    specOf(scene),
    <>
      <PageHead
        eyebrow={areaLabel(definition.jdArea)}
        title={definition.name}
        lede={definition.description || undefined}
        actions={<Actions scene={scene} admin={reply.capabilities.admin} />}
      />
      <div class="flex flex-col gap-5">
        <Body scene={scene} />
        <More scene={scene} />
        {areas.length > 0 ? (
          <NewRow scene={scene} areas={areas} templates={reply.templates} />
        ) : null}
      </div>
    </>,
  );
}

export function collectionScreen(c: Context<AppEnv>): Promise<Response> {
  return renderCollection(c, null);
}

export function collectionViewScreen(c: Context<AppEnv>): Promise<Response> {
  return renderCollection(c, c.req.param('viewId') ?? '');
}
