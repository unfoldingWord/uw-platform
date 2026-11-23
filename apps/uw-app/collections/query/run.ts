import { sql, type SQL } from 'drizzle-orm';
import type { CollectionRow, PropertyDefinition, RowQuery } from '@uw/contracts';
import type { Executor } from '@uw/db/client';
import { readThroughValue } from '../read-through.ts';
import { expressionOf } from './derived.ts';
import { compileFilter, type Compiled } from './filters.ts';
import { compileGroup, compileSorts, type CompiledGroup } from './order.ts';
import { accessOf, areaClause, rowId, rowOwner, type Scope } from './scope.ts';

export type RowsRequest = {
  readonly query: RowQuery;
  readonly viewId: string | null;
  readonly manualOrder: boolean;
  readonly groupOrder: readonly string[];
  readonly only?: string;
};

export type RowsResult = {
  readonly rows: readonly CollectionRow[];
  readonly next: string | null;
  readonly counts: ReadonlyMap<string, number> | null;
  readonly group: CompiledGroup | null;
};

type Base = { readonly from: SQL; readonly where: SQL };

function baseOf(scope: Scope): Base {
  const source = scope.definition.rowSource;
  if (source === 'pages') {
    return {
      from: sql`pages p`,
      where: sql`p.collection_id = ${scope.collectionId} AND p.status <> 'retired' AND ${areaClause(scope, sql`p.jd_area`)}`,
    };
  }
  if (source === 'tasks') return { from: sql`tasks t`, where: areaClause(scope, sql`t.jd_area`) };
  return {
    from: sql`people pe LEFT JOIN directory_entries de ON de.person_id = pe.id LEFT JOIN directory_private dp ON dp.person_id = pe.id`,
    where: sql`pe.status = 'active'`,
  };
}

function projected(scope: Scope, property: PropertyDefinition): SQL | null {
  const access = accessOf(scope, property);
  if (access === 'none' || property.config.type === 'read_through') return null;
  const expr = expressionOf(scope, property);
  if (expr === null) return null;
  if (access === 'all') return expr.value;
  const me = scope.actor.personId;
  if (me === null) return null;
  return sql`(CASE WHEN ${rowOwner(scope)} = ${me}::uuid THEN ${expr.value} END)`;
}

function valuesObject(scope: Scope): SQL {
  const pairs = scope.definition.properties.flatMap((property) => {
    const value = projected(scope, property);
    return value === null ? [] : [sql`${property.key}::text, ${value}`];
  });
  const chunks: SQL[] = [];
  for (let i = 0; i < pairs.length; i += 40) {
    chunks.push(sql`jsonb_build_object(${sql.join(pairs.slice(i, i + 40), sql`, `)})`);
  }
  return chunks.length === 0 ? sql`'{}'::jsonb` : sql.join(chunks, sql` || `);
}

const columnsBySource = {
  pages: { title: sql`p.title`, area: sql`p.jd_area`, version: sql`p.version` },
  tasks: { title: sql`t.title`, area: sql`t.jd_area`, version: sql`NULL::int` },
  people: { title: sql`pe.display_name`, area: sql`NULL::text`, version: sql`NULL::int` },
} as const;

type Plan = { readonly where: SQL; readonly sorts: SQL[]; readonly group: CompiledGroup | null };

export function planOf(scope: Scope, query: RowQuery): Compiled<Plan> {
  const filter = compileFilter(scope, query.filter);
  if (!filter.ok) return filter;
  const sorts = compileSorts(scope, query.sorts);
  if (!sorts.ok) return sorts;
  const group = compileGroup(scope, query.group);
  if (!group.ok) return group;
  return { ok: true, value: { where: filter.value, sorts: sorts.value, group: group.value } };
}

function orderBy(scope: Scope, plan: Plan, request: RowsRequest): SQL {
  const parts: SQL[] = [];
  if (plan.group !== null) {
    if (request.groupOrder.length > 0) {
      const order = sql`ARRAY[${sql.join(
        request.groupOrder.map((g) => sql`${g}`),
        sql`, `,
      )}]::text[]`;
      parts.push(sql`array_position(${order}, ${plan.group.key}) NULLS LAST`);
    }
    parts.push(plan.group.key);
  }
  if (request.manualOrder && request.viewId !== null) {
    parts.push(sql`co.position COLLATE "C" NULLS LAST`);
  }
  const { title } = columnsBySource[scope.definition.rowSource];
  parts.push(...plan.sorts, sql`${title} ASC`, sql`${rowId(scope)} ASC`);
  return sql.join(parts, sql`, `);
}

function manualJoin(scope: Scope, request: RowsRequest): SQL {
  if (!request.manualOrder || request.viewId === null) return sql``;
  return sql` LEFT JOIN collection_card_order co ON co.view_id = ${request.viewId} AND co.row_id = ${rowId(scope)}`;
}

function onlyRow(scope: Scope, request: RowsRequest): SQL {
  if (request.only === undefined) return sql``;
  return sql` AND ${rowId(scope)}::text = ${request.only}`;
}

type RawRow = {
  readonly id: string;
  readonly title: string;
  readonly jd_area: string | null;
  readonly version: number | null;
  readonly group_key: string | null;
  readonly vals: Record<string, unknown>;
};

async function selectRows(
  db: Executor,
  scope: Scope,
  plan: Plan,
  request: RowsRequest,
): Promise<RawRow[]> {
  const { limit, cursor } = request.query;
  const offset = cursor === null ? 0 : Number(cursor);
  const base = baseOf(scope);
  const columns = columnsBySource[scope.definition.rowSource];
  const groupKey = plan.group === null ? sql`NULL::text` : plan.group.key;
  const rows = await db.execute(sql`
    SELECT ${rowId(scope)} AS id, ${columns.title} AS title, ${columns.area} AS jd_area,
      ${columns.version} AS version, ${groupKey} AS group_key, ${valuesObject(scope)} AS vals
    FROM ${base.from}${manualJoin(scope, request)}
    WHERE ${base.where} AND (${plan.where})${onlyRow(scope, request)}
    ORDER BY ${orderBy(scope, plan, request)}
    LIMIT ${limit + 1} OFFSET ${offset}`);
  return [...rows] as unknown as RawRow[];
}

async function groupCounts(
  db: Executor,
  scope: Scope,
  plan: Plan,
): Promise<ReadonlyMap<string, number> | null> {
  if (plan.group === null) return null;
  const base = baseOf(scope);
  const rows = await db.execute(sql`
    SELECT ${plan.group.key} AS group_key, count(*)::int AS n
    FROM ${base.from} WHERE ${base.where} AND (${plan.where})
    GROUP BY 1`);
  const list = [...rows] as unknown as { group_key: string; n: number }[];
  return new Map(list.map((row) => [row.group_key, Number(row.n)]));
}

export async function groupSums(
  db: Executor,
  scope: Scope,
  query: RowQuery,
  key: string,
): Promise<ReadonlyMap<string, number> | null> {
  const plan = planOf(scope, query);
  const property = scope.definition.properties.find((p) => p.key === key);
  if (!plan.ok || plan.value.group === null || property === undefined) return null;
  if (accessOf(scope, property) !== 'all') return null;
  const expr = expressionOf(scope, property);
  if (expr?.kind !== 'number') return null;
  const base = baseOf(scope);
  const rows = await db.execute(sql`
    SELECT ${plan.value.group.key} AS group_key, coalesce(sum(${expr.scalar}), 0)::float8 AS total
    FROM ${base.from} WHERE ${base.where} AND (${plan.value.where})
    GROUP BY 1`);
  const list = [...rows] as unknown as { group_key: string; total: number }[];
  return new Map(list.map((row) => [row.group_key, Number(row.total)]));
}

const instantTypes: ReadonlySet<string> = new Set([
  'created_time',
  'edited_time',
  'completed_time',
]);

function finished(scope: Scope, property: PropertyDefinition, value: unknown): unknown {
  if (instantTypes.has(property.config.type) && typeof value === 'string') {
    return new Date(value).toISOString();
  }
  if (property.config.type === 'read_through') {
    return readThroughValue(scope.definition, property.config.feed);
  }
  return value;
}

function withReadThrough(scope: Scope, values: Record<string, unknown>): Record<string, unknown> {
  const given = new Map(Object.entries(values));
  const entries = scope.definition.properties.flatMap((property) => {
    const shown = given.has(property.key) || property.config.type === 'read_through';
    if (!shown || accessOf(scope, property) === 'none') return [];
    return [[property.key, finished(scope, property, given.get(property.key) ?? null)] as const];
  });
  return Object.fromEntries(entries);
}

function toRow(scope: Scope, raw: RawRow): CollectionRow {
  return {
    id: raw.id,
    title: raw.title,
    jdArea: raw.jd_area,
    version: raw.version === null ? null : Number(raw.version),
    group: raw.group_key,
    values: withReadThrough(scope, raw.vals) as CollectionRow['values'],
  };
}

export async function runQuery(
  db: Executor,
  scope: Scope,
  request: RowsRequest,
): Promise<Compiled<RowsResult>> {
  const plan = planOf(scope, request.query);
  if (!plan.ok) return plan;
  const raw = await selectRows(db, scope, plan.value, request);
  const { limit, cursor } = request.query;
  const offset = cursor === null ? 0 : Number(cursor);
  const more = raw.length > limit;
  const rows = raw.slice(0, limit).map((row) => toRow(scope, row));
  const counts = await groupCounts(db, scope, plan.value);
  const next = more ? String(offset + limit) : null;
  return { ok: true, value: { rows, next, counts, group: plan.value.group } };
}
