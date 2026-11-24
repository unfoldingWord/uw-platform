import {
  addPropertyCommandSchema,
  changePropertyTypeCommandSchema,
  createRowCommandSchema,
  deleteViewCommandSchema,
  moveCardCommandSchema,
  removePropertyCommandSchema,
  saveTemplateCommandSchema,
  saveViewCommandSchema,
  setPropertyCommandSchema,
  updateCollectionCommandSchema,
} from '@uw/contracts';
import type { ZodType } from 'zod';

type Given = ReadonlyMap<string, string>;
type Shape = (given: Given) => Readonly<Record<string, unknown>>;

const blankToNull = (value: string | undefined): string | null =>
  value === undefined || value.trim() === '' ? null : value;

function listed(given: Given): string[] {
  return [...given.entries()]
    .filter(([name]) => name.startsWith('value.'))
    .map(([, value]) => value);
}

function rangeOf(given: Given): unknown {
  const start = blankToNull(given.get('start'));
  return start === null ? null : { start, end: blankToNull(given.get('end')) };
}

const values: ReadonlyMap<string, (given: Given) => unknown> = new Map<
  string,
  (given: Given) => unknown
>([
  [
    'number',
    (given) => (blankToNull(given.get('value')) === null ? null : Number(given.get('value'))),
  ],
  ['boolean', (given) => given.get('value') === 'true'],
  ['list', listed],
  ['range', rangeOf],
]);

function valueOf(given: Given): unknown {
  const kind = values.get(given.get('valueKind') ?? '');
  return kind === undefined ? blankToNull(given.get('value')) : kind(given);
}

function optionId(name: string): string {
  const id = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return id === '' ? 'option' : id.slice(0, 40);
}

function groupAt(index: number, count: number): string {
  if (index === 0) return 'to_do';
  return index === count - 1 ? 'complete' : 'in_progress';
}

function configOf(given: Given): Readonly<Record<string, unknown>> {
  const type = given.get('type') ?? 'text';
  const names = (given.get('options') ?? '')
    .split(',')
    .map((n) => n.trim())
    .filter((n) => n !== '');
  const options = names.map((name) => ({ id: optionId(name), name, tone: 'neutral' }));
  if (type === 'select' || type === 'multi_select') return { type, options };
  if (type === 'status')
    return { type, options: options.map((o, i) => ({ ...o, group: groupAt(i, options.length) })) };
  if (type === 'person') return { type, multiple: false };
  if (type === 'text') return { type, multiline: false };
  if (type === 'number') return { type, format: 'plain' };
  return { type };
}

const collectionOnly = (given: Given) => ({ collection: given.get('collection') });

function viewSettings(given: Given): Readonly<Record<string, unknown>> {
  const layout = given.get('layout') ?? 'table';
  const group = blankToNull(given.get('group'));
  const sort = blankToNull(given.get('sort'));
  return {
    name: given.get('name'),
    layout,
    scope: given.get('scope') ?? 'personal',
    group: group === null ? null : { property: group, by: 'value' },
    sorts: sort === null ? [] : [{ property: sort, direction: given.get('direction') ?? 'asc' }],
    dateProperty: blankToNull(given.get('dateProperty')),
    chart: layout === 'chart' ? { kind: 'bar', sum: null } : null,
  };
}

export const collectionShapes: ReadonlyMap<string, Shape> = new Map<string, Shape>([
  [
    'set_property',
    (given) => ({
      ...collectionOnly(given),
      rowId: given.get('rowId'),
      property: given.get('property'),
      value: valueOf(given),
    }),
  ],
  [
    'move_card',
    (given) => ({
      viewId: given.get('viewId'),
      rowId: given.get('rowId'),
      group: blankToNull(given.get('group')),
      after: blankToNull(given.get('after')),
      before: blankToNull(given.get('before')),
    }),
  ],
  [
    'create_row',
    (given) => ({
      ...collectionOnly(given),
      rowId: given.get('rowId'),
      jdArea: given.get('jdArea'),
      title: given.get('title'),
      values: {},
      template: blankToNull(given.get('template')),
    }),
  ],
  [
    'update_collection',
    (given) => ({
      ...collectionOnly(given),
      name: given.get('name'),
      description: given.get('description') ?? '',
      locked: given.get('locked') === 'true',
    }),
  ],
  ['remove_property', (given) => ({ ...collectionOnly(given), property: given.get('property') })],
  ['delete_view', (given) => ({ viewId: given.get('viewId') })],
  [
    'add_property',
    (given) => ({
      ...collectionOnly(given),
      property: {
        key: given.get('key'),
        name: given.get('name'),
        config: configOf(given),
        source: { kind: 'frontmatter' },
      },
    }),
  ],
  [
    'change_property_type',
    (given) => ({
      ...collectionOnly(given),
      property: given.get('property'),
      config: configOf(given),
    }),
  ],
  [
    'save_view',
    (given) => ({
      ...collectionOnly(given),
      viewId: given.get('viewId'),
      settings: viewSettings(given),
    }),
  ],
  [
    'save_template',
    (given) => ({
      ...collectionOnly(given),
      templateId: given.get('templateId'),
      name: given.get('name'),
      values: {},
      bodyMd: given.get('bodyMd') ?? '',
    }),
  ],
]);

export const collectionSchemas: ReadonlyMap<string, ZodType> = new Map<string, ZodType>([
  ['set_property', setPropertyCommandSchema],
  ['move_card', moveCardCommandSchema],
  ['create_row', createRowCommandSchema],
  ['update_collection', updateCollectionCommandSchema],
  ['remove_property', removePropertyCommandSchema],
  ['delete_view', deleteViewCommandSchema],
  ['add_property', addPropertyCommandSchema],
  ['change_property_type', changePropertyTypeCommandSchema],
  ['save_view', saveViewCommandSchema],
  ['save_template', saveTemplateCommandSchema],
]);
