import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { seedPage } from '@uw/db/test-seed';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { command, eventsNamed, softwareHarness } from '../testing/commands.ts';

async function page(db: Database, jdArea: string): Promise<string> {
  const id = randomUUID();
  await seedPage(db, {
    id,
    type: 'product',
    status: 'active',
    jdArea,
    bodyMd: 'The board.',
    slug: `board-${id.slice(0, 8)}`,
    title: 'The board',
  });
  return id;
}

function enqueueBody(requestId: string, pageId: string) {
  return { requestId, title: 'Draw the board', pageId, due: null };
}

async function pageOutsideIsMissing(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const elsewhere = await page(db, '20-29');
  const requestId = randomUUID();
  const send = (pageId: string) =>
    command(db, scene.editor, scene.harnessId, 'enqueue', enqueueBody(requestId, pageId));
  const outside = await send(elsewhere);
  const missing = await send(randomUUID());
  expect(missing.status).toBe(404);
  expect(missing.body).toEqual({ status: 'error', requestId, reason: 'page_not_found' });
  expect(outside.status).toBe(missing.status);
  expect(outside.text).toBe(missing.text);
  expect(await eventsNamed(db, scene.harnessId, 'item_created')).toEqual([]);
}

async function pageInsideIsLinked(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const pageId = await page(db, '80-89');
  const requestId = randomUUID();
  const sent = await command(
    db,
    scene.editor,
    scene.harnessId,
    'enqueue',
    enqueueBody(requestId, pageId),
  );
  expect(sent.body).toEqual({ status: 'accepted', requestId });
  expect(await eventsNamed(db, scene.harnessId, 'item_created')).toHaveLength(1);
}

async function malformedPageId(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const requestId = randomUUID();
  const sent = await command(
    db,
    scene.editor,
    scene.harnessId,
    'enqueue',
    enqueueBody(requestId, 'not-a-uuid'),
  );
  expect(sent.status).toBe(400);
  expect(sent.body).toEqual({ status: 'error', requestId, reason: 'malformed_command' });
}

async function kickstartPage(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const requestId = randomUUID();
  const kickstart = (pageId: string) =>
    command(db, scene.editor, scene.harnessId, 'kickstart', { requestId, pageId });
  const outside = await kickstart(await page(db, '20-29'));
  const missing = await kickstart(randomUUID());
  const inside = await kickstart(await page(db, '80-89'));
  expect(missing.body).toEqual({ status: 'error', requestId, reason: 'page_not_found' });
  expect(outside.text).toBe(missing.text);
  expect(inside.body).toEqual({ status: 'error', requestId, reason: 'not_wired' });
}

describe.skipIf(!testServer)('a page a command names', () => {
  it('a page that is missing, or not readable in the harness area, answers page_not_found byte-identically', () =>
    withAppDatabase(pageOutsideIsMissing));

  it('a page in the harness area is linked by enqueue', () => withAppDatabase(pageInsideIsLinked));

  it('a page id that is not a uuid is malformed_command, never an internal error', () =>
    withAppDatabase(malformedPageId));

  it('kickstart checks its page the same way before not_wired', () =>
    withAppDatabase(kickstartPage));
});
