import { sql, type SQL } from 'drizzle-orm';
import type { CollectionDefinition, JdArea, PropertyDefinition } from '@uw/contracts';
import { propertyAccess, readableAreas, type PropertyAccess } from '@uw/core/acl';
import type { Principal } from '@uw/core/principal';
import { formatDate } from '@uw/core/dates';

export type Scope = {
  readonly definition: CollectionDefinition;
  readonly collectionId: string;
  readonly actor: Principal;
  readonly at: Date;
  readonly today: string;
  readonly areas: readonly JdArea[] | 'all';
  readonly access: ReadonlyMap<string, PropertyAccess>;
  readonly targets: ReadonlyMap<string, Target>;
};

export type Target = { readonly id: string; readonly definition: CollectionDefinition };

export function scopeFor(
  definition: CollectionDefinition,
  collectionId: string,
  actor: Principal,
  at: Date,
  targets: ReadonlyMap<string, Target> = new Map(),
): Scope {
  const readable = readableAreas(actor, at);
  const access = new Map(
    definition.properties.map((property) => [
      property.key,
      propertyAccess(actor, property.rule, definition.jdArea, at),
    ]),
  );
  return {
    definition,
    collectionId,
    actor,
    at,
    today: formatDate(at),
    areas: readable.kind === 'all' ? 'all' : readable.areas,
    access,
    targets,
  };
}

export function accessOf(scope: Scope, property: PropertyDefinition): PropertyAccess {
  return scope.access.get(property.key) ?? 'none';
}

export function areaClause(scope: Scope, column: SQL): SQL {
  if (scope.areas === 'all') return sql`TRUE`;
  if (scope.areas.length === 0) return sql`FALSE`;
  return sql`${column} IN (${sql.join(
    scope.areas.map((area) => sql`${area}`),
    sql`, `,
  )})`;
}

export function textArray(values: readonly string[]): SQL {
  if (values.length === 0) return sql`'{}'::text[]`;
  return sql`ARRAY[${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )}]::text[]`;
}

export function rowOwner(scope: Scope): SQL {
  return scope.definition.rowSource === 'people' ? sql`pe.id` : sql`NULL::uuid`;
}

export function rowId(scope: Scope): SQL {
  const source = scope.definition.rowSource;
  if (source === 'pages') return sql`p.id`;
  if (source === 'tasks') return sql`t.id`;
  return sql`pe.id`;
}
