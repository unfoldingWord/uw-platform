import type { Context } from 'hono';
import { formatCount } from '@uw/core/money';
import { EmptyState } from '@uw/ui/components/empty-state.tsx';
import { Icon } from '@uw/ui/components/icon.tsx';
import { ListRow, RowList } from '@uw/ui/components/list-row.tsx';
import { Section } from '@uw/ui/components/section.tsx';
import { ListShape } from '@uw/ui/shapes/list.tsx';
import type { AppEnv } from '../../deps.ts';
import { ensureBuiltIns } from '../../collections/builtins/seed.ts';
import { readableCollections, type StoredCollection } from '../../collections/definitions.ts';
import { renderScreen, screenKernel, screenRefusal } from '../parts/frame.tsx';
import { areaLabel, moduleCodes, pageNames } from '../parts/names.ts';
import { collectionPath, collectionsPath } from '../parts/paths.ts';

function Tile() {
  return (
    <span class="grid size-size-5 shrink-0 place-items-center rounded-md bg-raised text-text-2">
      <Icon name="table-cells" size={2} />
    </span>
  );
}

function Found(props: { readonly found: readonly StoredCollection[] }) {
  if (props.found.length === 0) {
    return (
      <EmptyState
        title="You can read no collection yet."
        text="Collections in the areas you can read will appear here."
      />
    );
  }
  return (
    <RowList label="Collections">
      {props.found.map((stored) => (
        <ListRow
          lead={<Tile />}
          title={stored.definition.name}
          href={collectionPath(stored.definition.key)}
          meta={stored.definition.description || undefined}
        />
      ))}
    </RowList>
  );
}

export async function collectionsScreen(c: Context<AppEnv>): Promise<Response> {
  const screen = screenKernel(c);
  const database = c.get('database');
  if (screen === null || database === null) return screenRefusal(c);
  await ensureBuiltIns(database.db, screen.at);
  const found = await readableCollections(database.db, screen.caller.actor, screen.at);
  const spec = {
    title: pageNames.collections,
    current: collectionsPath(),
    code: moduleCodes.collections,
    crumbs: [{ label: pageNames.collections }],
  };
  return renderScreen(
    c,
    spec,
    <ListShape
      head={{
        eyebrow: areaLabel('00-09'),
        title: pageNames.collections,
        lede: 'Lists of pages and records you can filter, sort, group and lay out as tables, boards, lists, galleries, calendars and charts.',
      }}
    >
      <Section title="Collections" sub={formatCount(found.length)}>
        <Found found={found} />
      </Section>
    </ListShape>,
  );
}
