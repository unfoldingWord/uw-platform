import { inArray } from 'drizzle-orm';
import { rowQuerySchema } from '@uw/contracts';
import type {
  CollectionRow,
  ErrorReason,
  PropertyDefinition,
  RowGroup,
  RowGrouping,
  RowQuery,
  RowsReply,
  SavedView,
} from '@uw/contracts';
import { can } from '@uw/core/acl';
import type { Principal } from '@uw/core/principal';
import type { Executor } from '@uw/db/client';
import { pages, people, tasks } from '@uw/db/schema';
import { allCollections, type StoredCollection } from './definitions.ts';
import { declaredGroupOrder, EMPTY_GROUP, type CompiledGroup } from './query/order.ts';
import { groupSums, planOf, runQuery, type RowsResult } from './query/run.ts';
import { accessOf, scopeFor, type Scope, type Target } from './query/scope.ts';

export type Read<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: ErrorReason };

export function mayReadCollection(stored: StoredCollection, actor: Principal, at: Date): boolean {
  return can(actor, 'read', { kind: 'area', area: stored.definition.jdArea }, at);
}

export async function scopeOf(
  db: Executor,
  stored: StoredCollection,
  actor: Principal,
  at: Date,
): Promise<Scope> {
  const targets = new Map<string, Target>(
    (await allCollections(db)).map((other) => [
      other.definition.key,
      { id: other.id, definition: other.definition },
    ]),
  );
  return scopeFor(stored.definition, stored.id, actor, at, targets);
}

function optionLabel(property: PropertyDefinition, value: string): string | null {
  const { config } = property;
  if (config.type === 'select' || config.type === 'status' || config.type === 'multi_select') {
    return config.options.find((option) => option.id === value)?.name ?? null;
  }
  return null;
}

const statusGroupLabels: ReadonlyMap<string, string> = new Map([
  ['to_do', 'To do'],
  ['in_progress', 'In progress'],
  ['complete', 'Complete'],
]);

async function namedValues(db: Executor, group: CompiledGroup, values: readonly string[]) {
  const ids = values.filter((v) => /^[0-9a-f-]{36}$/.test(v));
  const names = new Map<string, string>();
  if (ids.length === 0) return names;
  const { type } = group.property.config;
  if (type === 'person') {
    const rows = await db
      .select({ id: people.id, name: people.displayName })
      .from(people)
      .where(inArray(people.id, ids));
    for (const row of rows) names.set(row.id, row.name);
  }
  if (type === 'relation') {
    const rows = await db
      .select({ id: pages.id, name: pages.title })
      .from(pages)
      .where(inArray(pages.id, ids));
    const more = await db
      .select({ id: tasks.id, name: tasks.title })
      .from(tasks)
      .where(inArray(tasks.id, ids));
    for (const row of [...rows, ...more]) names.set(row.id, row.name);
  }
  return names;
}

function labelOf(group: CompiledGroup, value: string, names: ReadonlyMap<string, string>): string {
  if (value === EMPTY_GROUP) return `No ${group.property.name.toLowerCase()}`;
  if (group.by === 'status_group') return statusGroupLabels.get(value) ?? value;
  if (group.property.config.type === 'checkbox') return value === 'true' ? 'Checked' : 'Unchecked';
  return optionLabel(group.property, value) ?? names.get(value) ?? value;
}

function groupOrderFor(group: CompiledGroup | null, view: SavedView | null): string[] {
  if (group === null) return [];
  const chosen = (view?.settings.groups ?? []).map((g) => g.value);
  const declared = declaredGroupOrder(group).filter((value) => !chosen.includes(value));
  return [...chosen, ...declared, EMPTY_GROUP];
}

async function groupsOf(
  db: Executor,
  result: RowsResult,
  view: SavedView | null,
  order: readonly string[],
): Promise<RowGroup[] | null> {
  const { group, counts } = result;
  if (group === null || counts === null) return null;
  const seen = [...counts.keys()].filter((value) => !order.includes(value)).sort();
  const values = [...order, ...seen];
  const names = await namedValues(db, group, [...counts.keys()]);
  const settings = new Map((view?.settings.groups ?? []).map((g) => [g.value, g]));
  return values
    .map((value) => ({
      value,
      label: labelOf(group, value, names),
      count: counts.get(value) ?? 0,
      wipLimit: settings.get(value)?.wipLimit ?? null,
      visible: settings.get(value)?.visible ?? true,
    }))
    .filter((g) => !(view?.settings.hideEmptyGroups ?? false) || g.count > 0)
    .filter((g) => g.value !== EMPTY_GROUP || g.count > 0);
}

function columnsFor(scope: Scope, view: SavedView | null) {
  const visible = scope.definition.properties.filter((p) => accessOf(scope, p) !== 'none');
  const chosen = view?.settings.properties.filter((p) => p.visible).map((p) => p.property) ?? [];
  const ordered =
    chosen.length === 0 ? visible : chosen.flatMap((key) => visible.filter((p) => p.key === key));
  return ordered.map((p) => ({ key: p.key, name: p.name, type: p.config.type }));
}

export async function readRows(
  db: Executor,
  stored: StoredCollection,
  actor: Principal,
  at: Date,
  request: { readonly query: RowQuery; readonly view: SavedView | null },
): Promise<Read<RowsReply>> {
  if (!mayReadCollection(stored, actor, at)) return { ok: false, reason: 'collection_not_found' };
  const scope = await scopeOf(db, stored, actor, at);
  const { view, query } = request;
  const plan = planOf(scope, query);
  if (!plan.ok) return { ok: false, reason: plan.reason };
  const order = groupOrderFor(plan.value.group, view);
  const result = await runQuery(db, scope, {
    query,
    viewId: view?.id ?? null,
    manualOrder: view?.settings.manualOrder ?? false,
    groupOrder: order,
  });
  if (!result.ok) return { ok: false, reason: result.reason };
  const withheld = scope.definition.properties
    .filter((p) => accessOf(scope, p) === 'none')
    .map((p) => p.key);
  return {
    ok: true,
    value: {
      collection: stored.definition.key,
      view,
      columns: columnsFor(scope, view),
      rows: [...result.value.rows],
      groups: await groupsOf(db, result.value, view, order),
      withheld,
      next: result.value.next,
    },
  };
}

export async function readRow(
  db: Executor,
  stored: StoredCollection,
  actor: Principal,
  at: Date,
  row: string | { readonly id: string; readonly grouping: RowGrouping | null },
): Promise<CollectionRow | null> {
  const rowId = typeof row === 'string' ? row : row.id;
  const grouping = typeof row === 'string' ? null : row.grouping;
  if (!mayReadCollection(stored, actor, at)) return null;
  const scope = await scopeOf(db, stored, actor, at);
  const query = rowQuerySchema.parse({ limit: 1, group: grouping });
  const result = await runQuery(db, scope, {
    query,
    viewId: null,
    manualOrder: false,
    groupOrder: [],
    only: rowId,
  });
  return result.ok ? (result.value.rows[0] ?? null) : null;
}

export async function readGroupSums(
  db: Executor,
  stored: StoredCollection,
  actor: Principal,
  at: Date,
  request: { readonly query: RowQuery; readonly sum: string },
): Promise<ReadonlyMap<string, number> | null> {
  if (!mayReadCollection(stored, actor, at)) return null;
  const scope = await scopeOf(db, stored, actor, at);
  return groupSums(db, scope, request.query, request.sum);
}
