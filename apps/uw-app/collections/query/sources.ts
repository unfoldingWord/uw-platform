import { sql, type SQL } from 'drizzle-orm';
import type { CollectionDefinition, PropertyDefinition, RowSource } from '@uw/contracts';

type Kind = 'text' | 'number' | 'date' | 'range' | 'list' | 'bool' | 'instant' | 'identity';

export type Expr = {
  readonly kind: Kind;
  readonly scalar: SQL;
  readonly end: SQL | null;
  readonly value: SQL;
};

type Column = { readonly sql: SQL; readonly kind: Kind };
type AliasedColumn = { readonly of: (alias: SQL) => SQL; readonly kind: Kind };

const taskColumns: Readonly<Record<string, AliasedColumn>> = {
  title: { of: (a) => sql`${a}.title`, kind: 'text' },
  jd_area: { of: (a) => sql`${a}.jd_area`, kind: 'text' },
  status: { of: (a) => sql`${a}.status`, kind: 'text' },
  due: { of: (a) => sql`${a}.due`, kind: 'date' },
  assignees: { of: (a) => sql`${a}.assignees::text[]`, kind: 'list' },
  priority: { of: (a) => sql`${a}.priority`, kind: 'text' },
  tags: { of: (a) => sql`${a}.tags`, kind: 'list' },
  description: { of: (a) => sql`${a}.description`, kind: 'text' },
  files: { of: (a) => sql`${a}.files::text[]`, kind: 'list' },
  source: { of: (a) => sql`${a}.source`, kind: 'text' },
  page_id: {
    of: (a) =>
      sql`(CASE WHEN ${a}.page_id IS NULL THEN '{}'::text[] ELSE ARRAY[${a}.page_id::text] END)`,
    kind: 'list',
  },
  related: { of: (a) => sql`${a}.related::text[]`, kind: 'list' },
};

const peopleColumns: Readonly<Record<string, Column>> = {
  display_name: { sql: sql`pe.display_name`, kind: 'text' },
  person_id: { sql: sql`pe.id::text`, kind: 'text' },
  email: { sql: sql`pe.email`, kind: 'text' },
  role: { sql: sql`de.role`, kind: 'text' },
  team: { sql: sql`de.team`, kind: 'text' },
  employment: { sql: sql`de.employment`, kind: 'text' },
  ring: { sql: sql`de.ring`, kind: 'text' },
  joined: { sql: sql`de.joined`, kind: 'date' },
  url: { sql: sql`de.url`, kind: 'text' },
  portfolios: { sql: sql`coalesce(de.portfolios::text[], '{}'::text[])`, kind: 'list' },
  phone: { sql: sql`dp.phone`, kind: 'text' },
  mailing_address: { sql: sql`dp.mailing_address`, kind: 'text' },
  compliance_status: { sql: sql`dp.compliance_status`, kind: 'text' },
  compliance_due: { sql: sql`dp.compliance_due`, kind: 'date' },
};

const tasksByName: ReadonlyMap<string, AliasedColumn> = new Map(Object.entries(taskColumns));
const peopleByName: ReadonlyMap<string, Column> = new Map(Object.entries(peopleColumns));

function plain(kind: Kind, scalar: SQL): Expr {
  return { kind, scalar, end: null, value: sql`to_jsonb(${scalar})` };
}

export function columnExpr(source: RowSource, column: string, alias = 'p'): Expr | null {
  if (source === 'pages')
    return column === 'title' ? plain('text', sql.raw(`${alias}.title`)) : null;
  if (source === 'tasks') {
    const task = tasksByName.get(column);
    return task === undefined
      ? null
      : plain(task.kind, task.of(sql.raw(alias === 'p' ? 't' : alias)));
  }
  const person = alias === 'p' ? peopleByName.get(column) : undefined;
  return person === undefined ? null : plain(person.kind, person.sql);
}

const textTypes: ReadonlySet<string> = new Set([
  'text',
  'url',
  'email',
  'phone',
  'select',
  'status',
]);
const listTypes: ReadonlySet<string> = new Set(['multi_select', 'person', 'files']);

export function frontmatterExpr(property: PropertyDefinition, alias = 'p'): Expr | null {
  const fm = sql.raw(`${alias}.frontmatter`);
  const key = property.key;
  const value = sql`(${fm} -> ${key}::text)`;
  const type = property.config.type;
  const call = (fn: string) => sql`${sql.raw(fn)}(${fm}, ${key}::text)`;
  if (textTypes.has(type)) return { kind: 'text', scalar: call('uw_prop_text'), end: null, value };
  if (listTypes.has(type)) return { kind: 'list', scalar: call('uw_prop_list'), end: null, value };
  if (type === 'number')
    return { kind: 'number', scalar: call('uw_prop_number'), end: null, value };
  if (type === 'date') return { kind: 'date', scalar: call('uw_prop_date'), end: null, value };
  if (type === 'checkbox') return { kind: 'bool', scalar: call('uw_prop_bool'), end: null, value };
  if (type === 'date_range') {
    return {
      kind: 'range',
      scalar: call('uw_prop_range_start'),
      end: call('uw_prop_range_end'),
      value,
    };
  }
  return null;
}

function instant(scalar: SQL): Expr {
  return { kind: 'instant', scalar, end: null, value: sql`to_jsonb(${scalar})` };
}

function identity(scalar: SQL): Expr {
  return { kind: 'identity', scalar, end: null, value: sql`to_jsonb(${scalar})` };
}

function versionEditor(alias: string, order: 'ASC' | 'DESC'): SQL {
  return sql.raw(
    `(SELECT v.edit_source FROM page_versions v WHERE v.page_id = ${alias}.id ORDER BY v.version ${order} LIMIT 1)`,
  );
}

function completeIds(definition: CollectionDefinition): { key: string; ids: string[] } | null {
  const status = definition.properties.find(
    (p) => p.config.type === 'status' && p.source.kind === 'frontmatter',
  );
  if (status === undefined || status.config.type !== 'status') return null;
  const ids = status.config.options.filter((o) => o.group === 'complete').map((o) => o.id);
  return { key: status.key, ids };
}

function pageCompletedAt(definition: CollectionDefinition, alias: string): SQL {
  const status = completeIds(definition);
  if (status === null || status.ids.length === 0) return sql`NULL::timestamptz`;
  const done = sql`ARRAY[${sql.join(
    status.ids.map((id) => sql`${id}`),
    sql`, `,
  )}]::text[]`;
  const a = sql.raw(alias);
  return sql`(CASE WHEN uw_prop_text(${a}.frontmatter, ${status.key}::text) = ANY(${done}) THEN (SELECT min(v.saved_at) FROM page_versions v WHERE v.page_id = ${a}.id AND v.version > coalesce((SELECT max(w.version) FROM page_versions w WHERE w.page_id = ${a}.id AND NOT (coalesce(uw_prop_text(w.frontmatter, ${status.key}::text), '') = ANY(${done}))), 0)) END)`;
}

const systemBySource: Readonly<
  Record<RowSource, (type: string, definition: CollectionDefinition, alias: string) => Expr | null>
> = {
  pages: (type, definition, alias) => {
    if (type === 'created_time') return instant(sql.raw(`${alias}.created_at`));
    if (type === 'edited_time') return instant(sql.raw(`${alias}.updated_at`));
    if (type === 'created_by') return identity(versionEditor(alias, 'ASC'));
    if (type === 'edited_by') return identity(versionEditor(alias, 'DESC'));
    if (type === 'completed_time') return instant(pageCompletedAt(definition, alias));
    return null;
  },
  tasks: (type, _definition, alias) => {
    const a = sql.raw(alias === 'p' ? 't' : alias);
    if (type === 'created_time') return instant(sql`${a}.created_at`);
    if (type === 'edited_time') return instant(sql`coalesce(${a}.updated_at, ${a}.created_at)`);
    if (type === 'created_by') return identity(sql`${a}.created_by`);
    if (type === 'edited_by') return identity(sql`coalesce(${a}.updated_by, ${a}.created_by)`);
    if (type === 'completed_time') return instant(sql`${a}.completed_at`);
    return null;
  },
  people: (type, _definition, alias) => {
    if (alias !== 'p') return null;
    if (type === 'created_time') return instant(sql`pe.created_at`);
    if (type === 'edited_time') return instant(sql`coalesce(de.updated_at, pe.created_at)`);
    if (type === 'edited_by') return identity(sql`de.updated_by`);
    return null;
  },
};

export function systemExpr(
  definition: CollectionDefinition,
  property: PropertyDefinition,
  alias = 'p',
): Expr | null {
  return systemBySource[definition.rowSource](property.config.type, definition, alias);
}
