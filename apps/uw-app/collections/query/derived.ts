import { sql, type SQL } from 'drizzle-orm';
import type { CollectionDefinition, PropertyDefinition } from '@uw/contracts';
import { propertyAccess } from '@uw/core/acl';
import { areaClause, textArray, type Scope } from './scope.ts';
import { columnExpr, frontmatterExpr, systemExpr, type Expr } from './sources.ts';

type At = {
  readonly definition: CollectionDefinition;
  readonly alias: string;
  readonly depth: number;
};

const MAX_DEPTH = 2;

type Linked = { readonly from: SQL; readonly target: CollectionDefinition; readonly alias: string };

function targetOf(scope: Scope, at: At, key: string): CollectionDefinition | null {
  if (key === at.definition.key) return at.definition;
  return scope.targets.get(key)?.definition ?? null;
}

function rowsTable(target: CollectionDefinition, alias: string, scope: Scope) {
  const a = sql.raw(alias);
  const table = target.rowSource === 'tasks' ? sql`tasks ${a}` : sql`pages ${a}`;
  const live = target.rowSource === 'pages' ? sql` AND ${a}.status <> 'retired'` : sql``;
  return { table, where: sql`${areaClause(scope, sql`${a}.jd_area`)}${live}` };
}

function columnLinks(
  scope: Scope,
  at: At,
  property: PropertyDefinition,
  target: CollectionDefinition,
) {
  if (property.source.kind !== 'column') return null;
  const list = columnExpr(at.definition.rowSource, property.source.column, at.alias);
  if (list === null) return null;
  const alias = `r${at.depth}`;
  const { table, where } = rowsTable(target, alias, scope);
  const from = sql`${table} WHERE ${where} AND ${sql.raw(alias)}.id::text = ANY(${list.scalar})`;
  return { from, target, alias };
}

function linkedFrom(scope: Scope, at: At, property: PropertyDefinition): Linked | null {
  if (property.config.type !== 'relation' || at.depth >= MAX_DEPTH) return null;
  const { target: key, reverse_of } = property.config.relation;
  const target = targetOf(scope, at, key);
  if (target === null || target.rowSource === 'people') return null;
  if (property.source.kind === 'column') return columnLinks(scope, at, property, target);
  const alias = `r${at.depth}`;
  const link = sql.raw(`l${at.depth}`);
  const { table, where } = rowsTable(target, alias, scope);
  const forward = reverse_of === null;
  const rel = forward ? `${at.definition.key}.${property.key}` : `${key}.${reverse_of ?? ''}`;
  const near = sql.raw(forward ? 'from_page' : 'to_page');
  const far = sql.raw(forward ? 'to_page' : 'from_page');
  const from = sql`page_links ${link} JOIN ${table} ON ${sql.raw(alias)}.id = ${link}.${far} WHERE ${link}.${near} = ${sql.raw(at.alias)}.id AND ${link}.rel = ${rel} AND ${where}`;
  return { from, target, alias };
}

function relationExpr(scope: Scope, at: At, property: PropertyDefinition): Expr | null {
  const linked = linkedFrom(scope, at, property);
  if (linked === null) return null;
  const a = sql.raw(linked.alias);
  return {
    kind: 'list',
    scalar: sql`ARRAY(SELECT ${a}.id::text FROM ${linked.from})`,
    end: null,
    value: sql`(SELECT coalesce(jsonb_agg(jsonb_build_object('id', ${a}.id, 'title', ${a}.title) ORDER BY ${a}.title), '[]'::jsonb) FROM ${linked.from})`,
  };
}

function number(scalar: SQL): Expr {
  return { kind: 'number', scalar, end: null, value: sql`to_jsonb(${scalar})` };
}

function labels(expr: Expr, property: PropertyDefinition): SQL {
  if (property.config.type === 'relation') {
    return sql`ARRAY(SELECT x->>'title' FROM jsonb_array_elements(${expr.value}) x)`;
  }
  if (expr.kind === 'list') return expr.scalar;
  return sql`ARRAY[${expr.scalar}::text]`;
}

function completeIds(property: PropertyDefinition): SQL {
  if (property.config.type !== 'status') return textArray([]);
  return textArray(property.config.options.filter((o) => o.group === 'complete').map((o) => o.id));
}

function rollupExpr(scope: Scope, at: At, property: PropertyDefinition): Expr | null {
  if (property.config.type !== 'rollup') return null;
  const { relation, property: targetKey, function: fn } = property.config.rollup;
  const through = at.definition.properties.find((p) => p.key === relation);
  if (through === undefined) return null;
  const linked = linkedFrom(scope, at, through);
  if (linked === null) return null;
  if (fn === 'count') return number(sql`(SELECT count(*) FROM ${linked.from})`);
  const read = linked.target.properties.find((p) => p.key === targetKey);
  if (read === undefined) return null;
  if (propertyAccess(scope.actor, read.rule, linked.target.jdArea, scope.at) !== 'all') return null;
  const inner = { definition: linked.target, alias: linked.alias, depth: at.depth + 1 };
  const expr = expressionAt(scope, inner, read);
  if (expr === null) return null;
  if (fn === 'sum') return number(sql`(SELECT sum(${expr.scalar}) FROM ${linked.from})`);
  if (fn === 'percent_complete') {
    const done = completeIds(read);
    return number(
      sql`(SELECT round(100.0 * count(*) FILTER (WHERE ${expr.scalar} = ANY(${done})) / nullif(count(*), 0)) FROM ${linked.from})`,
    );
  }
  const value = sql`(SELECT coalesce(jsonb_agg(DISTINCT lbl ORDER BY lbl), '[]'::jsonb) FROM (SELECT ${labels(expr, read)} AS lbls FROM ${linked.from}) AS rolled CROSS JOIN LATERAL unnest(rolled.lbls) AS lbl WHERE lbl IS NOT NULL)`;
  return { kind: 'list', scalar: sql`NULL::text[]`, end: null, value };
}

function inputsOf(scope: Scope, at: At, inputs: readonly string[]): Expr[] | null {
  const exprs: Expr[] = [];
  for (const key of inputs) {
    const input = at.definition.properties.find((p) => p.key === key);
    if (input === undefined || scope.access.get(key) !== 'all') return null;
    const expr = expressionAt(scope, at, input);
    if (expr === null) return null;
    exprs.push(expr);
  }
  return exprs;
}

function combined(fn: string, exprs: readonly Expr[], today: string): Expr | null {
  const [first, second] = exprs;
  if (first === undefined) return null;
  if (fn === 'count') return number(sql`coalesce(cardinality(${first.scalar}), 0)`);
  if (fn === 'date_until') {
    const date = first.end === null ? first.scalar : sql`coalesce(${first.end}, ${first.scalar})`;
    return number(sql`(${date} - ${today}::date)`);
  }
  if (fn === 'difference') {
    return second === undefined ? null : number(sql`(${first.scalar} - ${second.scalar})`);
  }
  const terms = exprs.map((e) => sql`coalesce(${e.scalar}, 0)`);
  return number(sql`(${sql.join(terms, sql` + `)})`);
}

function computedExpr(scope: Scope, at: At, property: PropertyDefinition): Expr | null {
  if (property.config.type !== 'computed') return null;
  const { function: fn, inputs } = property.config.computed;
  const exprs = inputsOf(scope, at, inputs);
  return exprs === null ? null : combined(fn, exprs, scope.today);
}

function expressionAt(scope: Scope, at: At, property: PropertyDefinition): Expr | null {
  const { source } = property;
  if (property.config.type === 'relation') return relationExpr(scope, at, property);
  if (source.kind === 'column') return columnExpr(at.definition.rowSource, source.column, at.alias);
  if (source.kind === 'frontmatter') return frontmatterExpr(property, at.alias);
  if (property.config.type === 'rollup') return rollupExpr(scope, at, property);
  if (property.config.type === 'computed') return computedExpr(scope, at, property);
  return systemExpr(at.definition, property, at.alias);
}

export function expressionOf(scope: Scope, property: PropertyDefinition): Expr | null {
  return expressionAt(scope, { definition: scope.definition, alias: 'p', depth: 0 }, property);
}
