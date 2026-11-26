import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { rewritePageBody, rewritePageFrontmatter, seedPage } from '@uw/db/test-seed';
import { personOn } from '../testing/kernel.ts';
import { person, post } from '../testing/commands.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { templateDriftFor } from './policy-templates.ts';
import { readPage } from './store.ts';

const AREA = '00-09';
const COMMANDS = '/api/pages/commands';
const ON = new Date('2026-12-01T12:00:00.000Z');

type World = { readonly email: string; readonly personId: string; readonly templateId: string };

async function world(db: Database): Promise<World> {
  const editor = await person(db, 'templates', 'editor', AREA);
  const templateId = randomUUID();
  await seedPage(db, {
    id: templateId,
    type: 'policy',
    status: 'active',
    jdArea: AREA,
    slug: 'wip-limit-template',
    title: 'Work in progress limit',
    bodyMd: 'Hold at most three items in progress.',
    frontmatter: { enforcement: 'template', effective_from: '2026-01-01' },
  });
  return { email: editor.email, personId: editor.id, templateId };
}

function copyCommand(templateId: string, change: Readonly<Record<string, unknown>> = {}) {
  return {
    command: 'copy_template_policy',
    requestId: randomUUID(),
    pageId: randomUUID(),
    templateId,
    jdArea: AREA,
    title: 'Our work in progress limit',
    enforcement: 'default',
    appliesTo: null,
    effectiveFrom: '2026-12-01',
    ...change,
  };
}

async function copiesWithSourceAndVersion(db: Database): Promise<void> {
  const { email, personId, templateId } = await world(db);
  const command = copyCommand(templateId);
  const sent = await post(db, email, `${COMMANDS}/copy_template_policy`, command);
  expect(sent.body).toMatchObject({ status: 'accepted', pageId: command.pageId, version: 1 });
  const actor = await personOn(db, personId, email, ON);
  const copied = await readPage(db, actor, command.pageId, ON);
  expect(copied).toMatchObject({
    status: 'suggested',
    bodyMd: 'Hold at most three items in progress.',
    frontmatter: { enforcement: 'default', copied_from: { page_id: templateId, version: 1 } },
  });
}

async function refusesANonTemplate(db: Database): Promise<void> {
  const { email } = await world(db);
  const bound = randomUUID();
  await seedPage(db, {
    id: bound,
    type: 'policy',
    status: 'active',
    jdArea: AREA,
    slug: 'bound',
    title: 'Bound',
    bodyMd: 'Bound.',
    frontmatter: { enforcement: 'required', effective_from: '2026-01-01' },
  });
  const sent = await post(db, email, `${COMMANDS}/copy_template_policy`, copyCommand(bound));
  expect(sent.body).toMatchObject({ status: 'error', reason: 'malformed_command' });
  const hidden = await post(
    db,
    email,
    `${COMMANDS}/copy_template_policy`,
    copyCommand(randomUUID()),
  );
  expect(hidden.body).toMatchObject({ status: 'error', reason: 'page_not_found' });
}

async function driftAndAdopt(db: Database): Promise<void> {
  const { email, personId, templateId } = await world(db);
  const command = copyCommand(templateId);
  await post(db, email, `${COMMANDS}/copy_template_policy`, command);
  const actor = await personOn(db, personId, email, ON);
  expect(await templateDriftFor(db, actor, ON)).toEqual([]);
  await rewritePageBody(db, templateId, 'Hold at most two items in progress.');
  const drift = await templateDriftFor(db, actor, ON);
  expect(
    drift.map(({ copyId, copied, current, state }) => [copyId, copied, current, state]),
  ).toEqual([[command.pageId, 1, 2, 'behind']]);
  const adopt = {
    command: 'adopt_template_update',
    requestId: randomUUID(),
    pageId: command.pageId,
  };
  const pinnedOld = await post(db, email, `${COMMANDS}/adopt_template_update`, {
    ...adopt,
    requestId: randomUUID(),
    expectedVersion: 1,
    templateVersion: 1,
  });
  expect(pinnedOld.body).toMatchObject({ status: 'error', reason: 'stale_version' });
  const sent = await post(db, email, `${COMMANDS}/adopt_template_update`, {
    ...adopt,
    expectedVersion: 1,
    templateVersion: 2,
  });
  expect(sent.body).toMatchObject({ status: 'accepted', version: 2 });
  const adopted = await readPage(db, actor, command.pageId, ON);
  expect(adopted?.bodyMd).toBe('Hold at most two items in progress.');
  expect(adopted?.frontmatter['copied_from']).toEqual({ page_id: templateId, version: 2 });
  expect(await templateDriftFor(db, actor, ON)).toEqual([]);
  const again = await post(db, email, `${COMMANDS}/adopt_template_update`, {
    ...adopt,
    requestId: randomUUID(),
    expectedVersion: 2,
    templateVersion: 2,
  });
  expect(again.body).toMatchObject({ status: 'error', reason: 'malformed_command' });
}

async function adoptsOnlyFromATemplate(db: Database): Promise<void> {
  const { email, templateId } = await world(db);
  const command = copyCommand(templateId);
  await post(db, email, `${COMMANDS}/copy_template_policy`, command);
  await rewritePageBody(db, templateId, 'Now a binding rule.');
  await rewritePageFrontmatter(db, templateId, {
    enforcement: 'default',
    effective_from: '2026-01-01',
  });
  const sent = await post(db, email, `${COMMANDS}/adopt_template_update`, {
    command: 'adopt_template_update',
    requestId: randomUUID(),
    pageId: command.pageId,
    expectedVersion: 1,
    templateVersion: 2,
  });
  expect(sent.body).toMatchObject({ status: 'error', reason: 'malformed_command' });
}

describe.skipIf(!testServer)('PO-5 a template policy is copied with its source and version', () => {
  it('copies the template text into a suggested policy that names its source and version', () =>
    withAppDatabase(copiesWithSourceAndVersion));

  it('refuses to copy a policy that is not a template, and a template the person cannot see', () =>
    withAppDatabase(refusesANonTemplate));

  it('reports a copy behind its source, and adopting the update clears it', () =>
    withAppDatabase(driftAndAdopt));

  it('refuses to adopt from a source that is no longer a template', () =>
    withAppDatabase(adoptsOnlyFromATemplate));
});
