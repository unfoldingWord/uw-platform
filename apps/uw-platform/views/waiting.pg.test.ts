import { randomUUID } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { rewriteItem, seedOpenItems } from '@uw/db/test-seed';
import { VIEW_LIMIT, type Template } from '@uw/harness';
import { commandBody } from '../islands/browser/command-body.ts';
import { clock, decisionRows } from '../github/testing/ship-rig.ts';
import { activatedHarness, advanced, enqueuedItem } from '../testing/board-world.ts';
import { post } from '../testing/commands.ts';
import {
  approvedWithFindings,
  gateWorld,
  greenChecks,
  type GateWorld,
} from '../testing/gate-world.ts';
import { kernelOn } from '../testing/kernel.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { screenProblems } from '../testing/screen-checks.ts';
import { getHtml } from '../testing/views.ts';
import { agentQueuesPath, gatePath, gatesPath, waitingPath } from './parts/paths.ts';

const signOff: Template = {
  key: 'sign-off',
  title: 'Sign-off',
  stages: [
    {
      key: 'sign_off',
      title: 'Sign-off',
      position: 10,
      bracket: 'build_package',
      agentPickup: 'allowed',
      exitGate: 'human_approval',
      connector: 'none',
      wipLimit: 3,
      validators: [],
      feeds: [],
    },
  ],
};

type SignOff = { readonly harnessId: string; readonly itemId: string };

async function parkedAtSignOff(world: GateWorld): Promise<SignOff> {
  const kernel = kernelOn(world.db, clock);
  const harnessId = await activatedHarness(kernel, world.rowan, signOff, 'sign-off');
  const itemId = await enqueuedItem(kernel, world.rowan, harnessId, 'Sign the release notes');
  await advanced(kernel, world.rowan, itemId, 1);
  await rewriteItem(world.db, itemId, { riskTier: 'high', riskDomains: ['ledger'] });
  return { harnessId, itemId };
}

async function documentOf(world: GateWorld, email: string, path: string): Promise<Document> {
  const page = await getHtml(world.db, email, path, {}, clock);
  return new JSDOM(page.text).window.document;
}

async function inGates(work: (world: GateWorld) => Promise<void>): Promise<void> {
  await withAppDatabase(async (db: Database) => work(await gateWorld(db)));
}

function rowTitles(document: Document): readonly string[] {
  return [...document.querySelectorAll('main tbody tr a[href*="/gates/"]')].map(
    (link) => link.textContent ?? '',
  );
}

function rowButtons(document: Document): readonly string[] {
  return [...document.querySelectorAll('main tbody tr button[name="decision"]')].map(
    (button) => button.textContent ?? '',
  );
}

function waitingTab(document: Document): Element | null {
  return document.querySelector('nav[aria-label="Views"] a[aria-current="page"]');
}

function rowFields(document: Document, itemId: string): Record<string, string> {
  const form = [...document.querySelectorAll('main form[data-command="decide"]')].find(
    (candidate) =>
      candidate.querySelector('input[name="itemId"]')?.getAttribute('value') === itemId,
  );
  return Object.fromEntries(
    [...(form?.querySelectorAll('input[name]') ?? [])].map((control) => [
      control.getAttribute('name') ?? '',
      (control as HTMLInputElement).value,
    ]),
  );
}

async function rejectedFindings(db: Database, itemId: string): Promise<unknown> {
  const rows = await db.$client`
    SELECT evidence FROM harness_events WHERE item_id = ${itemId} AND name = 'gate_rejected'`;
  return (rows[0]?.evidence as { findings?: unknown } | undefined)?.findings;
}

async function listsThisWorkflowOnly(world: GateWorld): Promise<void> {
  const other = await parkedAtSignOff(world);
  const here = await documentOf(world, world.rowanEmail, waitingPath(world.item.harnessId));
  expect(rowTitles(here)).toEqual([world.item.title]);
  expect(here.querySelector('main tbody tr a[href*="/gates/"]')?.getAttribute('href')).toBe(
    gatePath(world.item.harnessId, world.item.itemId),
  );
  const there = await documentOf(world, world.rowanEmail, waitingPath(other.harnessId));
  expect(rowTitles(there)).toEqual(['Sign the release notes']);
  expect(waitingTab(there)?.getAttribute('aria-label')).toBe('Waiting On You, 1 waiting');
}

async function approveLabels(world: GateWorld): Promise<void> {
  await greenChecks(world.db);
  await approvedWithFindings(world.db);
  const ship = await documentOf(world, world.kimEmail, waitingPath(world.item.harnessId));
  expect(rowButtons(ship)).toEqual(['Approve merge', 'Send back']);
  const other = await parkedAtSignOff(world);
  const plain = await documentOf(world, world.rowanEmail, waitingPath(other.harnessId));
  expect(rowButtons(plain)).toEqual(['Approve', 'Send back']);
}

async function decide(world: GateWorld, at: SignOff, decision: string, typed: object) {
  const before = await documentOf(world, world.rowanEmail, waitingPath(at.harnessId));
  const fields = { ...rowFields(before, at.itemId), ...typed };
  const body = commandBody(decision, fields, randomUUID());
  expect(body).not.toBeNull();
  const path = `/api/harness/${at.harnessId}/commands/${decision}`;
  return post(world.db, world.rowanEmail, path, body);
}

async function approvedFromRow(world: GateWorld): Promise<void> {
  const at = await parkedAtSignOff(world);
  const sent = await decide(world, at, 'approve', {});
  expect([sent.status, sent.body['status']]).toEqual([200, 'accepted']);
  expect(await decisionRows(world.db, { ...world.item, itemId: at.itemId })).toBe(1);
  const after = await documentOf(world, world.rowanEmail, waitingPath(at.harnessId));
  expect(rowTitles(after)).toEqual([]);
  expect(after.querySelector('main [role="note"]')?.textContent).toBe(
    'Nothing in this workflow is waiting for you to decide.',
  );
  expect(waitingTab(after)?.getAttribute('aria-label')).toBeNull();
}

async function sentBackWithReason(world: GateWorld): Promise<void> {
  const at = await parkedAtSignOff(world);
  const sent = await decide(world, at, 'reject', { findings: 'The notes miss the date' });
  expect([sent.status, sent.body['status']]).toEqual([200, 'accepted']);
  expect(await rejectedFindings(world.db, at.itemId)).toEqual(['The notes miss the date']);
}

async function viewerCannotDecide(world: GateWorld): Promise<void> {
  const viewer = await documentOf(world, world.viewerEmail, waitingPath(world.item.harnessId));
  expect(rowButtons(viewer)).toEqual([]);
  expect(viewer.querySelector('main [role="note"]')?.textContent).toBe(
    'Nothing in this workflow is waiting for you to decide.',
  );
  await rewriteItem(world.db, world.item.itemId, { riskTier: 'high', riskDomains: ['acl'] });
  const kim = await documentOf(world, world.kimEmail, waitingPath(world.item.harnessId));
  expect(rowTitles(kim)).toEqual([]);
  expect(rowButtons(kim)).toEqual([]);
}

async function strangerAndOldAddress(world: GateWorld): Promise<void> {
  const stranger = await getHtml(
    world.db,
    world.strangerEmail,
    waitingPath(world.item.harnessId),
    {},
    clock,
  );
  expect(stranger.status).toBe(404);
  const old = await getHtml(world.db, world.kimEmail, gatesPath(), {}, clock);
  expect([old.status, old.headers.get('location')]).toEqual([301, agentQueuesPath()]);
}

async function capOfThisWorkflowOnly(world: GateWorld): Promise<void> {
  const other = await parkedAtSignOff(world);
  await seedOpenItems(world.db, {
    harnessId: other.harnessId,
    stageKey: 'sign_off',
    count: VIEW_LIMIT,
    gateStatus: 'parked',
    priority: -1,
  });
  const here = await documentOf(world, world.rowanEmail, waitingPath(world.item.harnessId));
  expect(here.querySelector('main h1 + p')?.textContent).toBe(
    '1 gate is waiting for you to decide in this workflow',
  );
  expect(here.querySelector('main [role="note"]')).toBeNull();
  const there = await documentOf(world, world.rowanEmail, waitingPath(other.harnessId));
  expect(there.querySelector('main h1 + p')?.textContent).toMatch(/^At least /);
  expect(there.querySelector('main [role="note"]')?.textContent).toBe(
    'This workflow has at least 5,000 parked items. Gates are read from the 5,000 with the highest priority.',
  );
}

async function peekBesideTheList(world: GateWorld): Promise<void> {
  const { harnessId, itemId, title } = world.item;
  const path = `${waitingPath(harnessId)}?peek=${itemId}`;
  const page = await getHtml(world.db, world.kimEmail, path, {}, clock);
  expect(await screenProblems(page.text)).toEqual([]);
  const document = new JSDOM(page.text).window.document;
  const panel = document.querySelector(`main aside[data-peek="${itemId}"]`);
  expect(panel?.querySelector('h2')?.textContent).toBe(title);
  expect(panel?.querySelector('a[aria-label="Open full page"]')?.getAttribute('href')).toBe(
    gatePath(harnessId, itemId),
  );
  expect(panel?.querySelector('a[aria-label="Close panel"]')?.getAttribute('href')).toBe(
    waitingPath(harnessId),
  );
  const selected = document.querySelector('main tbody tr a[aria-current="true"]');
  expect(selected?.textContent).toBe(title);
  expect(rowButtons(document)).toEqual(['Approve merge', 'Send back']);
  const plain = await documentOf(world, world.kimEmail, waitingPath(harnessId));
  expect(plain.querySelector('main aside[data-peek]')).toBeNull();
}

async function noProblems(world: GateWorld): Promise<void> {
  for (const email of [world.kimEmail, world.viewerEmail]) {
    const page = await getHtml(world.db, email, waitingPath(world.item.harnessId), {}, clock);
    expect(await screenProblems(page.text)).toEqual([]);
  }
  const page = await documentOf(world, world.kimEmail, waitingPath(world.item.harnessId));
  const wrapper = page.querySelector('main table')?.parentElement?.getAttribute('class');
  expect(wrapper).toContain('overflow-x-auto');
}

describe.skipIf(!testServer)('the Waiting On You tab', () => {
  it('#106 lists the gates in this workflow the person may decide, and none from another', () =>
    inGates(listsThisWorkflowOnly));
  it('#106 offers Approve merge at a merge stage, Approve elsewhere, and Send back', () =>
    inGates(approveLabels));
  it('#106 approving from a row moves the item on and empties the tab', () =>
    inGates(approvedFromRow));
  it('#106 sending back with a reason records the reason as a finding', () =>
    inGates(sentBackWithReason));
  it('#106 a person without the grant sees no decide buttons', () => inGates(viewerCannotDecide));
  it('UI-7 a gate opens in a side panel beside the list from its address, without script', () =>
    inGates(peekBesideTheList));
  it('#106 a stranger gets not found, and the old Gates address moves to Agent Queues', () =>
    inGates(strangerAndOldAddress));
  it('#106 another workflow reaching the read limit does not mark this one as capped', () =>
    inGates(capOfThisWorkflowOnly));
  it('#106 the tab renders with no screen problems, its table scrolling in its own wrapper', () =>
    inGates(noProblems));
});
