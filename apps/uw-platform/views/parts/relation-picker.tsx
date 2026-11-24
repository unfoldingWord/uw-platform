import { rowQuerySchema, type PropertyDefinition, type RowQuery } from '@uw/contracts';
import type { Principal } from '@uw/core/principal';
import { commandButton } from '@uw/ui/components/command-form.tsx';
import { TextField } from '@uw/ui/components/field.tsx';
import type { Executor } from '@uw/db/client';
import type { StoredCollection } from '../../collections/definitions.ts';
import { readRows } from '../../collections/reader.ts';
import type { Choice } from './collection-edit.tsx';
import { pageLink } from './page-shown.ts';

export const PICKER_PAGE = 50;

const MOST_SEARCH = 100;

export type Finding = {
  readonly property: string | null;
  readonly text: string;
  readonly after: string | null;
};

export type Found = {
  readonly choices: readonly Choice[];
  readonly next: string | null;
  readonly text: string;
};

export function findingOf(params: URLSearchParams): Finding {
  const after = params.get('after');
  return {
    property: params.get('find'),
    text: (params.get('q') ?? '').trim().slice(0, MOST_SEARCH),
    after: after !== null && /^[0-9]{1,7}$/.test(after) ? after : null,
  };
}

function queryFor(target: StoredCollection, finding: Finding | null): RowQuery {
  const title = target.definition.properties.find((p) => p.config.type === 'title');
  const text = finding?.text ?? '';
  const filter =
    text === '' || title === undefined
      ? null
      : {
          kind: 'group',
          conjunction: 'and',
          children: [{ kind: 'condition', property: title.key, operator: 'contains', value: text }],
        };
  return rowQuerySchema.parse({
    limit: PICKER_PAGE,
    cursor: finding?.after ?? null,
    filter,
    sorts: title === undefined ? [] : [{ property: title.key, direction: 'asc' }],
  });
}

type Reach = {
  readonly db: Executor;
  readonly actor: Principal;
  readonly at: Date;
  readonly all: ReadonlyMap<string, StoredCollection>;
};

async function foundFor(reach: Reach, property: PropertyDefinition, finding: Finding) {
  if (property.config.type !== 'relation') return null;
  const target = reach.all.get(property.config.relation.target);
  if (target === undefined) return null;
  const mine = finding.property === property.key ? finding : null;
  const read = await readRows(reach.db, target, reach.actor, reach.at, {
    query: queryFor(target, mine),
    view: null,
  });
  if (!read.ok) return { choices: [], next: null, text: mine?.text ?? '' };
  return {
    choices: read.value.rows.map((r) => ({ value: r.id, label: r.title })),
    next: read.value.next,
    text: mine?.text ?? '',
  };
}

export async function relationChoices(
  reach: Reach,
  stored: StoredCollection,
  finding: Finding,
): Promise<ReadonlyMap<string, Found>> {
  const found = new Map<string, Found>();
  for (const property of stored.definition.properties) {
    const each = await foundFor(reach, property, finding);
    if (each !== null) found.set(property.key, each);
  }
  return found;
}

function moreHref(path: string, property: string, found: Found, next: string): string {
  const params = new URLSearchParams({ find: property, q: found.text, after: next });
  return `${path}?${params.toString()}#${property}`;
}

export function RelationFinder(props: {
  readonly path: string;
  readonly property: PropertyDefinition;
  readonly found: Found;
}) {
  const { path, property, found } = props;
  const label = `Find ${property.name.toLowerCase()}`;
  return (
    <div class="flex flex-col gap-2">
      <form
        method="get"
        action={`${path}#${property.key}`}
        role="search"
        class="flex flex-wrap items-end gap-2"
      >
        <input type="hidden" name="find" value={property.key} />
        <TextField
          name="q"
          label={label}
          scope={property.key}
          value={found.text}
          maxLength={MOST_SEARCH}
        />
        <button type="submit" class={commandButton}>
          Find
        </button>
      </form>
      {found.next === null ? null : (
        <a href={moreHref(path, property.key, found, found.next)} class={`text-sm ${pageLink}`}>
          {`More ${property.name.toLowerCase()}`}
        </a>
      )}
    </div>
  );
}
