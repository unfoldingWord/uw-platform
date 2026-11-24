import { sql, type SQL } from 'drizzle-orm';
import {
  groupableType,
  sortableType,
  statusGroupSchema,
  type PropertyDefinition,
  type RowGrouping,
  type RowSort,
} from '@uw/contracts';
import { queryableProperty, type Compiled } from './filters.ts';
import { textArray, type Scope } from './scope.ts';
import type { Expr } from './sources.ts';

export const EMPTY_GROUP = '__empty';

function optionIds(property: PropertyDefinition): string[] | null {
  const { config } = property;
  if (config.type === 'select' || config.type === 'status' || config.type === 'multi_select') {
    return config.options.map((option) => option.id);
  }
  return null;
}

function sortKey(property: PropertyDefinition, expr: Expr): SQL {
  const ids = optionIds(property);
  if (ids !== null && expr.kind === 'text')
    return sql`array_position(${textArray(ids)}, ${expr.scalar})`;
  return expr.scalar;
}

export function compileSorts(scope: Scope, sorts: readonly RowSort[]): Compiled<SQL[]> {
  const parts: SQL[] = [];
  for (const sort of sorts) {
    const found = queryableProperty(scope, sort.property);
    if (!found.ok) return found;
    const { property, expr } = found.value;
    if (!sortableType(property.config.type)) return { ok: false, reason: 'filter_not_valid' };
    const direction = sql.raw(sort.direction === 'asc' ? 'ASC' : 'DESC');
    parts.push(sql`${sortKey(property, expr)} ${direction} NULLS LAST`);
  }
  return { ok: true, value: parts };
}

export type CompiledGroup = {
  readonly key: SQL;
  readonly property: PropertyDefinition;
  readonly by: RowGrouping['by'];
};

function statusGroupKey(property: PropertyDefinition, expr: Expr): SQL {
  if (property.config.type !== 'status') return sql`${EMPTY_GROUP}::text`;
  const { options } = property.config;
  const arms = statusGroupSchema.options.map((group) => {
    const ids = options.filter((o) => o.group === group).map((o) => o.id);
    return sql`WHEN ${expr.scalar} = ANY(${textArray(ids)}) THEN ${group}::text`;
  });
  return sql`(CASE ${sql.join(arms, sql` `)} ELSE ${EMPTY_GROUP}::text END)`;
}

function valueKey(expr: Expr): SQL {
  if (expr.kind === 'list') return sql`coalesce((${expr.scalar})[1], ${EMPTY_GROUP}::text)`;
  if (expr.kind === 'bool')
    return sql`(CASE WHEN coalesce(${expr.scalar}, false) THEN 'true' ELSE 'false' END)`;
  return sql`coalesce(nullif(${expr.scalar}::text, ''), ${EMPTY_GROUP}::text)`;
}

export function compileGroup(
  scope: Scope,
  grouping: RowGrouping | null,
): Compiled<CompiledGroup | null> {
  if (grouping === null) return { ok: true, value: null };
  const found = queryableProperty(scope, grouping.property);
  if (!found.ok) return found;
  const { property, expr } = found.value;
  if (!groupableType(property.config.type)) return { ok: false, reason: 'filter_not_valid' };
  if (grouping.by === 'status_group' && property.config.type !== 'status') {
    return { ok: false, reason: 'filter_not_valid' };
  }
  const key = grouping.by === 'status_group' ? statusGroupKey(property, expr) : valueKey(expr);
  return { ok: true, value: { key, property, by: grouping.by } };
}

export function declaredGroupOrder(group: CompiledGroup): readonly string[] {
  if (group.by === 'status_group') return [...statusGroupSchema.options];
  if (group.property.config.type === 'checkbox') return ['true', 'false'];
  return optionIds(group.property) ?? [];
}
