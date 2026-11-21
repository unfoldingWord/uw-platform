import { asc, eq } from 'drizzle-orm';
import type { CreateRowCommand, PageType, SetPropertyCommand } from '@uw/contracts';
import { can } from '@uw/core/acl';
import type { Database, Transaction } from '@uw/db/client';
import { collectionTemplates } from '@uw/db/schema';
import { slugFor } from '../pages/copy.ts';
import {
  createCollectionPage,
  existingPagesIn,
  lockedCollectionPage,
  setRelationLinks,
  type CollectionPageRow,
  type WriteSource,
  setReverseLinks,
  writeCollectionPage,
} from '../pages/collection-pages.ts';
import {
  mayWriteDirectory,
  writeDirectoryColumn,
  type DirectoryColumn,
} from '../people/directory-entries.ts';
import { insertTaskRow, lockedTask, writeTaskColumn, type TaskColumn } from '../tasks/columns.ts';
import type { Request } from './definition-commands.ts';
import { loadCollection, type StoredCollection } from './definitions.ts';
import { refusal, type CollectionOutcome, type Done } from './outcome.ts';
import { mayReadCollection, scopeOf } from './reader.ts';
import { settle } from './requests.ts';
import { checkValue, columnOf, listOf, requiredMissing, type Checked } from './row-values.ts';
import type { Scope } from './query/scope.ts';

type Valid = Extract<Checked, { ok: true }>;

async function templateOf(tx: Transaction, stored: StoredCollection, id: string | null) {
  if (id === null) return { values: {}, bodyMd: '' };
  const [row] = await tx
    .select()
    .from(collectionTemplates)
    .where(eq(collectionTemplates.id, id))
    .orderBy(asc(collectionTemplates.position));
  if (row === undefined || row.collectionId !== stored.id) return null;
  return { values: row.values as Record<string, unknown>, bodyMd: row.bodyMd };
}

function checkAll(
  scope: Scope,
  values: Record<string, unknown>,
): { ok: true; valid: Valid[] } | { ok: false; done: Done } {
  const valid: Valid[] = [];
  for (const [key, value] of Object.entries(values)) {
    const checked = checkValue(scope, key, value, null);
    if (!checked.ok) return { ok: false, done: refusal(checked.reason) };
    valid.push(checked);
  }
  return { ok: true, valid };
}

async function relationTargets(
  tx: Transaction,
  scope: Scope,
  checked: Valid,
): Promise<string[] | null> {
  if (checked.property.config.type !== 'relation') return [];
  const ids = listOf(checked.value);
  const target = scope.targets.get(checked.property.config.relation.target);
  if (target === undefined) return null;
  if (target.definition.rowSource !== 'pages') return ids;
  const found = await existingPagesIn(tx, target.id, ids);
  return ids.every((id) => found.has(id)) ? ids : null;
}

async function writeRelation(
  tx: Transaction,
  scope: Scope,
  rowId: string,
  checked: Valid,
): Promise<boolean> {
  if (checked.property.config.type !== 'relation') return true;
  const targets = await relationTargets(tx, scope, checked);
  if (targets === null) return false;
  const { target, reverse_of } = checked.property.config.relation;
  if (reverse_of === null) {
    await setRelationLinks(tx, rowId, `${scope.definition.key}.${checked.property.key}`, targets);
    return true;
  }
  const other = scope.targets.get(target)?.definition.properties.find((p) => p.key === reverse_of);
  const single = other?.config.type === 'relation' && !other.config.relation.multiple;
  await setReverseLinks(tx, rowId, `${target}.${reverse_of}`, { sources: targets, single });
  return true;
}

type Creation = {
  readonly tx: Transaction;
  readonly scope: Scope;
  readonly command: CreateRowCommand;
  readonly request: Request;
};

async function createPageRow(creation: Creation, body: string, valid: Valid[]): Promise<Done> {
  const { tx, scope, command, request } = creation;
  const stored = scope.definition;
  const frontmatter: Record<string, unknown> = {};
  for (const checked of valid) {
    if (checked.property.source.kind === 'frontmatter' && checked.value !== null)
      frontmatter[checked.property.key] = checked.value;
  }
  if (requiredMissing(stored, frontmatter)) return refusal('invalid_value');
  const page = await createCollectionPage(
    tx,
    {
      pageId: command.rowId,
      collectionId: scope.collectionId,
      type: stored.pageType as PageType,
      jdArea: command.jdArea,
      slug: slugFor(command.title, command.rowId),
      title: command.title,
      frontmatter,
      bodyMd: body,
    },
    {
      actor: request.actor,
      traceId: request.traceId,
      requestId: command.requestId,
      at: request.at,
    },
  );
  for (const checked of valid) {
    if (!(await writeRelation(tx, scope, command.rowId, checked))) return refusal('row_not_found');
  }
  return { ok: true, collection: stored.key, version: page.version, rowId: page.id };
}

async function createTaskRow(creation: Creation, valid: Valid[]): Promise<Done> {
  const { tx, scope, command, request } = creation;
  const values: Partial<Record<TaskColumn, unknown>> = {};
  for (const checked of valid) {
    const column = columnOf(checked.property);
    if (column === null) return refusal('property_not_writable');
    values[column as TaskColumn] =
      checked.property.config.type === 'relation' && column === 'page_id'
        ? (listOf(checked.value)[0] ?? null)
        : checked.value;
  }
  await insertTaskRow(
    tx,
    { taskId: command.rowId, jdArea: command.jdArea, title: command.title, values },
    request,
  );
  return { ok: true, collection: scope.definition.key, version: 1, rowId: command.rowId };
}

export function createRow(
  db: Database,
  command: CreateRowCommand,
  request: Request,
): Promise<CollectionOutcome> {
  return settle(db, request.actor, command, async (tx) => {
    const stored = await loadCollection(tx, command.collection);
    if (stored === null || !mayReadCollection(stored, request.actor, request.at))
      return refusal('collection_not_found');
    if (!can(request.actor, 'write', { kind: 'area', area: command.jdArea }, request.at))
      return refusal('not_permitted');
    if (stored.definition.rowSource === 'people') return refusal('not_permitted');
    const template = await templateOf(tx, stored, command.template);
    if (template === null) return refusal('template_not_found');
    const scope = await scopeOf(tx, stored, request.actor, request.at);
    const checked = checkAll(scope, { ...template.values, ...command.values });
    if (!checked.ok) return checked.done;
    const creation = { tx, scope, command, request };
    if (stored.definition.rowSource === 'tasks') return createTaskRow(creation, checked.valid);
    return createPageRow(creation, template.bodyMd, checked.valid);
  });
}

async function writePageValue(
  tx: Transaction,
  page: CollectionPageRow,
  checked: Valid,
  source: WriteSource,
): Promise<number> {
  if (checked.property.config.type === 'title') {
    if (page.title === checked.value) return page.version;
    return (await writeCollectionPage(tx, page, { title: String(checked.value) }, source)).version;
  }
  const key = checked.property.key;
  const before = new Map(Object.entries(page.frontmatter)).get(key) ?? null;
  if (JSON.stringify(before) === JSON.stringify(checked.value)) {
    return page.version;
  }
  const kept = Object.entries(page.frontmatter).filter(([name]) => name !== key);
  const added = checked.value === null ? [] : [[key, checked.value] as const];
  const frontmatter = Object.fromEntries([...kept, ...added]);
  return (await writeCollectionPage(tx, page, { frontmatter }, source)).version;
}

async function setOnPage(
  tx: Transaction,
  scope: Scope,
  command: SetPropertyCommand,
  request: Request,
): Promise<Done> {
  const page = await lockedCollectionPage(tx, command.rowId);
  if (page === null || page.collectionId !== scope.collectionId) return refusal('row_not_found');
  if (!can(request.actor, 'write', { kind: 'area', area: page.jdArea }, request.at)) {
    return refusal('not_permitted');
  }
  const checked = checkValue(scope, command.property, command.value, null);
  if (!checked.ok) return refusal(checked.reason);
  const done = { ok: true as const, collection: scope.definition.key, rowId: page.id };
  if (checked.property.config.type === 'relation') {
    if (!(await writeRelation(tx, scope, page.id, checked))) return refusal('row_not_found');
    return { ...done, version: page.version };
  }
  const { actor, traceId, at } = request;
  const source = { actor, traceId, requestId: command.requestId, at };
  return { ...done, version: await writePageValue(tx, page, checked, source) };
}

async function setOnTask(
  tx: Transaction,
  scope: Scope,
  command: SetPropertyCommand,
  request: Request,
): Promise<Done> {
  const task = await lockedTask(tx, command.rowId);
  if (task === null) return refusal('row_not_found');
  if (!can(request.actor, 'write', { kind: 'area', area: task.jdArea }, request.at))
    return refusal('not_permitted');
  const checked = checkValue(scope, command.property, command.value, null);
  if (!checked.ok) return refusal(checked.reason);
  const column = columnOf(checked.property);
  if (column === null) return refusal('property_not_writable');
  const value = column === 'page_id' ? (listOf(checked.value)[0] ?? null) : checked.value;
  await writeTaskColumn(tx, task, { column: column as TaskColumn, value }, request);
  return { ok: true, collection: scope.definition.key, version: 1, rowId: task.id };
}

async function setOnPerson(
  tx: Transaction,
  scope: Scope,
  command: SetPropertyCommand,
  request: Request,
): Promise<Done> {
  const checked = checkValue(scope, command.property, command.value, command.rowId);
  if (!checked.ok) return refusal(checked.reason);
  const column = columnOf(checked.property);
  if (column === null || column === 'display_name' || column === 'email')
    return refusal('property_not_writable');
  if (!mayWriteDirectory(request.actor, command.rowId, column as DirectoryColumn, request.at))
    return refusal('not_permitted');
  await writeDirectoryColumn(
    tx,
    command.rowId,
    { column: column as DirectoryColumn, value: checked.value },
    request,
  );
  return { ok: true, collection: scope.definition.key, version: 1, rowId: command.rowId };
}

const setters = { pages: setOnPage, tasks: setOnTask, people: setOnPerson } as const;

export async function setPropertyIn(
  tx: Transaction,
  stored: StoredCollection,
  command: SetPropertyCommand,
  request: Request,
): Promise<Done> {
  if (!mayReadCollection(stored, request.actor, request.at)) return refusal('collection_not_found');
  const scope = await scopeOf(tx, stored, request.actor, request.at);
  return setters[stored.definition.rowSource](tx, scope, command, request);
}

export function setProperty(
  db: Database,
  command: SetPropertyCommand,
  request: Request,
): Promise<CollectionOutcome> {
  return settle(db, request.actor, command, async (tx) => {
    const stored = await loadCollection(tx, command.collection);
    if (stored === null) return refusal('collection_not_found');
    return setPropertyIn(tx, stored, command, request);
  });
}
