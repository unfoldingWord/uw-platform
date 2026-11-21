import type { Context } from 'hono';
import {
  groupableType,
  layoutSchema,
  sortableType,
  storedTypes,
  type CollectionReply,
  type PropertyDefinition,
  type SavedView,
} from '@uw/contracts';
import { Card } from '@uw/ui/components/card.tsx';
import { PlatformCommandForm, commandButton } from '@uw/ui/components/command-form.tsx';
import { SelectField, TextAreaField, TextField } from '@uw/ui/components/field.tsx';
import { PageHead } from '@uw/ui/components/page-head.tsx';
import type { AppEnv } from '../../deps.ts';
import { ensureBuiltIns } from '../../collections/builtins/seed.ts';
import { loadCollection } from '../../collections/definitions.ts';
import { mayReadCollection } from '../../collections/reader.ts';
import { collectionReply } from '../../collections/replies.ts';
import { viewsOf } from '../../collections/view-rows.ts';
import { COLLECTIONS_ENDPOINT } from '../parts/collection-edit.tsx';
import { renderScreen, screenKernel, screenRefusal } from '../parts/frame.tsx';
import { areaLabel, moduleCodes, pageNames } from '../parts/names.ts';
import { collectionPath, collectionSettingsPath, collectionsPath } from '../parts/paths.ts';
import { notFound } from './not-found.tsx';

const typeNames: ReadonlyMap<string, string> = new Map([
  ['multi_select', 'multi-select'],
  ['date_range', 'date range'],
  ['read_through', 'read-through'],
  ['created_time', 'created time'],
  ['created_by', 'created by'],
  ['edited_time', 'edited time'],
  ['edited_by', 'edited by'],
  ['completed_time', 'completed time'],
]);

const typeName = (type: string) => typeNames.get(type) ?? type;

const layoutNames: ReadonlyMap<string, string> = new Map([
  ['table', 'Table'],
  ['board', 'Board'],
  ['list', 'List'],
  ['gallery', 'Gallery'],
  ['calendar', 'Calendar'],
  ['chart', 'Chart'],
]);

function sourceName(property: PropertyDefinition): string {
  if (property.source.kind === 'column') return `column ${property.source.column}`;
  return property.source.kind === 'frontmatter' ? 'page frontmatter' : 'worked out';
}

function RemoveProperty(props: {
  readonly collection: string;
  readonly property: PropertyDefinition;
}) {
  const scope = `${props.collection}-${props.property.key}`;
  return (
    <PlatformCommandForm
      endpoint={COLLECTIONS_ENDPOINT}
      command="remove_property"
      scope={scope}
      done="Removed"
    >
      <input type="hidden" name="collection" value={props.collection} />
      <input type="hidden" name="property" value={props.property.key} />
      <button type="submit" class={commandButton}>{`Remove ${props.property.name}`}</button>
    </PlatformCommandForm>
  );
}

function PropertyRow(props: {
  readonly reply: CollectionReply;
  readonly property: PropertyDefinition;
  readonly editable: boolean;
}) {
  const { property } = props;
  const removable = props.editable && property.config.type !== 'title';
  return (
    <li class="flex flex-col gap-1 px-4 py-3">
      <p class="m-0 text-sm">
        <span class="font-heavy">{property.name}</span>
        <span class="text-text-3">{` · ${property.key} · ${typeName(property.config.type)} · ${sourceName(property)}`}</span>
        {property.classification === 'internal' ? null : (
          <span class="text-text-3">{` · ${property.classification}, read by ${property.rule?.steward ?? 'its own area'}${property.rule?.owner === true ? ' and the row’s person' : ''}`}</span>
        )}
      </p>
      {removable ? (
        <RemoveProperty collection={props.reply.collection.key} property={property} />
      ) : null}
    </li>
  );
}

function AddProperty(props: { readonly collection: string }) {
  const types = storedTypes
    .filter((type) => type !== 'title')
    .map((type) => ({ value: type, label: typeName(type) }));
  return (
    <Card title="Add a property" sub="Stored in each page's frontmatter">
      <PlatformCommandForm
        endpoint={COLLECTIONS_ENDPOINT}
        command="add_property"
        scope={props.collection}
        done="Added. Reload to see it."
      >
        <input type="hidden" name="collection" value={props.collection} />
        <TextField
          name="key"
          label="Key"
          scope={props.collection}
          maxLength={48}
          required
          hint="Lowercase letters, digits and underscores"
        />
        <TextField name="name" label="Name" scope={props.collection} maxLength={80} required />
        <SelectField name="type" label="Type" scope={props.collection} choices={types} />
        <TextField
          name="options"
          label="Options"
          scope={props.collection}
          maxLength={2000}
          hint="Names separated by commas. A status needs at least three: the first is to do and the last is complete."
        />
        <button type="submit" class={commandButton}>
          Add property
        </button>
      </PlatformCommandForm>
    </Card>
  );
}

function ChangeType(props: {
  readonly collection: string;
  readonly properties: readonly PropertyDefinition[];
}) {
  const stored = props.properties.filter((p) => p.source.kind === 'frontmatter');
  if (stored.length === 0) return null;
  const types = storedTypes
    .filter((type) => type !== 'title')
    .map((type) => ({ value: type, label: typeName(type) }));
  const scope = `${props.collection}-type`;
  return (
    <Card
      title="Change a property's type"
      sub="Every row is converted, or none is and the rows that do not fit are listed"
    >
      <PlatformCommandForm
        endpoint={COLLECTIONS_ENDPOINT}
        command="change_property_type"
        scope={scope}
        done="Changed"
      >
        <input type="hidden" name="collection" value={props.collection} />
        <SelectField
          name="property"
          label="Property"
          scope={scope}
          choices={stored.map((p) => ({ value: p.key, label: p.name }))}
        />
        <SelectField name="type" label="New type" scope={scope} choices={types} />
        <TextField
          name="options"
          label="Options"
          scope={scope}
          maxLength={2000}
          hint="Names separated by commas. A status needs at least three: the first is to do and the last is complete."
        />
        <button type="submit" class={commandButton}>
          Change type
        </button>
      </PlatformCommandForm>
    </Card>
  );
}

function CollectionForm(props: { readonly reply: CollectionReply }) {
  const { collection, definition } = props.reply;
  const scope = `${collection.key}-collection`;
  return (
    <Card
      title="Collection"
      sub={collection.locked ? 'Locked: unlock to change its properties' : undefined}
    >
      <PlatformCommandForm
        endpoint={COLLECTIONS_ENDPOINT}
        command="update_collection"
        scope={scope}
        done="Saved"
      >
        <input type="hidden" name="collection" value={collection.key} />
        <TextField
          name="name"
          label="Name"
          scope={scope}
          value={collection.name}
          maxLength={80}
          required
        />
        <TextAreaField
          name="description"
          label="Description"
          scope={scope}
          value={definition.description}
          maxLength={1000}
          rows={2}
        />
        <SelectField
          name="locked"
          label="Locked"
          scope={scope}
          selected={collection.locked ? 'true' : 'false'}
          choices={[
            { value: 'true', label: 'Locked' },
            { value: 'false', label: 'Unlocked' },
          ]}
        />
        <button type="submit" class={commandButton}>
          Save
        </button>
      </PlatformCommandForm>
    </Card>
  );
}

function ViewRow(props: { readonly view: SavedView; readonly writable: boolean }) {
  const { view } = props;
  return (
    <li class="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
      <span class="font-heavy">{view.settings.name}</span>
      <span class="text-text-3">{`${layoutNames.get(view.settings.layout) ?? view.settings.layout} · ${view.settings.scope === 'shared' ? 'Shared' : 'Only you'}`}</span>
      {props.writable || view.settings.scope === 'personal' ? (
        <PlatformCommandForm
          endpoint={COLLECTIONS_ENDPOINT}
          command="delete_view"
          scope={view.id}
          done="Deleted"
        >
          <input type="hidden" name="viewId" value={view.id} />
          <button type="submit" class={commandButton}>{`Delete ${view.settings.name}`}</button>
        </PlatformCommandForm>
      ) : null}
    </li>
  );
}

const shareChoices = [
  { value: 'personal', label: 'Only you' },
  { value: 'shared', label: 'Everyone who reads it' },
];
const directions = [
  { value: 'asc', label: 'Ascending' },
  { value: 'desc', label: 'Descending' },
];

function ViewShape(props: {
  readonly scope: string;
  readonly properties: readonly PropertyDefinition[];
}) {
  const choose = (keep: (p: PropertyDefinition) => boolean) => [
    { value: '', label: 'None' },
    ...props.properties.filter(keep).map((p) => ({ value: p.key, label: p.name })),
  ];
  const { scope } = props;
  return (
    <>
      <SelectField
        name="group"
        label="Group by"
        scope={scope}
        choices={choose((p) => groupableType(p.config.type))}
      />
      <SelectField
        name="sort"
        label="Sort by"
        scope={scope}
        choices={choose((p) => sortableType(p.config.type))}
      />
      <SelectField name="direction" label="Direction" scope={scope} choices={directions} />
      <SelectField
        name="dateProperty"
        label="Calendar date"
        scope={scope}
        choices={choose((p) => p.config.type === 'date' || p.config.type === 'date_range')}
      />
    </>
  );
}

function NewView(props: { readonly reply: CollectionReply; readonly writable: boolean }) {
  const key = props.reply.collection.key;
  const scope = `${key}-view`;
  return (
    <Card title="New view">
      <PlatformCommandForm
        endpoint={COLLECTIONS_ENDPOINT}
        command="save_view"
        scope={scope}
        done="Saved. Reload to see it."
      >
        <input type="hidden" name="collection" value={key} />
        <input type="hidden" name="viewId" value={crypto.randomUUID()} />
        <TextField name="name" label="Name" scope={scope} maxLength={80} required />
        <SelectField
          name="layout"
          label="Layout"
          scope={scope}
          choices={layoutSchema.options.map((l) => ({ value: l, label: layoutNames.get(l) ?? l }))}
        />
        <SelectField
          name="scope"
          label="Shared with"
          scope={scope}
          choices={props.writable ? shareChoices : shareChoices.slice(0, 1)}
        />
        <ViewShape scope={scope} properties={props.reply.definition.properties} />
        <button type="submit" class={commandButton}>
          Save view
        </button>
      </PlatformCommandForm>
    </Card>
  );
}

function Templates(props: { readonly reply: CollectionReply }) {
  const key = props.reply.collection.key;
  const scope = `${key}-template`;
  return (
    <Card title="Row templates" sub="A new row can start from one; a view names its default">
      {props.reply.templates.length === 0 ? (
        <p class="m-0 text-sm text-text-3">No template yet.</p>
      ) : (
        <ul class="m-0 flex list-none flex-col gap-1 p-0 text-sm">
          {props.reply.templates.map((t) => (
            <li>{t.name}</li>
          ))}
        </ul>
      )}
      <PlatformCommandForm
        endpoint={COLLECTIONS_ENDPOINT}
        command="save_template"
        scope={scope}
        done="Saved"
      >
        <input type="hidden" name="collection" value={key} />
        <input type="hidden" name="templateId" value={crypto.randomUUID()} />
        <TextField name="name" label="Template name" scope={scope} maxLength={80} required />
        <TextAreaField name="bodyMd" label="Body" scope={scope} maxLength={100000} rows={4} />
        <button type="submit" class={commandButton}>
          Save template
        </button>
      </PlatformCommandForm>
    </Card>
  );
}

function Settings(props: {
  readonly reply: CollectionReply;
  readonly views: readonly SavedView[];
}) {
  const { reply } = props;
  const { admin, write } = reply.capabilities;
  const editable = admin && !reply.collection.locked;
  const key = reply.collection.key;
  return (
    <div class="flex flex-col gap-5">
      <Card title="Properties" flush>
        <ul class="m-0 flex list-none flex-col divide-y divide-line-soft p-0">
          {reply.definition.properties.map((property) => (
            <PropertyRow reply={reply} property={property} editable={editable} />
          ))}
        </ul>
      </Card>
      {editable ? <AddProperty collection={key} /> : null}
      {editable ? <ChangeType collection={key} properties={reply.definition.properties} /> : null}
      {admin ? <CollectionForm reply={reply} /> : null}
      <Card title="Saved views" flush>
        <ul class="m-0 flex list-none flex-col divide-y divide-line-soft p-0">
          {props.views.map((view) => (
            <ViewRow view={view} writable={write} />
          ))}
        </ul>
      </Card>
      <NewView reply={reply} writable={write} />
      {write ? <Templates reply={reply} /> : null}
    </div>
  );
}

function specOf(reply: CollectionReply) {
  const { key, name } = reply.collection;
  return {
    title: `${name}: ${pageNames.collectionSettings}`,
    current: collectionSettingsPath(key),
    code: moduleCodes.collections,
    crumbs: [
      { label: pageNames.collections, href: collectionsPath() },
      { label: name, href: collectionPath(key) },
      { label: pageNames.collectionSettings },
    ],
  };
}

export async function collectionSettingsScreen(c: Context<AppEnv>): Promise<Response> {
  const screen = screenKernel(c);
  const database = c.get('database');
  if (screen === null || database === null) return screenRefusal(c);
  await ensureBuiltIns(database.db, screen.at);
  const stored = await loadCollection(database.db, c.req.param('key') ?? '');
  if (stored === null || !mayReadCollection(stored, screen.caller.actor, screen.at)) {
    return notFound(c);
  }
  const reply = await collectionReply(database.db, stored, screen.caller.actor, screen.at);
  const views = await viewsOf(database.db, stored, screen.caller.actor.personId);
  const { collection } = reply;
  return renderScreen(
    c,
    specOf(reply),
    <>
      <PageHead
        eyebrow={areaLabel(collection.jdArea)}
        title={`${collection.name} properties and views`}
        lede={`Version ${collection.version}. Only an admin of ${collection.jdArea} changes the properties.`}
      />
      <Settings reply={reply} views={views} />
    </>,
  );
}
