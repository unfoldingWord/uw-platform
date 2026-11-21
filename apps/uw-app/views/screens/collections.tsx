import type { Context } from 'hono';
import { Card } from '@uw/ui/components/card.tsx';
import { PageHead } from '@uw/ui/components/page-head.tsx';
import type { AppEnv } from '../../deps.ts';
import { ensureBuiltIns } from '../../collections/builtins/seed.ts';
import { readableCollections } from '../../collections/definitions.ts';
import { renderScreen, screenKernel, screenRefusal } from '../parts/frame.tsx';
import { areaLabel, moduleCodes, pageNames } from '../parts/names.ts';
import { pageLink } from '../parts/page-shown.ts';
import { collectionPath, collectionsPath } from '../parts/paths.ts';

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
    <>
      <PageHead
        eyebrow={areaLabel('00-09')}
        title={pageNames.collections}
        lede="Lists of pages and records you can filter, sort, group and lay out as tables, boards, lists, galleries, calendars and charts."
      />
      <Card title="Collections" flush>
        {found.length === 0 ? (
          <p class="m-0 p-4 text-sm text-text-2">You can read no collection yet.</p>
        ) : (
          <ul class="m-0 flex list-none flex-col divide-y divide-line-soft p-0">
            {found.map((stored) => (
              <li class="flex flex-col gap-1 px-4 py-3">
                <a href={collectionPath(stored.definition.key)} class={pageLink}>
                  {stored.definition.name}
                </a>
                <p class="m-0 text-sm text-text-2">{stored.definition.description}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>,
  );
}
