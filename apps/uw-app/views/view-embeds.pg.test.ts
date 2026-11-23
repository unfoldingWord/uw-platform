import { randomUUID } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { viewSettingsSchema } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { seedPage } from '@uw/db/test-seed';
import { ensureBuiltIns } from '../collections/builtins/seed.ts';
import { saveView } from '../collections/view-commands.ts';
import { homePageOf } from '../pages/area-homes.ts';
import {
  accepted,
  collectionsAt,
  defined,
  personWith,
  requestOf,
  rowIn,
} from '../testing/collections.ts';
import { testPortfolio, testProgram } from '../testing/collection-definitions.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { getHtml } from '../testing/views.ts';

const clock = { now: () => collectionsAt };

type World = {
  readonly db: Database;
  readonly insider: string;
  readonly outsider: string;
  readonly pageId: string;
};

async function embeddingPage(db: Database, viewId: string): Promise<string> {
  const pageId = randomUUID();
  await seedPage(db, {
    id: pageId,
    type: 'knowledge',
    status: 'active',
    jdArea: '00-09',
    slug: 'embedding',
    title: 'Field report',
    bodyMd: `Our programs:\n\n![Field programs](/collections/tprogram/views/${viewId})\n`,
    frontmatter: { jd_category: '01' },
  });
  return pageId;
}

function withWorld(work: (world: World) => Promise<void>) {
  return withAppDatabase(async (db) => {
    const admin = await personWith(db, 'admin', [
      { role: 'admin', area: '60-69' },
      { role: 'viewer', area: '00-09' },
    ]);
    const insider = await personWith(db, 'insider', [
      { role: 'viewer', area: '60-69' },
      { role: 'viewer', area: '00-09' },
    ]);
    const outsider = await personWith(db, 'outsider', [{ role: 'viewer', area: '00-09' }]);
    await defined(db, admin, testPortfolio);
    await defined(db, admin, testProgram);
    await rowIn(db, admin, { collection: 'tprogram', jdArea: '60-69', title: 'Gateway languages' });
    const viewId = randomUUID();
    const settings = viewSettingsSchema.parse({
      name: 'Field programs',
      layout: 'list',
      scope: 'shared',
    });
    accepted(
      await saveView(
        db,
        { command: 'save_view', requestId: randomUUID(), collection: 'tprogram', viewId, settings },
        requestOf(admin),
      ),
    );
    const pageId = await embeddingPage(db, viewId);
    await work({ db, insider: insider.email ?? '', outsider: outsider.email ?? '', pageId });
  });
}

async function body(world: World, email: string) {
  const html = await getHtml(world.db, email, `/pages/${world.pageId}`, {}, clock);
  expect(html.status).toBe(200);
  return new JSDOM(html.text).window.document.querySelector('[data-page-body]');
}

async function provesEmbed(world: World) {
  const shown = await body(world, world.insider);
  expect(shown?.querySelector('[data-view-embed-shown] ul li')?.textContent).toContain(
    'Gateway languages',
  );
  const hidden = await body(world, world.outsider);
  expect(hidden?.querySelector('[data-view-embed-shown]')).toBeNull();
  expect(hidden?.textContent).toContain('You do not have access to this view.');
  expect(hidden?.textContent).not.toContain('Gateway languages');
}

async function provesAreaHome(db: Database) {
  await ensureBuiltIns(db, collectionsAt);
  const home = await homePageOf(db, '00-09');
  expect(home).toBe('c0110000-0000-4000-8000-000000000900');
  const reader = await personWith(db, 'reader', [{ role: 'viewer', area: '00-09' }]);
  const html = await getHtml(db, reader.email ?? '', `/pages/${home ?? ''}`, {}, clock);
  const document = new JSDOM(html.text).window.document;
  expect(document.querySelectorAll('[data-view-embed-shown]').length).toBe(4);
  expect(document.querySelector('[data-view-embed-shown] svg[role="img"]')).not.toBeNull();
}

describe.skipIf(!testServer)('#206 a saved view embedded in a page', () => {
  it('is drawn for a reader who may read the view, and never widens access', () =>
    withWorld(provesEmbed));
});

describe.skipIf(!testServer)('#206 the 00 Dashboard', () => {
  it('becomes the 00-09 area home with live views beside its prose', () =>
    withAppDatabase(provesAreaHome));
});
