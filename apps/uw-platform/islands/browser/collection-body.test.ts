import { describe, expect, it } from 'vitest';
import { commandBody } from './command-body.ts';

const requestId = '00000000-0000-4000-8000-000000000900';
const rowId = '00000000-0000-4000-8000-000000000001';
const set = { collection: 'tasks', rowId, property: 'due' };

function readsValuesByKind(): void {
  expect(
    commandBody('set_property', { ...set, valueKind: 'date', value: '2026-12-01' }, requestId),
  ).toMatchObject({ value: '2026-12-01' });
  expect(
    commandBody('set_property', { ...set, valueKind: 'number', value: '' }, requestId),
  ).toMatchObject({ value: null });
  expect(
    commandBody('set_property', { ...set, valueKind: 'boolean', value: 'true' }, requestId),
  ).toMatchObject({ value: true });
  const list = { ...set, valueKind: 'list', 'value.a': 'a', 'value.b': 'b' };
  expect(commandBody('set_property', list, requestId)).toMatchObject({ value: ['a', 'b'] });
  const range = { ...set, valueKind: 'range', start: '2026-01-01', end: '' };
  expect(commandBody('set_property', range, requestId)).toMatchObject({
    value: { start: '2026-01-01', end: null },
  });
}

describe('#206 collection forms post the command the contract expects', () => {
  it('reads a value by its kind, and an empty one as none', readsValuesByKind);

  it('builds a status property with one option in each group from a comma list', () => {
    const fields = {
      collection: 'program',
      key: 'stage',
      name: 'Stage',
      type: 'status',
      options: 'Idea, Running, Done',
    };
    const body = commandBody('add_property', fields, requestId);
    expect(body).toMatchObject({
      property: {
        config: {
          type: 'status',
          options: [
            { id: 'idea', group: 'to_do' },
            { id: 'running', group: 'in_progress' },
            { id: 'done', group: 'complete' },
          ],
        },
      },
    });
  });

  it('moves a card to a group with no neighbours named', () => {
    const viewId = '00000000-0000-4000-8000-000000000002';
    expect(commandBody('move_card', { viewId, rowId, group: 'done' }, requestId)).toMatchObject({
      group: 'done',
      after: null,
      before: null,
    });
  });

  it('refuses a board view saved with no group', () => {
    const fields = {
      collection: 'program',
      viewId: rowId,
      name: 'Board',
      layout: 'board',
      scope: 'personal',
      group: '',
    };
    expect(commandBody('save_view', fields, requestId)).toBeNull();
  });
});
