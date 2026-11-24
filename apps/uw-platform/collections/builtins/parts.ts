export const fm = { kind: 'frontmatter' } as const;
export const derived = { kind: 'derived' } as const;

export function column(name: string) {
  return { kind: 'column', column: name } as const;
}

export function option(id: string, name: string, tone = 'neutral') {
  return { id, name, tone };
}

export function status(id: string, name: string, group: 'to_do' | 'in_progress' | 'complete') {
  return {
    id,
    name,
    group,
    tone: group === 'complete' ? 'success' : group === 'in_progress' ? 'info' : 'neutral',
  };
}

export const titleOnPage = {
  key: 'name',
  name: 'Name',
  config: { type: 'title' },
  source: column('title'),
};

export function relation(
  key: string,
  name: string,
  target: string,
  multiple: boolean,
  reverseOf: string | null = null,
) {
  return {
    key,
    name,
    source: derived,
    config: { type: 'relation', relation: { target, multiple, reverse_of: reverseOf } },
  };
}

export function money(key: string, name: string, feed: string) {
  return { key, name, source: derived, section: 'Budget', config: { type: 'read_through', feed } };
}

export function system(type: string, name: string) {
  return { key: type, name, source: derived, config: { type } };
}

export function condition(property: string, operator: string, value: unknown) {
  return { kind: 'condition', property, operator, value };
}

export function all(...children: unknown[]) {
  return { kind: 'group', conjunction: 'and', children };
}

export function either(...children: unknown[]) {
  return { kind: 'group', conjunction: 'or', children };
}

export function shown(...keys: string[]) {
  return keys.map((property) => ({ property, visible: true, width: null }));
}
