import { asc, eq } from 'drizzle-orm';
import {
  compileRowSchema,
  type CreateRowCommand,
  type JdArea,
  type PageType,
  type SetPropertyCommand,
} from '@uw/contracts';
import { can } from '@uw/core/acl';
import type { Database, Transaction } from '@uw/db/client';
import { collectionTemplates, pages } from '@uw/db/schema';
import { slugFor } from '../pages/copy.ts';
import {
  createCollectionPage,
  areasOfPagesIn,
  relationTargets,
  reverseSources,
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
import { personById } from '../people/directory.ts';
import {
  areasOfTasks,
  insertTaskRow,
  isTaskColumn,
  lockedTask,
  writeTaskColumn,
  type TaskColumn,
} from '../tasks/columns.ts';
import type { Request } from './definition-commands.ts';
import { loadCollection, type StoredCollection } from './definitions.ts';
import { refusal, type CollectionOutcome, type Done } from './outcome.ts';
import { mayReadCollection, scopeOf } from './reader.ts';
import { settle } from './requests.ts';
import { checkValue, columnOf, listOf, type Checked } from './row-values.ts';
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

async function targetAreas(
  tx: Transaction,
  scope: Scope,
  target: string,
  ids: readonly string[],
): Promise<ReadonlyMap<string, JdArea> | null> {
  const found = scope.targets.get(target);
  if (found === undefined) return null;
  if (found.definition.rowSource === 'tasks') return areasOfTasks(tx, ids);
  if (found.definition.rowSource !== 'pages') return null;
  return areasOfPagesIn(tx, found.id, ids);
}

function readsAll(scope: Scope, ids: readonly string[], areas: ReadonlyMap<string, JdArea>) {
  return ids.every((id) => {
    const area = areas.get(id);
    return area !== undefined && can(scope.actor, 'read', { kind: 'area', area }, scope.at);
  });
}

function writesAll(scope: Scope, areas: Iterable<JdArea>): boolean {
  return [...areas].every((area) => can(scope.actor, 'write', { kind: 'area', area }, scope.at));
}

function mayRead(scope: Scope, area: JdArea | undefined): boolean {
  return area !== undefined && can(scope.actor, 'read', { kind: 'area', area }, scope.at);
}

async function unseenTargets(
  tx: Transaction,
  scope: Scope,
  target: string,
  current: readonly string[],
): Promise<string[]> {
  const areas = await targetAreas(tx, scope, target, current);
  return current.filter((id) => areas !== null && areas.has(id) && !mayRead(scope, areas.get(id)));
}

async function writeForward(
  tx: Transaction,
  scope: Scope,
  rowId: string,
  checked: Valid,
): Promise<Done | null> {
  if (checked.property.config.type !== 'relation') return null;
  const { target, multiple } = checked.property.config.relation;
  const ids = listOf(checked.value);
  const rel = `${scope.definition.key}.${checked.property.key}`;
  const unseen = await unseenTargets(tx, scope, target, await relationTargets(tx, rowId, rel));
  if (!multiple && unseen.length > 0) return refusal('not_permitted');
  await setRelationLinks(tx, rowId, rel, [...ids, ...unseen.filter((id) => !ids.includes(id))]);
  return null;
}

async function writeReverse(
  tx: Transaction,
  scope: Scope,
  rowId: string,
  change: Reverse,
): Promise<Done | null> {
  const rel = `${change.target}.${change.reverseOf}`;
  const current = await reverseSources(tx, rowId, rel);
  const unseen = [...current.keys()].filter((id) => !mayRead(scope, current.get(id)));
  const removed = [...current.keys()].filter(
    (id) => !change.sources.includes(id) && !unseen.includes(id),
  );
  const touched = [
    ...removed.map((id) => current.get(id)),
    ...change.sources.map((id) => change.areas.get(id)),
  ];
  if (
    !writesAll(
      scope,
      touched.filter((area): area is JdArea => area !== undefined),
    )
  ) {
    return refusal('not_permitted');
  }
  const sources = [...change.sources, ...unseen.filter((id) => !change.sources.includes(id))];
  await setReverseLinks(tx, rowId, rel, { sources, single: change.single });
  return null;
}

type Reverse = {
  readonly target: string;
  readonly reverseOf: string;
  readonly sources: readonly string[];
  readonly areas: ReadonlyMap<string, JdArea>;
  readonly single: boolean;
};

async function targetsRefusal(tx: Transaction, scope: Scope, checked: Valid): Promise<Done | null> {
  if (checked.property.config.type !== 'relation') return null;
  const ids = listOf(checked.value);
  const areas = await targetAreas(tx, scope, checked.property.config.relation.target, ids);
  return areas !== null && readsAll(scope, ids, areas) ? null : refusal('row_not_found');
}

function taskValue(checked: Valid, column: string): unknown {
  if (column === 'status' && checked.value === null) return undefined;
  return column === 'page_id' ? (listOf(checked.value)[0] ?? null) : checked.value;
}

async function taskValues(
  tx: Transaction,
  scope: Scope,
  valid: readonly Valid[],
): Promise<Partial<Record<TaskColumn, unknown>> | Done> {
  const values: Partial<Record<TaskColumn, unknown>> = {};
  for (const checked of valid) {
    const column = columnOf(checked.property);
    if (column === null || !isTaskColumn(column)) return refusal('property_not_writable');
    const refused = await targetsRefusal(tx, scope, checked);
    if (refused !== null) return refused;
    Object.assign(values, { [column]: taskValue(checked, column) });
  }
  if (scope.actor.kind === 'agent') values.status = 'suggested';
  return values;
}

async function writeRelation(
  tx: Transaction,
  scope: Scope,
  rowId: string,
  checked: Valid,
): Promise<Done | null> {
  if (checked.property.config.type !== 'relation') return null;
  const ids = listOf(checked.value);
  const { target, reverse_of } = checked.property.config.relation;
  const areas = await targetAreas(tx, scope, target, ids);
  if (areas === null || !readsAll(scope, ids, areas)) return refusal('row_not_found');
  if (reverse_of === null) return writeForward(tx, scope, rowId, checked);
  const other = scope.targets.get(target)?.definition.properties.find((p) => p.key === reverse_of);
  const single = other?.config.type === 'relation' && !other.config.relation.multiple;
  return writeReverse(tx, scope, rowId, {
    target,
    reverseOf: reverse_of,
    sources: ids,
    areas,
    single,
  });
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
  if (!compileRowSchema(stored).safeParse(frontmatter).success) return refusal('invalid_value');
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
    const refused = await writeRelation(tx, scope, command.rowId, checked);
    if (refused !== null) return refused;
  }
  return { ok: true, collection: stored.key, version: page.version, rowId: page.id };
}

async function createTaskRow(creation: Creation, valid: Valid[]): Promise<Done> {
  const { tx, scope, command, request } = creation;
  const values = await taskValues(tx, scope, valid);
  if ('ok' in values) return values as Done;
  const row = { taskId: command.rowId, jdArea: command.jdArea, title: command.title, values };
  await insertTaskRow(tx, row, request);
  return { ok: true, collection: scope.definition.key, version: 1, rowId: command.rowId };
}

async function rowExists(tx: Transaction, rowId: string): Promise<boolean> {
  const [page] = await tx.select({ id: pages.id }).from(pages).where(eq(pages.id, rowId));
  if (page !== undefined) return true;
  return (await areasOfTasks(tx, [rowId])).size > 0;
}

export function createRow(
  db: Database,
  command: CreateRowCommand,
  request: Request,
): Promise<CollectionOutcome> {
  return settle(
    db,
    request.actor,
    command,
    async (tx) => {
      const stored = await loadCollection(tx, command.collection);
      if (stored === null || !mayReadCollection(stored, request.actor, request.at))
        return refusal('collection_not_found');
      if (!can(request.actor, 'write', { kind: 'area', area: command.jdArea }, request.at))
        return refusal('not_permitted');
      if (stored.definition.rowSource === 'people') return refusal('not_permitted');
      if (await rowExists(tx, command.rowId)) return refusal('page_exists');
      const template = await templateOf(tx, stored, command.template);
      if (template === null) return refusal('template_not_found');
      const scope = await scopeOf(tx, stored, request.actor, request.at);
      const checked = checkAll(scope, { ...template.values, ...command.values });
      if (!checked.ok) return checked.done;
      const creation = { tx, scope, command, request };
      if (stored.definition.rowSource === 'tasks') return createTaskRow(creation, checked.valid);
      return createPageRow(creation, template.bodyMd, checked.valid);
    },
    'page_exists',
  );
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
    const refused = await writeRelation(tx, scope, page.id, checked);
    return refused ?? { ...done, version: page.version };
  }
  const { actor, traceId, at } = request;
  const source = { actor, traceId, requestId: command.requestId, at };
  return { ...done, version: await writePageValue(tx, page, checked, source) };
}

function taskColumnFor(checked: Valid, status: string, actor: Request['actor']): TaskColumn | Done {
  const column = columnOf(checked.property);
  if (column === null || !isTaskColumn(column)) return refusal('property_not_writable');
  if (column === 'status' && checked.value === null) return refusal('invalid_value');
  if (column === 'status' && status === 'suggested' && actor.kind === 'agent') {
    return refusal('not_permitted');
  }
  return column;
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
  const column = taskColumnFor(checked, task.status, request.actor);
  if (typeof column !== 'string') return column;
  const refused = await targetsRefusal(tx, scope, checked);
  if (refused !== null) return refused;
  await writeTaskColumn(tx, task, { column, value: taskValue(checked, column) ?? null }, request);
  return { ok: true, collection: scope.definition.key, version: 1, rowId: task.id };
}

async function setOnPerson(
  tx: Transaction,
  scope: Scope,
  command: SetPropertyCommand,
  request: Request,
): Promise<Done> {
  if ((await personById(tx, command.rowId)) === null) return refusal('row_not_found');
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
