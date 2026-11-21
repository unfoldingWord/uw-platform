import { sql, type SQL } from 'drizzle-orm';
import {
  operatorsByType,
  type DateOperand,
  type ErrorReason,
  type FilterCondition,
  type FilterGroup,
  type FilterValue,
  type PropertyDefinition,
} from '@uw/contracts';
import { formatDate, parseDate } from '@uw/core/dates';
import { expressionOf } from './derived.ts';
import { accessOf, textArray, type Scope } from './scope.ts';
import type { Expr } from './sources.ts';

export type Compiled<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: ErrorReason };

const DAY = 86_400_000;

function shift(today: string, unit: string, amount: number): string {
  const base = parseDate(today);
  if (unit === 'day') return formatDate(new Date(base.getTime() + amount * DAY));
  if (unit === 'week') return formatDate(new Date(base.getTime() + amount * 7 * DAY));
  const next = new Date(base.getTime());
  if (unit === 'month') next.setUTCMonth(next.getUTCMonth() + amount);
  else next.setUTCFullYear(next.getUTCFullYear() + amount);
  return formatDate(next);
}

function dateRange(operand: DateOperand, today: string): readonly [string, string] {
  if (operand.kind === 'date') return [operand.date, operand.date];
  if (operand.kind === 'today') return [today, today];
  const sign = operand.direction === 'past' ? -1 : 1;
  const far = shift(today, operand.unit, sign * operand.amount);
  return operand.direction === 'past' ? [far, today] : [today, far];
}

function asDateOperand(value: FilterValue): DateOperand | null {
  if (typeof value === 'string')
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? { kind: 'date', date: value } : null;
  if (value !== null && typeof value === 'object' && !Array.isArray(value) && value.kind !== 'me') {
    return value;
  }
  return null;
}

function pointOf(operand: DateOperand, today: string): string {
  const [low, high] = dateRange(operand, today);
  return operand.kind === 'relative' && operand.direction === 'past' ? low : high;
}

function dateCondition(
  expr: Expr,
  operator: string,
  value: FilterValue,
  today: string,
): SQL | null {
  const operand = asDateOperand(value);
  if (operand === null) return null;
  const start = expr.kind === 'instant' ? sql`uw_instant_date(${expr.scalar})` : expr.scalar;
  const end = expr.end === null ? start : sql`coalesce(${expr.end}, ${start})`;
  const [low, high] = dateRange(operand, today);
  const day = sql`${pointOf(operand, today)}::date`;
  if (operator === 'within') return sql`(${start} <= ${high}::date AND ${end} >= ${low}::date)`;
  if (operator === 'is') return sql`(${start} <= ${day} AND ${end} >= ${day})`;
  if (operator === 'before') return sql`${end} < ${day}`;
  if (operator === 'after') return sql`${start} > ${day}`;
  if (operator === 'on_or_before') return sql`${start} <= ${day}`;
  if (operator === 'on_or_after') return sql`${end} >= ${day}`;
  return null;
}

function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function textCondition(expr: Expr, operator: string, value: FilterValue): SQL | null {
  if (operator === 'is_any_of' && Array.isArray(value))
    return sql`${expr.scalar} = ANY(${textArray(value)})`;
  if (typeof value !== 'string') return null;
  const s = expr.scalar;
  if (operator === 'is') return sql`${s} = ${value}`;
  if (operator === 'is_not') return sql`${s} IS DISTINCT FROM ${value}`;
  if (operator === 'contains') return sql`${s} ILIKE ${`%${escapeLike(value)}%`}`;
  if (operator === 'not_contains')
    return sql`coalesce(${s}, '') NOT ILIKE ${`%${escapeLike(value)}%`}`;
  if (operator === 'starts_with') return sql`${s} ILIKE ${`${escapeLike(value)}%`}`;
  return null;
}

const numberOperatorTable: Readonly<Record<string, string>> = {
  eq: '=',
  neq: '<>',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
};

const numberOperators: ReadonlyMap<string, string> = new Map(Object.entries(numberOperatorTable));

function numberCondition(expr: Expr, operator: string, value: FilterValue): SQL | null {
  const op = numberOperators.get(operator);
  if (op === undefined || typeof value !== 'number') return null;
  return sql`${expr.scalar} ${sql.raw(op)} ${value}`;
}

function personOf(scope: Scope, value: FilterValue): string | null {
  if (value !== null && typeof value === 'object' && !Array.isArray(value) && value.kind === 'me') {
    return scope.actor.personId;
  }
  return typeof value === 'string' ? value : null;
}

function listCondition(scope: Scope, expr: Expr, operator: string, value: FilterValue): SQL | null {
  const list = expr.scalar;
  if (operator === 'is_any_of' && Array.isArray(value)) return sql`${list} && ${textArray(value)}`;
  const one = personOf(scope, value);
  if (one === null) return sql`FALSE`;
  const holds = sql`${list} @> ARRAY[${one}::text]`;
  if (operator === 'contains') return holds;
  if (operator === 'not_contains') return sql`NOT coalesce(${holds}, false)`;
  return null;
}

function identityCondition(
  scope: Scope,
  expr: Expr,
  operator: string,
  value: FilterValue,
): SQL | null {
  const isMe =
    value !== null && typeof value === 'object' && !Array.isArray(value) && value.kind === 'me';
  const who = isMe ? scope.actor.identity : typeof value === 'string' ? value : null;
  if (who === null) return null;
  if (operator === 'contains') return sql`${expr.scalar} = ${who}`;
  if (operator === 'not_contains') return sql`${expr.scalar} IS DISTINCT FROM ${who}`;
  return null;
}

function emptyCondition(expr: Expr, operator: string): SQL | null {
  const empty =
    expr.kind === 'list'
      ? sql`coalesce(cardinality(${expr.scalar}), 0) = 0`
      : expr.kind === 'text'
        ? sql`coalesce(${expr.scalar}, '') = ''`
        : sql`${expr.scalar} IS NULL`;
  if (operator === 'is_empty') return empty;
  if (operator === 'is_not_empty') return sql`NOT (${empty})`;
  return null;
}

function groupIds(property: PropertyDefinition, value: FilterValue): string[] | null {
  if (property.config.type !== 'status' || typeof value !== 'string') return null;
  return property.config.options.filter((o) => o.group === value).map((o) => o.id);
}

type Typed = (scope: Scope, expr: Expr, c: FilterCondition) => SQL | null;

const dated: Typed = (scope, expr, c) => dateCondition(expr, c.operator, c.value, scope.today);

const byKind: ReadonlyMap<string, Typed> = new Map<string, Typed>([
  ['date', dated],
  ['range', dated],
  ['instant', dated],
  ['list', (scope, expr, c) => listCondition(scope, expr, c.operator, c.value)],
  ['identity', (scope, expr, c) => identityCondition(scope, expr, c.operator, c.value)],
  ['number', (_scope, expr, c) => numberCondition(expr, c.operator, c.value)],
  [
    'bool',
    (_scope, expr, c) =>
      typeof c.value === 'boolean' ? sql`coalesce(${expr.scalar}, false) = ${c.value}` : null,
  ],
]);

function conditionSql(
  scope: Scope,
  property: PropertyDefinition,
  expr: Expr,
  c: FilterCondition,
): SQL | null {
  const empty = emptyCondition(expr, c.operator);
  if (empty !== null) return empty;
  if (c.operator === 'group_is') {
    const ids = groupIds(property, c.value);
    return ids === null ? null : sql`${expr.scalar} = ANY(${textArray(ids)})`;
  }
  const typed = byKind.get(expr.kind);
  return typed === undefined ? textCondition(expr, c.operator, c.value) : typed(scope, expr, c);
}

export function queryableProperty(
  scope: Scope,
  key: string,
): Compiled<{ property: PropertyDefinition; expr: Expr }> {
  const property = scope.definition.properties.find((p) => p.key === key);
  if (property === undefined) return { ok: false, reason: 'filter_not_valid' };
  if (accessOf(scope, property) !== 'all') return { ok: false, reason: 'property_not_readable' };
  const notQueryable =
    property.config.type === 'read_through' ||
    (property.config.type === 'rollup' && property.config.rollup.function === 'show_unique');
  if (notQueryable) return { ok: false, reason: 'property_not_queryable' };
  const expr = expressionOf(scope, property);
  if (expr === null) return { ok: false, reason: 'property_not_queryable' };
  return { ok: true, value: { property, expr } };
}

function compileCondition(scope: Scope, condition: FilterCondition): Compiled<SQL> {
  const found = queryableProperty(scope, condition.property);
  if (!found.ok) return found;
  const { property, expr } = found.value;
  if (!operatorsByType[property.config.type].includes(condition.operator)) {
    return { ok: false, reason: 'filter_not_valid' };
  }
  const compiled = conditionSql(scope, property, expr, condition);
  return compiled === null
    ? { ok: false, reason: 'filter_not_valid' }
    : { ok: true, value: compiled };
}

export function compileFilter(scope: Scope, group: FilterGroup | null): Compiled<SQL> {
  if (group === null || group.children.length === 0) return { ok: true, value: sql`TRUE` };
  const parts: SQL[] = [];
  for (const child of group.children) {
    const compiled =
      child.kind === 'group' ? compileFilter(scope, child) : compileCondition(scope, child);
    if (!compiled.ok) return compiled;
    parts.push(sql`(${compiled.value})`);
  }
  const joiner = group.conjunction === 'and' ? sql` AND ` : sql` OR `;
  return { ok: true, value: sql.join(parts, joiner) };
}
