import { describe, expect, it } from 'vitest';
import type { FilterGroup } from '@uw/contracts';
import { viewFilters } from './view-filters.ts';

const properties = [
  { key: 'name', name: 'Name' },
  { key: 'phase', name: 'Phase' },
  { key: 'amount', name: 'Amount' },
  { key: 'due', name: 'Due' },
  { key: 'owner', name: 'Owner' },
];

const nowhere = { month: null, cursor: null };

const unfiltered = { filter: null, sorts: [], group: null };

const nested: FilterGroup = {
  kind: 'group',
  conjunction: 'or',
  children: [
    { kind: 'condition', property: 'owner', operator: 'contains', value: { kind: 'me' } },
    {
      kind: 'group',
      conjunction: 'and',
      children: [
        {
          kind: 'condition',
          property: 'due',
          operator: 'within',
          value: { kind: 'relative', direction: 'next', unit: 'week', amount: 2 },
        },
        {
          kind: 'condition',
          property: 'phase',
          operator: 'is_any_of',
          value: ['idea', 'running'],
        },
        {
          kind: 'condition',
          property: 'due',
          operator: 'on_or_after',
          value: { kind: 'date', date: '2026-11-01' },
        },
        { kind: 'condition', property: 'due', operator: 'before', value: { kind: 'today' } },
      ],
    },
  ],
};

describe('#198 the readable filters of a saved view', () => {
  it('#198 names nothing for a view with no filter, sort, group or place', () => {
    expect(viewFilters(unfiltered, properties, nowhere)).toEqual([]);
  });

  it('#198 names each condition by its property name, in words, joined by the conjunction', () => {
    const filter: FilterGroup = {
      kind: 'group',
      conjunction: 'and',
      children: [
        { kind: 'condition', property: 'phase', operator: 'is', value: 'running' },
        { kind: 'condition', property: 'amount', operator: 'gte', value: 100 },
        { kind: 'condition', property: 'name', operator: 'is_not_empty', value: null },
      ],
    };
    expect(viewFilters({ ...unfiltered, filter }, properties, nowhere)).toEqual([
      'Filter: Phase is "running" and Amount is at least 100 and Name is not empty',
    ]);
  });

  it('#198 puts a nested group in brackets and writes dates, lists and me in words', () => {
    expect(viewFilters({ ...unfiltered, filter: nested }, properties, nowhere)).toEqual([
      'Filter: Owner contains me or (Due is within the next 2 weeks and Phase is any of "idea", "running" and Due is on or after 2026-11-01 and Due is before today)',
    ]);
  });

  it('#198 names the sorts, the grouping, the month and the first row printed', () => {
    const settings = {
      filter: null,
      sorts: [
        { property: 'amount', direction: 'desc' as const },
        { property: 'name', direction: 'asc' as const },
      ],
      group: { property: 'phase', by: 'status_group' as const },
    };
    expect(viewFilters(settings, properties, { month: '2026-11', cursor: '100' })).toEqual([
      'Sort: Amount descending, then Name ascending',
      'Group: Phase, by status group',
      'Month: 2026-11',
      'From row: 101',
    ]);
  });

  it('#198 names a property the definition does not know by its key', () => {
    const settings = { ...unfiltered, group: { property: 'gone', by: 'value' as const } };
    expect(viewFilters(settings, properties, nowhere)).toEqual(['Group: gone']);
  });
});
