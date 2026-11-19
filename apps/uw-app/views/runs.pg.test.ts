import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { meteredRun, subscriptionRun } from '../testing/board-world.ts';
import { enqueued, rowan, softwareHarness, type Scene } from '../testing/commands.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { screenProblems } from '../testing/screen-checks.ts';
import { getHtml } from '../testing/views.ts';

const ROWAN = 'rowan.test@unfoldingword.org';

type Seeded = Scene & {
  readonly itemId: string;
  readonly runId: string;
  readonly otherRunId: string;
};

function documentOf(text: string): Document {
  return new JSDOM(text).window.document;
}

const runsOf = (harnessId: string) => `/harnesses/${harnessId}/runs`;

async function seeded(db: Database): Promise<Seeded> {
  const scene = await softwareHarness(db);
  await rowan(db);
  const at = new Date();
  const itemId = await enqueued(db, scene.harnessId, 'Retry webhook deliveries');
  const runId = await meteredRun(db, { harnessId: scene.harnessId, itemId, at }, 'running');
  const owned = await enqueued(db, scene.harnessId, 'Split the test job');
  await subscriptionRun(
    db,
    { harnessId: scene.harnessId, itemId: owned, at: new Date(at.getTime() - 60_000) },
    `agent:${scene.editor.id}/laptop`,
  );
  const foreign = await enqueued(db, scene.otherHarnessId, 'Elsewhere');
  const otherRunId = await meteredRun(
    db,
    { harnessId: scene.otherHarnessId, itemId: foreign, at },
    'completed',
  );
  return { ...scene, itemId, runId, otherRunId };
}

function cellsOf(document: Document): readonly string[] {
  return [...document.querySelectorAll('main tbody tr')].map((row) =>
    [...row.querySelectorAll('td')].map((cell) => cell.textContent?.trim() ?? '').join(' | '),
  );
}

async function listsRuns(db: Database): Promise<void> {
  const world = await seeded(db);
  const page = await getHtml(db, ROWAN, runsOf(world.harnessId));
  expect(page.status).toBe(200);
  expect(await screenProblems(page.text)).toEqual([]);
  const document = documentOf(page.text);
  expect(document.querySelector('[aria-current="page"]')?.textContent).toContain('Runs');
  const rows = cellsOf(document);
  expect(rows).toHaveLength(2);
  expect(rows[0]).toContain('Retry webhook deliveries | Running');
  expect(rows[0]).toMatch(/\$1\.50$/);
  expect(rows[1]).toContain('A person’s own Claude Code | Split the test job | Done');
  expect(rows[1]).toMatch(/1,200 tokens, own subscription$/);
}

function buttons(document: Document): readonly string[] {
  return [...document.querySelectorAll('main form button')].map(
    (button) => button.textContent?.trim() ?? '',
  );
}

async function adminSeesControls(db: Database): Promise<void> {
  const world = await seeded(db);
  const page = await getHtml(db, ROWAN, `${runsOf(world.harnessId)}/${world.runId}`);
  expect(page.status).toBe(200);
  expect(await screenProblems(page.text)).toEqual([]);
  const document = documentOf(page.text);
  expect(document.querySelector('main h1')?.textContent).toBe('Retry webhook deliveries');
  expect(document.querySelector('main ol li')?.textContent).toContain('3,000 tokens');
  expect(buttons(document)).toEqual(['Stop run', 'Take over']);
  expect(
    document.querySelector('form[data-command="take_over"] input[name="itemId"]'),
  ).toBeTruthy();
  expect(document.querySelector('nav[aria-label="Links for this item"]')).not.toBeNull();
}

async function editorSeesNoControls(db: Database): Promise<void> {
  const world = await seeded(db);
  const page = await getHtml(db, world.editor.email, `${runsOf(world.harnessId)}/${world.runId}`);
  expect(page.status).toBe(200);
  expect(buttons(documentOf(page.text))).toEqual([]);
}

async function foreignRunNotFound(db: Database): Promise<void> {
  const world = await seeded(db);
  const page = await getHtml(db, ROWAN, `${runsOf(world.harnessId)}/${world.otherRunId}`);
  expect(page.status).toBe(404);
}

async function itemPageKept(db: Database): Promise<void> {
  const world = await seeded(db);
  const page = await getHtml(db, ROWAN, `/harnesses/${world.harnessId}/items/${world.itemId}`);
  expect(page.status).toBe(200);
  const document = documentOf(page.text);
  expect(document.querySelector(`a[href="${runsOf(world.harnessId)}"]`)).not.toBeNull();
}

describe.skipIf(!testServer)('the Runs tab', () => {
  it('lists recent runs with dollars for platform runs and tokens for own-subscription runs', () =>
    withAppDatabase(listsRuns));

  it("a run's page shows its steps and Stop run and Take over to an area admin", () =>
    withAppDatabase(adminSeesControls));

  it('an editor who does not own the run sees no run controls', () =>
    withAppDatabase(editorSeesNoControls));

  it('a run of another workflow is not found under this one', () =>
    withAppDatabase(foreignRunNotFound));

  it('the item page still renders and links back to the Runs tab', () =>
    withAppDatabase(itemPageKept));
});
