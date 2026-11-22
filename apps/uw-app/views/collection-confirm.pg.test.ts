import { randomUUID } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { viewSettingsSchema } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { saveView } from '../collections/view-commands.ts';
import { accepted, collectionsAt, defined, personWith, requestOf } from '../testing/collections.ts';
import { testPortfolio, testProgram } from '../testing/collection-definitions.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { screenProblems } from '../testing/screen-checks.ts';
import { getHtml } from '../testing/views.ts';

const clock = { now: () => collectionsAt };

async function settingsOf(db: Database) {
  const admin = await personWith(db, 'admin', [
    { role: 'admin', area: '60-69' },
    { role: 'viewer', area: '00-09' },
  ]);
  await defined(db, admin, testPortfolio);
  await defined(db, admin, testProgram);
  const settings = viewSettingsSchema.parse({ name: 'All', layout: 'table', scope: 'shared' });
  const viewId = randomUUID();
  const command = {
    command: 'save_view',
    requestId: randomUUID(),
    collection: 'tprogram',
    viewId,
    settings,
  } as const;
  accepted(await saveView(db, command, requestOf(admin)));
  const html = await getHtml(db, admin.email ?? '', '/collections/tprogram/settings', {}, clock);
  expect(html.status).toBe(200);
  expect(await screenProblems(html.text)).toEqual([]);
  return new JSDOM(html.text).window.document;
}

function textOf(element: Element | null | undefined): string {
  return element?.textContent ?? '';
}

function shapeOf(form: Element) {
  const details = form.closest('details');
  return {
    open: details === null || details.hasAttribute('open'),
    opener: textOf(details?.querySelector('summary')),
    loss: textOf(details?.querySelector('p')),
    button: textOf(form.querySelector('button[type="submit"]')),
  };
}

function guarded(document: Document, command: string) {
  return [...document.querySelectorAll(`form[data-command="${command}"]`)].map(shapeOf);
}

async function provesConfirmation(db: Database) {
  const document = await settingsOf(db);
  const removals = guarded(document, 'remove_property');
  expect(removals.length).toBeGreaterThan(0);
  for (const removal of removals) {
    expect(removal.open).toBe(false);
    expect(removal.opener).toMatch(/^Remove /);
    expect(removal.loss).toContain('You cannot undo this.');
    expect(removal.button).toBe(removal.opener.replace(/^Remove /, 'Confirm remove '));
  }
  expect(guarded(document, 'delete_view')).toEqual([
    {
      open: false,
      opener: 'Delete All',
      loss: 'All goes away for everyone who uses it, with its filters, sorts, groups and card order. Page embeds of it stop showing. You cannot undo this.',
      button: 'Confirm delete All',
    },
  ]);
}

describe.skipIf(!testServer)('removing a property or deleting a view', () => {
  it('asks first, naming what is lost, behind a closed disclosure', () =>
    withAppDatabase(provesConfirmation));
});
