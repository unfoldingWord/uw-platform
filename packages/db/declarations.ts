import { getTableName, is } from 'drizzle-orm';
import {
  pgTable,
  PgTable,
  type PgColumnBuilderBase,
  type PgTableExtraConfigValue,
} from 'drizzle-orm/pg-core';
import type { BuildExtraConfigColumns } from 'drizzle-orm/column-builder';

export const classifications = ['public', 'internal', 'restricted', 'sensitive'] as const;
export const offlineEligibilities = ['sync', 'cache_readonly', 'never'] as const;

export type Classification = (typeof classifications)[number];
export type OfflineEligibility = (typeof offlineEligibilities)[number];

export type TableDeclaration = {
  readonly classification: Classification;
  readonly offlineEligibility: OfflineEligibility;
};

const declarations = new WeakMap<PgTable, TableDeclaration>();

function assertDeclaration(name: string, declaration: TableDeclaration): void {
  if (!classifications.includes(declaration.classification)) {
    throw new TypeError(`${name}: classification must be one of ${classifications.join(', ')}`);
  }
  if (!offlineEligibilities.includes(declaration.offlineEligibility)) {
    throw new TypeError(
      `${name}: offlineEligibility must be one of ${offlineEligibilities.join(', ')}`,
    );
  }
}

export function declareTable<
  TName extends string,
  TColumns extends Record<string, PgColumnBuilderBase>,
>(
  name: TName,
  columns: TColumns,
  declaration: TableDeclaration,
  extraConfig?: (self: BuildExtraConfigColumns<TName, TColumns, 'pg'>) => PgTableExtraConfigValue[],
) {
  assertDeclaration(name, declaration);
  const table = pgTable(name, columns, extraConfig);
  declarations.set(table, { ...declaration });
  return table;
}

function exportedTables(schema: Record<string, unknown>): PgTable[] {
  return Object.values(schema).filter((value): value is PgTable => is(value, PgTable));
}

export function declarationOf(table: PgTable): TableDeclaration | undefined {
  return declarations.get(table);
}

export function undeclaredTables(schema: Record<string, unknown>): string[] {
  return exportedTables(schema)
    .filter((table) => !declarations.has(table))
    .map((table) => getTableName(table));
}
