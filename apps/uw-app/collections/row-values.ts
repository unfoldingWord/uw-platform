import {
  isWritableProperty,
  propertyValueSchema,
  type CollectionDefinition,
  type ErrorReason,
  type PropertyDefinition,
} from '@uw/contracts';
import { z } from 'zod';
import type { Scope } from './query/scope.ts';

export type Checked =
  | { readonly ok: true; readonly property: PropertyDefinition; readonly value: unknown }
  | { readonly ok: false; readonly reason: ErrorReason };

const relationValue = (property: PropertyDefinition) => {
  const multiple = property.config.type === 'relation' && property.config.relation.multiple;
  return multiple
    ? z
        .array(z.uuid())
        .max(200)
        .refine((v) => new Set(v).size === v.length)
    : z.uuid().nullable();
};

function writable(scope: Scope, property: PropertyDefinition, rowOwner: string | null): boolean {
  if (!isWritableProperty(property)) return false;
  const access = scope.access.get(property.key) ?? 'none';
  if (access === 'all') return true;
  return access === 'own' && rowOwner !== null && rowOwner === scope.actor.personId;
}

export function checkValue(
  scope: Scope,
  key: string,
  value: unknown,
  rowOwner: string | null,
): Checked {
  const property = scope.definition.properties.find((p) => p.key === key);
  if (property === undefined) return { ok: false, reason: 'property_not_found' };
  if (!writable(scope, property, rowOwner)) return { ok: false, reason: 'property_not_writable' };
  const schema =
    property.config.type === 'relation' ? relationValue(property) : propertyValueSchema(property);
  if (schema === null) return { ok: false, reason: 'property_not_writable' };
  const parsed = schema.safeParse(value);
  if (!parsed.success) return { ok: false, reason: 'invalid_value' };
  return { ok: true, property, value: parsed.data };
}

export function listOf(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value.map(String) : [String(value)];
}

export function columnOf(property: PropertyDefinition): string | null {
  return property.source.kind === 'column' ? property.source.column : null;
}

export function requiredMissing(
  definition: CollectionDefinition,
  values: Record<string, unknown>,
): boolean {
  return definition.properties.some(
    (p) =>
      p.required &&
      p.config.type !== 'title' &&
      p.source.kind === 'frontmatter' &&
      (values[p.key] === undefined || values[p.key] === null),
  );
}
