import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import type { Clock } from '@uw/harness';
import { boardWorld, type BoardWorld } from '../testing/board-world.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { screenProblems } from '../testing/screen-checks.ts';
import { getHtml } from '../testing/views.ts';
import { agentQueuesPath, boardPath } from './parts/paths.ts';

const seedClock: Clock = { now: () => new Date('2026-10-02T06:00:00.000Z') };
const viewClock: Clock = { now: () => new Date('2026-10-02T09:00:00.000Z') };

function documentOf(html: string): Document {
  return new JSDOM(html).window.document;
}

async function queuesAs(world: BoardWorld, email: string) {
  return getHtml(world.db, email, agentQueuesPath(), {}, viewClock);
}

async function inWorld(work: (world: BoardWorld) => Promise<void>): Promise<void> {
  await withAppDatabase(async (db: Database) => work(await boardWorld(db, seedClock)));
}

async function cardOpensTheWorkflow(world: BoardWorld): Promise<void> {
  const response = await queuesAs(world, world.ianEmail);
  expect(response.status).toBe(200);
  const document = documentOf(response.text);
  const main = document.querySelector('main');
  const card = main?.querySelector(`section a[href="${boardPath(world.harnessId)}"]`);
  expect(card).not.toBeNull();
  const section = card?.closest('section');
  expect(section?.textContent).toContain('80-89');
  for (const phase of ['Product package', 'Build package', 'Deploy package', 'Iterate']) {
    expect(section?.textContent, phase).toContain(phase);
  }
  expect(section?.textContent).toContain('Oldest item:');
  expect(section?.textContent).toMatch(/waiting on you/);
  frameIsLiveUnderInfrastructure(document);
  expect(await screenProblems(response.text)).toEqual([]);
}

function frameIsLiveUnderInfrastructure(document: Document): void {
  const crumbs = document.querySelector('nav[aria-label="Breadcrumb"]')?.textContent ?? '';
  expect(crumbs).toContain('Infrastructure');
  expect(crumbs).toContain('Agent Queues');
  const live = document.querySelector('[data-live-screen]');
  expect(live?.getAttribute('data-live-screen')).toBe('queues');
}

async function strangerSeesWhyNotAnError(world: BoardWorld): Promise<void> {
  const response = await queuesAs(world, world.stranger.email);
  expect(response.status).toBe(200);
  const main = documentOf(response.text).querySelector('main');
  expect(main?.querySelector('[role="note"]')?.textContent).toContain(
    "You don't have access to any workflows yet",
  );
  expect(main?.querySelector(`a[href="${boardPath(world.harnessId)}"]`)).toBeNull();
  expect(await screenProblems(response.text)).toEqual([]);
}

async function viewerHasNothingToDecide(world: BoardWorld): Promise<void> {
  const main = documentOf((await queuesAs(world, world.viewer.email)).text).querySelector('main');
  expect(main?.querySelector(`a[href="${boardPath(world.harnessId)}"]`)).not.toBeNull();
  expect(main?.textContent).toContain('Nothing waiting on you');
}

async function workflowCrumbLeadsBack(world: BoardWorld): Promise<void> {
  const html = (await getHtml(world.db, world.ianEmail, boardPath(world.harnessId), {}, viewClock))
    .text;
  const crumbs = documentOf(html).querySelector('nav[aria-label="Breadcrumb"]');
  expect(crumbs?.querySelector(`a[href="${agentQueuesPath()}"]`)?.textContent).toBe('Agent Queues');
  expect(crumbs?.textContent).toContain('Infrastructure');
}

describe.skipIf(!testServer)('#104 the Agent Queues landing page', () => {
  it('#104 a card per workflow opens its board and shows its phases, oldest item and what waits', () =>
    inWorld(cardOpensTheWorkflow));
  it('#104 a person with no workflows in reach sees why, not an error', () =>
    inWorld(strangerSeesWhyNotAnError));
  it('#104 a viewer sees the workflow with nothing to decide', () =>
    inWorld(viewerHasNothingToDecide));
  it('#104 a workflow screen breadcrumb leads back to Agent Queues', () =>
    inWorld(workflowCrumbLeadsBack));
});
