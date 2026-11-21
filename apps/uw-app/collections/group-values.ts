import type { GroupBy, PropertyDefinition } from '@uw/contracts';
import { EMPTY_GROUP } from './query/order.ts';

function many(property: PropertyDefinition): boolean {
  const { config } = property;
  if (config.type === 'multi_select') return true;
  if (config.type === 'person') return config.multiple;
  return config.type === 'relation' && config.relation.multiple;
}

function statusOf(property: PropertyDefinition, group: string): string | undefined {
  if (property.config.type !== 'status') return undefined;
  return property.config.options.find((option) => option.group === group)?.id;
}

function optionOf(property: PropertyDefinition, group: string): string | undefined {
  const { config } = property;
  if (config.type !== 'select' && config.type !== 'status' && config.type !== 'multi_select') {
    return group;
  }
  return config.options.some((option) => option.id === group) ? group : undefined;
}

export function groupValue(property: PropertyDefinition, by: GroupBy, group: string): unknown {
  if (by === 'status_group') return statusOf(property, group);
  if (group === EMPTY_GROUP) return many(property) ? [] : null;
  if (property.config.type === 'checkbox') return group === 'true';
  const value = optionOf(property, group);
  if (value === undefined) return undefined;
  return many(property) ? [value] : value;
}
