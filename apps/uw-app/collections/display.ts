import { inArray } from 'drizzle-orm';
import { readThroughValueSchema, type CollectionRow, type PropertyDefinition } from '@uw/contracts';
import { formatInstant } from '@uw/core/dates';
import type { Executor } from '@uw/db/client';
import { people } from '@uw/db/schema';

export type Names = ReadonlyMap<string, string>;

const readThroughText: ReadonlyMap<string, string> = new Map([
  ['not_wired', 'Not connected yet'],
  ['no_budget_lines', 'No budget lines yet'],
  ['no_value', 'None'],
]);

function optionName(property: PropertyDefinition, id: unknown): string {
  const { config } = property;
  if (config.type !== 'select' && config.type !== 'status' && config.type !== 'multi_select') {
    return String(id);
  }
  return config.options.find((option) => option.id === id)?.name ?? String(id);
}

function listText(property: PropertyDefinition, value: readonly unknown[], names: Names): string {
  return value
    .map((item) => {
      if (typeof item === 'object' && item !== null && 'title' in item) return String(item.title);
      if (property.config.type === 'person') return names.get(String(item)) ?? String(item);
      return optionName(property, item);
    })
    .join(', ');
}

function objectText(value: object): string {
  const through = readThroughValueSchema.safeParse(value);
  if (through.success) return readThroughText.get(through.data.state) ?? '';
  if ('start' in value) {
    const end = 'end' in value && value.end !== null ? ` to ${String(value.end)}` : '';
    return `${String(value.start)}${end}`;
  }
  return '';
}

const instantTypes: ReadonlySet<string> = new Set([
  'created_time',
  'edited_time',
  'completed_time',
]);

function scalarText(property: PropertyDefinition, value: unknown, names: Names): string {
  const { config } = property;
  if (config.type === 'person') return names.get(String(value)) ?? String(value);
  if (config.type === 'number' && config.format === 'percent') return `${String(value)}%`;
  if (instantTypes.has(config.type) && typeof value === 'string') {
    return formatInstant(new Date(value));
  }
  return optionName(property, value);
}

export function cellText(property: PropertyDefinition, value: unknown, names: Names): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return listText(property, value, names);
  if (typeof value === 'object') return objectText(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return scalarText(property, value, names);
}

export const personTypes: ReadonlySet<string> = new Set(['person', 'created_by', 'edited_by']);

export function personIdsIn(
  rows: readonly CollectionRow[],
  properties: readonly PropertyDefinition[],
): string[] {
  const ids = new Set<string>();
  for (const property of properties.filter((p) => personTypes.has(p.config.type))) {
    for (const row of rows) {
      const value = new Map(Object.entries(row.values)).get(property.key);
      for (const id of Array.isArray(value) ? value : [value])
        if (typeof id === 'string') ids.add(id);
    }
  }
  return [...ids];
}

export async function namesFor(
  db: Executor,
  rows: readonly CollectionRow[],
  properties: readonly PropertyDefinition[],
): Promise<Names> {
  const ids = personIdsIn(rows, properties).filter((id) => /^[0-9a-f-]{36}$/.test(id));
  if (ids.length === 0) return new Map();
  const found = await db
    .select({ id: people.id, name: people.displayName })
    .from(people)
    .where(inArray(people.id, ids));
  return new Map(found.map((row) => [row.id, row.name]));
}

export function valueOf(row: CollectionRow, key: string): unknown {
  return new Map(Object.entries(row.values)).get(key);
}
