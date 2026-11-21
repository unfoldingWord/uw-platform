import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm';
import {
  filterOperatorSchema,
  filterValueSchema,
  layoutSchema,
  savedViewSchema,
  type FilterCondition,
  type FilterGroup,
  type SavedView,
  type ViewSettings,
} from '@uw/contracts';
import type { Executor, Transaction } from '@uw/db/client';
import {
  collectionViewFilters,
  collectionViewGroups,
  collectionViewProperties,
  collectionViews,
  collectionViewSorts,
} from '@uw/db/schema';
import type { StoredCollection } from './definitions.ts';

type ViewRow = typeof collectionViews.$inferSelect;
type FilterRow = typeof collectionViewFilters.$inferSelect;

function keyOf(stored: StoredCollection, id: string | null): string | null {
  if (id === null) return null;
  for (const [key, value] of stored.propertyIds) if (value === id) return key;
  return null;
}

function idOf(stored: StoredCollection, key: string | null): string | null {
  return key === null ? null : (stored.propertyIds.get(key) ?? null);
}

function conditionOf(stored: StoredCollection, row: FilterRow): FilterCondition[] {
  const property = keyOf(stored, row.propertyId);
  const operator = filterOperatorSchema.safeParse(row.operator);
  if (property === null || !operator.success) return [];
  const value = filterValueSchema.safeParse(row.value);
  if (!value.success) return [];
  return [{ kind: 'condition', property, operator: operator.data, value: value.data }];
}

function groupFrom(
  stored: StoredCollection,
  rows: readonly FilterRow[],
  root: FilterRow,
): FilterGroup {
  const children = rows
    .filter((row) => row.parentId === root.id)
    .sort((a, b) => a.position - b.position)
    .flatMap((row): (FilterCondition | FilterGroup)[] =>
      row.kind === 'group' ? [groupFrom(stored, rows, row)] : conditionOf(stored, row),
    );
  return { kind: 'group', conjunction: root.conjunction === 'or' ? 'or' : 'and', children };
}

function treeOf(stored: StoredCollection, rows: readonly FilterRow[]): FilterGroup | null {
  const root = rows.find((row) => row.kind === 'group' && row.parentId === null);
  return root === undefined ? null : groupFrom(stored, rows, root);
}

async function childrenOf(db: Executor, ids: readonly string[]) {
  if (ids.length === 0) return { properties: [], filters: [], sorts: [], groups: [] };
  const list = [...ids];
  const [properties, filters, sorts, groups] = await Promise.all([
    db
      .select()
      .from(collectionViewProperties)
      .where(inArray(collectionViewProperties.viewId, list))
      .orderBy(asc(collectionViewProperties.position)),
    db.select().from(collectionViewFilters).where(inArray(collectionViewFilters.viewId, list)),
    db
      .select()
      .from(collectionViewSorts)
      .where(inArray(collectionViewSorts.viewId, list))
      .orderBy(asc(collectionViewSorts.position)),
    db
      .select()
      .from(collectionViewGroups)
      .where(inArray(collectionViewGroups.viewId, list))
      .orderBy(asc(collectionViewGroups.position)),
  ]);
  return { properties, filters, sorts, groups };
}

type Children = Awaited<ReturnType<typeof childrenOf>>;

function settingsOf(stored: StoredCollection, row: ViewRow, children: Children): ViewSettings {
  const mine = <T extends { viewId: string }>(list: readonly T[]) =>
    list.filter((c) => c.viewId === row.id);
  const groupKey = keyOf(stored, row.groupPropertyId);
  const sumKey = keyOf(stored, row.chartSumPropertyId);
  return {
    name: row.name,
    layout: layoutSchema.catch('table').parse(row.layout),
    scope: row.ownerId === null ? 'shared' : 'personal',
    properties: mine(children.properties).flatMap((p) => {
      const property = keyOf(stored, p.propertyId);
      return property === null ? [] : [{ property, visible: p.visible, width: p.width }];
    }),
    filter: treeOf(stored, mine(children.filters)),
    sorts: mine(children.sorts).flatMap((s) => {
      const property = keyOf(stored, s.propertyId);
      return property === null
        ? []
        : [{ property, direction: s.direction === 'desc' ? ('desc' as const) : ('asc' as const) }];
    }),
    group:
      groupKey === null
        ? null
        : { property: groupKey, by: row.groupBy === 'status_group' ? 'status_group' : 'value' },
    groups: mine(children.groups).map((g) => ({
      value: g.value,
      visible: g.visible,
      wipLimit: g.wipLimit,
    })),
    hideEmptyGroups: row.hideEmptyGroups,
    manualOrder: row.manualOrder,
    dateProperty: keyOf(stored, row.datePropertyId),
    chart:
      row.chartKind === null
        ? null
        : { kind: row.chartKind === 'donut' ? 'donut' : 'bar', sum: sumKey },
    cover: row.cover,
    defaultTemplate: row.defaultTemplateId,
  };
}

function assembled(
  stored: StoredCollection,
  rows: readonly ViewRow[],
  children: Children,
): SavedView[] {
  return rows.flatMap((row) => {
    const parsed = savedViewSchema.safeParse({
      id: row.id,
      collection: stored.definition.key,
      position: row.position,
      ownerId: row.ownerId,
      settings: settingsOf(stored, row, children),
    });
    return parsed.success ? [parsed.data] : [];
  });
}

export async function viewsOf(
  db: Executor,
  stored: StoredCollection,
  personId: string | null,
): Promise<SavedView[]> {
  const owner =
    personId === null
      ? isNull(collectionViews.ownerId)
      : or(isNull(collectionViews.ownerId), eq(collectionViews.ownerId, personId));
  const rows = await db
    .select()
    .from(collectionViews)
    .where(and(eq(collectionViews.collectionId, stored.id), owner))
    .orderBy(asc(collectionViews.position), asc(collectionViews.name));
  return assembled(
    stored,
    rows,
    await childrenOf(
      db,
      rows.map((row) => row.id),
    ),
  );
}

export async function viewRow(db: Executor, viewId: string): Promise<ViewRow | null> {
  const [row] = await db.select().from(collectionViews).where(eq(collectionViews.id, viewId));
  return row ?? null;
}

export async function viewById(
  db: Executor,
  stored: StoredCollection,
  viewId: string,
): Promise<SavedView | null> {
  const row = await viewRow(db, viewId);
  if (row === null || row.collectionId !== stored.id) return null;
  const [view] = assembled(stored, [row], await childrenOf(db, [row.id]));
  return view ?? null;
}

type FilterPlace = {
  readonly viewId: string;
  readonly parent: string | null;
  readonly position: number;
};

async function writeFilter(
  tx: Transaction,
  stored: StoredCollection,
  group: FilterGroup,
  place: FilterPlace,
): Promise<void> {
  const { viewId, parent, position } = place;
  const [row] = await tx
    .insert(collectionViewFilters)
    .values({ viewId, parentId: parent, kind: 'group', conjunction: group.conjunction, position })
    .returning({ id: collectionViewFilters.id });
  if (row === undefined) throw new Error('an inserted filter group returns its id');
  for (const [index, child] of group.children.entries()) {
    if (child.kind === 'group') {
      await writeFilter(tx, stored, child, { viewId, parent: row.id, position: index });
      continue;
    }
    await tx.insert(collectionViewFilters).values({
      viewId,
      parentId: row.id,
      kind: 'condition',
      propertyId: idOf(stored, child.property),
      operator: child.operator,
      value: child.value,
      position: index,
    });
  }
}

async function writeChildren(
  tx: Transaction,
  stored: StoredCollection,
  viewId: string,
  settings: ViewSettings,
): Promise<void> {
  const properties = settings.properties.flatMap((p, position) => {
    const propertyId = idOf(stored, p.property);
    return propertyId === null
      ? []
      : [{ viewId, propertyId, visible: p.visible, width: p.width, position }];
  });
  if (properties.length > 0) await tx.insert(collectionViewProperties).values(properties);
  const sorts = settings.sorts.flatMap((s, position) => {
    const propertyId = idOf(stored, s.property);
    return propertyId === null ? [] : [{ viewId, propertyId, direction: s.direction, position }];
  });
  if (sorts.length > 0) await tx.insert(collectionViewSorts).values(sorts);
  const groups = settings.groups.map((g, position) => ({
    viewId,
    value: g.value,
    visible: g.visible,
    wipLimit: g.wipLimit,
    position,
  }));
  if (groups.length > 0) await tx.insert(collectionViewGroups).values(groups);
  if (settings.filter !== null)
    await writeFilter(tx, stored, settings.filter, { viewId, parent: null, position: 0 });
}

export type ViewWrite = {
  readonly viewId: string;
  readonly ownerId: string | null;
  readonly position: number;
  readonly settings: ViewSettings;
  readonly at: Date;
};

export async function writeView(
  tx: Transaction,
  stored: StoredCollection,
  write: ViewWrite,
): Promise<void> {
  const { settings, viewId } = write;
  const row = {
    collectionId: stored.id,
    ownerId: write.ownerId,
    name: settings.name,
    layout: settings.layout,
    position: write.position,
    groupPropertyId: idOf(stored, settings.group?.property ?? null),
    groupBy: settings.group?.by ?? 'value',
    hideEmptyGroups: settings.hideEmptyGroups,
    manualOrder: settings.manualOrder,
    datePropertyId: idOf(stored, settings.dateProperty),
    chartKind: settings.chart?.kind ?? null,
    chartSumPropertyId: idOf(stored, settings.chart?.sum ?? null),
    cover: settings.cover,
    defaultTemplateId: settings.defaultTemplate,
    updatedAt: write.at,
  };
  await tx
    .insert(collectionViews)
    .values({ id: viewId, ...row })
    .onConflictDoUpdate({ target: collectionViews.id, set: row });
  await tx.delete(collectionViewProperties).where(eq(collectionViewProperties.viewId, viewId));
  await tx.delete(collectionViewSorts).where(eq(collectionViewSorts.viewId, viewId));
  await tx.delete(collectionViewGroups).where(eq(collectionViewGroups.viewId, viewId));
  await tx.delete(collectionViewFilters).where(eq(collectionViewFilters.viewId, viewId));
  await writeChildren(tx, stored, viewId, settings);
}

export async function deleteViewRow(tx: Transaction, viewId: string): Promise<void> {
  await tx.delete(collectionViews).where(eq(collectionViews.id, viewId));
}

export async function nextViewPosition(tx: Transaction, stored: StoredCollection): Promise<number> {
  const rows = await tx
    .select({ position: collectionViews.position })
    .from(collectionViews)
    .where(eq(collectionViews.collectionId, stored.id));
  return rows.reduce((most, row) => Math.max(most, row.position + 1), 0);
}
