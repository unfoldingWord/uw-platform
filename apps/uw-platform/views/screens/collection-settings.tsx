import type { Child } from 'hono/jsx';
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
import { Button } from '@uw/ui/components/button.tsx';
import { PlatformCommandForm } from '@uw/ui/components/command-form.tsx';
import { EmptyState } from '@uw/ui/components/empty-state.tsx';
import { SelectField, TextAreaField, TextField } from '@uw/ui/components/field.tsx';
import { ListRow, RowList, revealed } from '@uw/ui/components/list-row.tsx';
import { Hairline, Section } from '@uw/ui/components/section.tsx';
import { FormShape } from '@uw/ui/shapes/form.tsx';
import type { AppEnv } from '../../deps.ts';
import { ensureBuiltIns } from '../../collections/builtins/seed.ts';
import { loadCollection } from '../../collections/definitions.ts';
import { mayReadCollection } from '../../collections/reader.ts';
import { collectionReply } from '../../collections/replies.ts';
import { viewsOf } from '../../collections/view-rows.ts';
import { COLLECTIONS_ENDPOINT, Confirmed, Fields, Submit } from '../parts/collection-edit.tsx';
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

function typeChoices() {
  return storedTypes
    .filter((type) => type !== 'title')
    .map((type) => ({ value: type, label: typeName(type) }));
}

function OptionsField(props: { readonly scope: string }) {
  return (
    <TextField
      name="options"
      label="Options"
      scope={props.scope}
      maxLength={2000}
      hint="Names separated by commas. A status needs at least three: the first is to do and the last is complete."
    />
  );
}

function sourceName(property: PropertyDefinition): string {
  if (property.source.kind === 'column') return `column ${property.source.column}`;
  return property.source.kind === 'frontmatter' ? 'page frontmatter' : 'worked out';
}

function SettingRow(props: {
  readonly title: string;
  readonly meta: string;
  readonly actions?: Child | undefined;
}) {
  return (
    <li class="group/row relative flex min-w-0 items-center gap-3 rounded-md px-3 py-2 transition-colors motion-reveal focus-within:bg-raised hover:bg-raised">
      <div class="min-w-0 flex-1">
        <p class="m-0 text-base font-semibold text-text">{props.title}</p>
        <p class="m-0 text-sm text-text-3">{props.meta}</p>
      </div>
      {props.actions === undefined ? null : (
        <div class={`${revealed} has-open:opacity-100`}>{props.actions}</div>
      )}
    </li>
  );
}

function RemoveProperty(props: {
  readonly collection: string;
  readonly property: PropertyDefinition;
}) {
  const { name } = props.property;
  const scope = `${props.collection}-${props.property.key}`;
  return (
    <Confirmed
      opener="Remove"
      subject={name}
      loss={`Every row loses its ${name} value, and saved views drop their filters and sorts on it. You cannot undo this.`}
    >
      <PlatformCommandForm
        endpoint={COLLECTIONS_ENDPOINT}
        command="remove_property"
        scope={scope}
        done="Removed"
      >
        <input type="hidden" name="collection" value={props.collection} />
        <input type="hidden" name="property" value={props.property.key} />
        <Button type="submit" size="sm">
          Confirm<span class="sr-only">{` remove ${name}`}</span>
        </Button>
      </PlatformCommandForm>
    </Confirmed>
  );
}

function DeleteView(props: { readonly view: SavedView }) {
  const { view } = props;
  const who = view.settings.scope === 'shared' ? 'everyone who uses it' : 'you';
  return (
    <Confirmed
      opener="Delete"
      subject={view.settings.name}
      loss={`${view.settings.name} goes away for ${who}, with its filters, sorts, groups and card order. Page embeds of it stop showing. You cannot undo this.`}
    >
      <PlatformCommandForm
        endpoint={COLLECTIONS_ENDPOINT}
        command="delete_view"
        scope={view.id}
        done="Deleted"
      >
        <input type="hidden" name="viewId" value={view.id} />
        <Button type="submit" size="sm">
          Confirm<span class="sr-only">{` delete ${view.settings.name}`}</span>
        </Button>
      </PlatformCommandForm>
    </Confirmed>
  );
}

function readers(property: PropertyDefinition): string {
  if (property.classification === 'internal') return '';
  const owner = property.rule?.owner === true ? ' and the row’s person' : '';
  return ` · ${property.classification}, read by ${property.rule?.steward ?? 'its own area'}${owner}`;
}

function PropertyRow(props: {
  readonly reply: CollectionReply;
  readonly property: PropertyDefinition;
  readonly editable: boolean;
}) {
  const { property } = props;
  const removable = props.editable && property.config.type !== 'title';
  return (
    <SettingRow
      title={property.name}
      meta={`${property.key} · ${typeName(property.config.type)} · ${sourceName(property)}${readers(property)}`}
      actions={
        removable ? (
          <RemoveProperty collection={props.reply.collection.key} property={property} />
        ) : undefined
      }
    />
  );
}

function AddProperty(props: { readonly collection: string }) {
  return (
    <Section title="Add a property" sub="Stored in each page's frontmatter">
      <PlatformCommandForm
        endpoint={COLLECTIONS_ENDPOINT}
        command="add_property"
        scope={props.collection}
        done="Added. Reload to see it."
      >
        <input type="hidden" name="collection" value={props.collection} />
        <Fields>
          <TextField
            name="key"
            label="Key"
            scope={props.collection}
            maxLength={48}
            required
            hint="Lowercase letters, digits and underscores"
          />
          <TextField name="name" label="Name" scope={props.collection} maxLength={80} required />
          <SelectField name="type" label="Type" scope={props.collection} choices={typeChoices()} />
          <OptionsField scope={props.collection} />
        </Fields>
        <Submit>Add property</Submit>
      </PlatformCommandForm>
    </Section>
  );
}

function ChangeType(props: {
  readonly collection: string;
  readonly properties: readonly PropertyDefinition[];
}) {
  const stored = props.properties.filter((p) => p.source.kind === 'frontmatter');
  if (stored.length === 0) return null;
  const scope = `${props.collection}-type`;
  return (
    <Section
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
        <Fields>
          <SelectField
            name="property"
            label="Property"
            scope={scope}
            choices={stored.map((p) => ({ value: p.key, label: p.name }))}
          />
          <SelectField name="type" label="New type" scope={scope} choices={typeChoices()} />
          <OptionsField scope={scope} />
        </Fields>
        <Submit>Change type</Submit>
      </PlatformCommandForm>
    </Section>
  );
}

function CollectionForm(props: { readonly reply: CollectionReply }) {
  const { collection, definition } = props.reply;
  const scope = `${collection.key}-collection`;
  return (
    <Section
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
        <Fields>
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
        </Fields>
        <Submit>Save</Submit>
      </PlatformCommandForm>
    </Section>
  );
}

function ViewRow(props: { readonly view: SavedView; readonly writable: boolean }) {
  const { view } = props;
  const deletable = props.writable || view.settings.scope === 'personal';
  return (
    <SettingRow
      title={view.settings.name}
      meta={`${layoutNames.get(view.settings.layout) ?? view.settings.layout} · ${view.settings.scope === 'shared' ? 'Shared' : 'Only you'}`}
      actions={deletable ? <DeleteView view={view} /> : undefined}
    />
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
    <Section title="New view">
      <PlatformCommandForm
        endpoint={COLLECTIONS_ENDPOINT}
        command="save_view"
        scope={scope}
        done="Saved. Reload to see it."
      >
        <input type="hidden" name="collection" value={key} />
        <input type="hidden" name="viewId" value={crypto.randomUUID()} />
        <Fields>
          <TextField name="name" label="Name" scope={scope} maxLength={80} required />
          <SelectField
            name="layout"
            label="Layout"
            scope={scope}
            choices={layoutSchema.options.map((l) => ({
              value: l,
              label: layoutNames.get(l) ?? l,
            }))}
          />
          <SelectField
            name="scope"
            label="Shared with"
            scope={scope}
            choices={props.writable ? shareChoices : shareChoices.slice(0, 1)}
          />
          <ViewShape scope={scope} properties={props.reply.definition.properties} />
        </Fields>
        <Submit>Save view</Submit>
      </PlatformCommandForm>
    </Section>
  );
}

function Templates(props: { readonly reply: CollectionReply }) {
  const key = props.reply.collection.key;
  const scope = `${key}-template`;
  return (
    <Section title="Row templates" sub="A new row can start from one; a view names its default">
      {props.reply.templates.length === 0 ? (
        <EmptyState title="No template yet." />
      ) : (
        <RowList label="Row templates">
          {props.reply.templates.map((t) => (
            <ListRow title={t.name} />
          ))}
        </RowList>
      )}
      <PlatformCommandForm
        endpoint={COLLECTIONS_ENDPOINT}
        command="save_template"
        scope={scope}
        done="Saved"
      >
        <input type="hidden" name="collection" value={key} />
        <input type="hidden" name="templateId" value={crypto.randomUUID()} />
        <Fields>
          <TextField name="name" label="Template name" scope={scope} maxLength={80} required />
          <TextAreaField name="bodyMd" label="Body" scope={scope} maxLength={100000} rows={4} />
        </Fields>
        <Submit>Save template</Submit>
      </PlatformCommandForm>
    </Section>
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
    <>
      <Section title="Properties" sub={String(reply.definition.properties.length)}>
        <RowList label="Properties">
          {reply.definition.properties.map((property) => (
            <PropertyRow reply={reply} property={property} editable={editable} />
          ))}
        </RowList>
      </Section>
      {editable ? <AddProperty collection={key} /> : null}
      {editable ? <ChangeType collection={key} properties={reply.definition.properties} /> : null}
      {admin ? <CollectionForm reply={reply} /> : null}
      <Hairline />
      <Section title="Saved views" sub={String(props.views.length)}>
        <RowList label="Saved views">
          {props.views.map((view) => (
            <ViewRow view={view} writable={write} />
          ))}
        </RowList>
      </Section>
      <NewView reply={reply} writable={write} />
      {write ? <Templates reply={reply} /> : null}
    </>
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
    <FormShape
      head={{
        eyebrow: areaLabel(collection.jdArea),
        title: `${collection.name} properties and views`,
        lede: `Version ${collection.version}. Only an admin of ${collection.jdArea} changes the properties.`,
      }}
    >
      <Settings reply={reply} views={views} />
    </FormShape>,
  );
}
