import type {
  CollectionDefinition,
  PropertyDefinition,
  PropertyType,
  RowSource,
} from './collections.ts';

export const recordColumns: Readonly<Record<RowSource, Readonly<Record<string, PropertyType>>>> = {
  pages: { title: 'title' },
  tasks: {
    title: 'title',
    jd_area: 'text',
    status: 'status',
    due: 'date',
    assignees: 'person',
    priority: 'select',
    tags: 'multi_select',
    description: 'text',
    files: 'files',
    source: 'text',
    page_id: 'relation',
    related: 'relation',
  },
  people: {
    display_name: 'title',
    person_id: 'person',
    email: 'email',
    role: 'text',
    team: 'select',
    employment: 'select',
    ring: 'select',
    joined: 'date',
    phone: 'phone',
    mailing_address: 'text',
    url: 'url',
    compliance_status: 'select',
    compliance_due: 'date',
    portfolios: 'relation',
  },
};

export type DefinitionProblem = { readonly property: string; readonly problem: string };

type Lookup = (key: string) => CollectionDefinition | undefined;

const numericTypes: ReadonlySet<PropertyType> = new Set(['number', 'rollup', 'computed']);
const countableTypes: ReadonlySet<PropertyType> = new Set([
  'multi_select',
  'person',
  'relation',
  'files',
]);
const dateTypes: ReadonlySet<PropertyType> = new Set(['date', 'date_range']);

function columnProblem(definition: CollectionDefinition, property: PropertyDefinition) {
  const { source } = property;
  if (source.kind !== 'column') return null;
  const columns = recordColumns[definition.rowSource];
  const declared = Object.entries(columns).find(([name]) => name === source.column);
  if (declared === undefined) return 'names no column of its record table';
  return declared[1] === property.config.type ? null : 'does not match its column type';
}

function frontmatterProblem(definition: CollectionDefinition, property: PropertyDefinition) {
  if (property.source.kind !== 'frontmatter') return null;
  return definition.rowSource === 'pages' ? null : 'a record collection stores no frontmatter';
}

function byKey(definition: CollectionDefinition, key: string): PropertyDefinition | undefined {
  return definition.properties.find((property) => property.key === key);
}

function relationProblem(property: PropertyDefinition, lookup: Lookup, self: CollectionDefinition) {
  if (property.config.type !== 'relation') return null;
  const { target, reverse_of } = property.config.relation;
  const other = target === self.key ? self : lookup(target);
  if (other === undefined) return 'relates to no known collection';
  if (property.source.kind === 'derived' && other.rowSource !== 'pages') {
    return 'a linked relation reaches only a page collection';
  }
  if (reverse_of === null) return null;
  const back = byKey(other, reverse_of);
  if (back?.config.type !== 'relation' || back.config.relation.target !== self.key) {
    return 'its reverse is not a relation back to this collection';
  }
  return null;
}

function rollupReadProblem(fn: string, read: PropertyDefinition | undefined): string | null {
  if (read === undefined) return 'rolls up a property its target does not have';
  if (fn === 'sum' && !numericTypes.has(read.config.type)) {
    return 'sums a property that is not a number';
  }
  if (fn === 'percent_complete' && read.config.type !== 'status') return 'needs a status';
  return null;
}

function rollupProblem(property: PropertyDefinition, lookup: Lookup, self: CollectionDefinition) {
  if (property.config.type !== 'rollup') return null;
  const { relation, property: targetKey, function: fn } = property.config.rollup;
  const through = byKey(self, relation);
  if (through?.config.type !== 'relation') return 'rolls up through no relation';
  const target = through.config.relation.target;
  const other = target === self.key ? self : lookup(target);
  if (other === undefined) return 'rolls up a collection that is not known';
  if (targetKey === null) return fn === 'count' ? null : 'only a count names no property';
  return rollupReadProblem(fn, byKey(other, targetKey));
}

function computedInputFits(fn: string, type: PropertyType): boolean {
  if (fn === 'count') return countableTypes.has(type);
  if (fn === 'date_until') return dateTypes.has(type);
  return numericTypes.has(type);
}

const inputCounts: ReadonlyMap<string, number> = new Map([
  ['difference', 2],
  ['count', 1],
  ['date_until', 1],
]);

function computedProblem(property: PropertyDefinition, self: CollectionDefinition) {
  if (property.config.type !== 'computed') return null;
  const { function: fn, inputs } = property.config.computed;
  const wanted = inputCounts.get(fn);
  if (wanted !== undefined && inputs.length !== wanted) return `takes ${wanted} input`;
  const problems = inputs.map((key) => {
    const input = byKey(self, key);
    if (input === undefined || input.key === property.key) return `has no input ${key}`;
    return computedInputFits(fn, input.config.type) ? null : `cannot use ${key}`;
  });
  return problems.find((problem) => problem !== null) ?? null;
}

function problemOf(definition: CollectionDefinition, property: PropertyDefinition, lookup: Lookup) {
  return (
    columnProblem(definition, property) ??
    frontmatterProblem(definition, property) ??
    relationProblem(property, lookup, definition) ??
    rollupProblem(property, lookup, definition) ??
    computedProblem(property, definition)
  );
}

export function definitionProblems(
  definition: CollectionDefinition,
  lookup: Lookup,
): readonly DefinitionProblem[] {
  return definition.properties.flatMap((property) => {
    const problem = problemOf(definition, property, lookup);
    return problem === null ? [] : [{ property: property.key, problem }];
  });
}

export function titleProperty(definition: CollectionDefinition): PropertyDefinition {
  const title = definition.properties.find((property) => property.config.type === 'title');
  if (title === undefined) throw new Error('a parsed collection has a title property');
  return title;
}

export function propertyOf(
  definition: CollectionDefinition,
  key: string,
): PropertyDefinition | undefined {
  return byKey(definition, key);
}

export function isWritableProperty(property: PropertyDefinition): boolean {
  return property.source.kind !== 'derived' || property.config.type === 'relation';
}
