import { randomUUID } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { viewSettingsSchema, type Principal } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { seedPage } from '@uw/db/test-seed';
import { saveView } from '../collections/view-commands.ts';
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
import { MOST_EMBEDDED_VIEWS } from './parts/view-embed.tsx';

const clock = { now: () => collectionsAt };
const DENIED = 'You do not have access to this view.';

type Rig = { readonly db: Database; readonly admin: Principal; readonly reader: Principal };

function withRig(work: (rig: Rig) => Promise<void>) {
  return withAppDatabase(async (db) => {
    const admin = await personWith(db, 'admin', [
      { role: 'admin', area: '60-69' },
      { role: 'viewer', area: '00-09' },
    ]);
    const reader = await personWith(db, 'reader', [
      { role: 'viewer', area: '60-69' },
      { role: 'viewer', area: '00-09' },
    ]);
    await defined(db, admin, testPortfolio);
    await defined(db, admin, testProgram);
    await rowIn(db, admin, { collection: 'tprogram', jdArea: '60-69', title: 'Gateway languages' });
    await work({ db, admin, reader });
  });
}

async function viewOf(rig: Rig, name: string, scope: 'shared' | 'personal'): Promise<string> {
  const viewId = randomUUID();
  const settings = viewSettingsSchema.parse({ name, layout: 'list', scope });
  const command = {
    command: 'save_view',
    requestId: randomUUID(),
    collection: 'tprogram',
    viewId,
    settings,
  } as const;
  accepted(await saveView(rig.db, command, requestOf(rig.admin)));
  return viewId;
}

async function pageBody(rig: Rig, embeds: readonly string[], who: Principal) {
  const pageId = randomUUID();
  const bodyMd = embeds.map((path, n) => `![View ${String(n)}](${path})`).join('\n\n');
  await seedPage(rig.db, {
    id: pageId,
    type: 'knowledge',
    status: 'active',
    jdArea: '00-09',
    slug: `embeds-${pageId.slice(0, 8)}`,
    title: 'Embeds',
    bodyMd: `${bodyMd}\n`,
    frontmatter: { jd_category: '01' },
  });
  const html = await getHtml(rig.db, who.email ?? '', `/pages/${pageId}`, {}, clock);
  expect(html.status).toBe(200);
  const body = new JSDOM(html.text).window.document.querySelector('[data-page-body]');
  if (body === null) throw new Error('no page body');
  return body;
}

async function provesPersonalViewStaysPersonal(rig: Rig) {
  const viewId = await viewOf(rig, 'Mine', 'personal');
  const path = `/collections/tprogram/views/${viewId}`;
  const owner = await pageBody(rig, [path], rig.admin);
  expect(owner.querySelector(`[data-view-embed-shown="${viewId}"]`)).not.toBeNull();
  const other = await pageBody(rig, [path], rig.reader);
  expect(other.querySelector('[data-view-embed-shown]')).toBeNull();
  expect(other.textContent).toContain(DENIED);
}

async function provesKeyMustMatch(rig: Rig) {
  const viewId = await viewOf(rig, 'Shared', 'shared');
  const body = await pageBody(rig, [`/collections/tportfolio/views/${viewId}`], rig.admin);
  expect(body.querySelector('[data-view-embed-shown]')).toBeNull();
  expect(body.textContent).toContain(DENIED);
}

async function provesCap(rig: Rig) {
  const paths: string[] = [];
  for (let n = 0; n <= MOST_EMBEDDED_VIEWS; n += 1) {
    paths.push(`/collections/tprogram/views/${await viewOf(rig, `View ${String(n)}`, 'shared')}`);
  }
  const first = paths[0] ?? '';
  const body = await pageBody(rig, [...paths, first], rig.reader);
  expect(body.querySelectorAll('[data-view-embed-shown]')).toHaveLength(MOST_EMBEDDED_VIEWS + 1);
  expect(body.querySelectorAll('[data-embed-notice]')).toHaveLength(1);
  expect(body.textContent).toContain('This page shows at most ten views.');
}

describe.skipIf(!testServer)('#206 a view embed draws only what its reader may open', () => {
  it('keeps a personal view to its owner', () => withRig(provesPersonalViewStaysPersonal));
  it('refuses a view placed under another collection key', () => withRig(provesKeyMustMatch));
  it('draws at most ten distinct views and reuses a repeated one', () => withRig(provesCap));
});
