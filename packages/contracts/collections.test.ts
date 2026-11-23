import { describe, expect, it } from 'vitest';
import {
  collectionDefinitionSchema,
  propertyDefinitionSchema,
  type CollectionDefinition,
  type PropertyDefinition,
} from './collections.ts';
import { compileRowSchema } from './collection-values.ts';
import { convertValue, typeChangeAllowed } from './collection-convert.ts';
import { definitionProblems } from './collection-definitions.ts';
import { filterGroupSchema, rowQuerySchema } from './collection-query.ts';
import { viewSettingsSchema } from './collection-views.ts';

const frontmatter = { kind: 'frontmatter' } as const;
const derived = { kind: 'derived' } as const;
const titleProperty = {
  key: 'name',
  name: 'Name',
  config: { type: 'title' },
  source: { kind: 'column', column: 'title' },
};
const phase = {
  key: 'phase',
  name: 'Phase',
  source: frontmatter,
  config: {
    type: 'status',
    options: [
      { id: 'idea', name: 'Idea', group: 'to_do' },
      { id: 'running', name: 'Running', group: 'in_progress' },
      { id: 'closed', name: 'Closed', group: 'complete' },
    ],
  },
};

function definition(extra: readonly unknown[] = []): CollectionDefinition {
  return collectionDefinitionSchema.parse({
    key: 'program',
    name: 'Programs',
    jdArea: '60-69',
    rowSource: 'pages',
    pageType: 'program',
    properties: [titleProperty, phase, ...extra],
  });
}

function property(raw: unknown): PropertyDefinition {
  return propertyDefinitionSchema.parse(raw);
}

describe('#206 a money property cannot be declared stored', () => {
  it('has no money format on a number', () => {
    const money = { key: 'cost', name: 'Cost', source: frontmatter };
    expect(
      propertyDefinitionSchema.safeParse({ ...money, config: { type: 'number', format: 'money' } })
        .success,
    ).toBe(false);
    expect(
      propertyDefinitionSchema.safeParse({ ...money, config: { type: 'money' } }).success,
    ).toBe(false);
  });

  it('refuses a read-through property stored in frontmatter or a column', () => {
    const budget = {
      key: 'budget',
      name: 'Budget',
      config: { type: 'read_through', feed: 'budget' },
    };
    expect(propertyDefinitionSchema.safeParse({ ...budget, source: frontmatter }).success).toBe(
      false,
    );
    expect(
      propertyDefinitionSchema.safeParse({
        ...budget,
        source: { kind: 'column', column: 'budget' },
      }).success,
    ).toBe(false);
    expect(propertyDefinitionSchema.safeParse({ ...budget, source: derived }).success).toBe(true);
  });

  it('refuses a feed outside the closed set', () => {
    const raw = {
      key: 'x',
      name: 'X',
      source: derived,
      config: { type: 'read_through', feed: 'x' },
    };
    expect(propertyDefinitionSchema.safeParse(raw).success).toBe(false);
  });
});

describe('#206 a definition compiles to a row schema at runtime', () => {
  const owner = {
    key: 'lead',
    name: 'Lead',
    source: frontmatter,
    config: { type: 'person', multiple: false },
  };
  const span = { key: 'span', name: 'Span', source: frontmatter, config: { type: 'date_range' } };
  const compiled = compileRowSchema(definition([owner, span]));

  it('accepts values that fit and leaves out what is not stored', () => {
    const row = { phase: 'running', lead: '00000000-0000-4000-8000-000000000001' };
    expect(compiled.parse(row)).toEqual(row);
  });

  it('refuses an option the status does not have, a key it does not know and a backwards range', () => {
    expect(compiled.safeParse({ phase: 'unknown' }).success).toBe(false);
    expect(compiled.safeParse({ stray: 1 }).success).toBe(false);
    expect(compiled.safeParse({ span: { start: '2026-05-01', end: '2026-04-01' } }).success).toBe(
      false,
    );
  });

  it('requires a status with an option in each of its three groups', () => {
    const missing = { ...phase, config: { type: 'status', options: [phase.config.options[0]] } };
    expect(propertyDefinitionSchema.safeParse(missing).success).toBe(false);
  });

  it('requires a rule exactly when a property is narrower than internal', () => {
    const phone = { key: 'phone', name: 'Phone', source: frontmatter, config: { type: 'phone' } };
    expect(
      propertyDefinitionSchema.safeParse({ ...phone, classification: 'restricted' }).success,
    ).toBe(false);
    const rule = { steward: '10-19', role: 'viewer', owner: true };
    expect(
      propertyDefinitionSchema.safeParse({ ...phone, classification: 'restricted', rule }).success,
    ).toBe(true);
  });
});

describe('#206 a type change converts each row or reports it', () => {
  const text = property({
    key: 'size',
    name: 'Size',
    source: frontmatter,
    config: { type: 'text' },
  });
  const number = property({ ...text, config: { type: 'number' } });
  const select = property({
    key: 'tags',
    name: 'Tags',
    source: frontmatter,
    config: { type: 'select', options: [{ id: 'a', name: 'Alpha' }] },
  });
  const multi = property({
    ...select,
    config: { type: 'multi_select', options: [{ id: 'a', name: 'Alpha' }] },
  });

  it('converts text that is a number and refuses text that is not', () => {
    expect(convertValue(text, number, '42')).toEqual({ ok: true, value: 42 });
    expect(convertValue(text, number, 'forty')).toEqual({ ok: false });
  });

  it('turns a select into a multi-select and back only when one value is held', () => {
    expect(convertValue(select, multi, 'a')).toEqual({ ok: true, value: ['a'] });
    expect(convertValue(multi, select, ['a'])).toEqual({ ok: true, value: 'a' });
    expect(convertValue(multi, select, ['a', 'a'])).toEqual({ ok: false });
  });

  it('matches text to an option by its name', () => {
    expect(convertValue(text, select, 'alpha')).toEqual({ ok: true, value: 'a' });
  });

  it('refuses a change to or from a derived type', () => {
    expect(
      typeChangeAllowed(text.config, {
        type: 'rollup',
        rollup: { relation: 'x', property: null, function: 'count' },
      }),
    ).toBe(false);
    expect(typeChangeAllowed(text.config, number.config)).toBe(true);
  });
});

describe('#206 a definition names only what exists', () => {
  it('reports a rollup through a missing relation and a computed input of the wrong type', () => {
    const rollup = {
      key: 'portfolio',
      name: 'Portfolio',
      source: derived,
      config: {
        type: 'rollup',
        rollup: { relation: 'program', property: 'portfolio', function: 'show_unique' },
      },
    };
    const computed = {
      key: 'until',
      name: 'Until',
      source: derived,
      config: { type: 'computed', computed: { function: 'date_until', inputs: ['phase'] } },
    };
    expect(definitionProblems(definition([rollup, computed]), () => undefined)).toEqual([
      { property: 'portfolio', problem: 'rolls up through no relation' },
      { property: 'until', problem: 'cannot use phase' },
    ]);
  });

  it('refuses a frontmatter property on a record collection', () => {
    const tasks = collectionDefinitionSchema.parse({
      key: 'tasks',
      name: 'Tasks',
      jdArea: '00-09',
      rowSource: 'tasks',
      pageType: null,
      properties: [
        {
          key: 'title',
          name: 'Title',
          config: { type: 'title' },
          source: { kind: 'column', column: 'title' },
        },
        { key: 'mood', name: 'Mood', config: { type: 'text' }, source: frontmatter },
      ],
    });
    expect(definitionProblems(tasks, () => undefined)).toEqual([
      { property: 'mood', problem: 'a record collection stores no frontmatter' },
    ]);
  });
});

describe('#206 the filter, sort and group tree', () => {
  const me = { kind: 'condition', property: 'lead', operator: 'contains', value: { kind: 'me' } };
  const lately = {
    kind: 'condition',
    property: 'due',
    operator: 'within',
    value: { kind: 'relative', direction: 'past', unit: 'week', amount: 2 },
  };

  it('nests and/or groups with relative values', () => {
    const tree = {
      kind: 'group',
      conjunction: 'and',
      children: [me, { kind: 'group', conjunction: 'or', children: [lately] }],
    };
    expect(filterGroupSchema.parse(tree)).toEqual(tree);
  });

  it('refuses groups nested deeper than three', () => {
    const deep = (depth: number): unknown =>
      depth === 0 ? me : { kind: 'group', conjunction: 'and', children: [deep(depth - 1)] };
    expect(filterGroupSchema.safeParse(deep(3)).success).toBe(true);
    expect(filterGroupSchema.safeParse(deep(4)).success).toBe(false);
  });

  it('caps a page of rows at two hundred', () => {
    expect(rowQuerySchema.safeParse({ limit: 201 }).success).toBe(false);
  });

  it('requires a board to be grouped and a calendar to name its date', () => {
    expect(
      viewSettingsSchema.safeParse({ name: 'B', layout: 'board', scope: 'shared' }).success,
    ).toBe(false);
    expect(
      viewSettingsSchema.safeParse({ name: 'C', layout: 'calendar', scope: 'shared' }).success,
    ).toBe(false);
  });
});
