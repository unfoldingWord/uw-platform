import { randomUUID } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import {
  revokeSeededGrant,
  rewriteItem,
  seedGrant,
  seedOpenItems,
  seedPerson,
} from '@uw/db/test-seed';
import { VIEW_LIMIT, software, type Template } from '@uw/harness';
import { commandBody } from '../islands/browser/command-body.ts';
import { clock, decisionRows } from '../github/testing/ship-rig.ts';
import { activatedHarness, advanced, enqueuedItem } from '../testing/board-world.ts';
import { accepted, callerOf, post } from '../testing/commands.ts';
import {
  approvedWithFindings,
  gateWorld,
  greenChecks,
  recordedRisk,
  type GateWorld,
} from '../testing/gate-world.ts';
import { kernelOn } from '../testing/kernel.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { screenProblems } from '../testing/screen-checks.ts';
import { getHtml } from '../testing/views.ts';
import { gatePath, gatesPath, itemPath } from './parts/paths.ts';

function pageOf(world: GateWorld, email: string, path: string) {
  return getHtml(world.db, email, path, {}, clock);
}

async function documentOf(world: GateWorld, email: string, path: string): Promise<Document> {
  return new JSDOM((await pageOf(world, email, path)).text).window.document;
}

function deepLink(world: GateWorld): string {
  return gatePath(world.item.harnessId, world.item.itemId);
}

async function inGates(work: (world: GateWorld) => Promise<void>): Promise<void> {
  await withAppDatabase(async (db: Database) => work(await gateWorld(db)));
}

function buttons(document: Document): readonly (readonly [string, string | null])[] {
  return [...document.querySelectorAll('main button[name="decision"]')].map((button) => {
    const described = button.getAttribute('aria-describedby');
    const reason = described === null ? null : document.getElementById(described)?.textContent;
    return [button.textContent ?? '', reason ?? null] as const;
  });
}

function shipRows(document: Document): Readonly<Record<string, string>> {
  const table = [...document.querySelectorAll('main table')].find(
    (candidate) => candidate.querySelector('caption')?.textContent === 'Ship rule inputs',
  );
  const rows = [...(table?.querySelectorAll('tbody tr') ?? [])].map((row) => {
    const [input, value] = [...row.querySelectorAll('td')].map((cell) => cell.textContent ?? '');
    return [input ?? '', value ?? ''];
  });
  return Object.fromEntries(rows);
}

async function onlyDecidable(world: GateWorld): Promise<void> {
  const mine = await documentOf(world, world.kimEmail, gatesPath());
  expect(mine.querySelector('main h1 + p')?.textContent).toBe(
    '1 gate is waiting for you to decide',
  );
  expect(mine.querySelector('main a[href*="/gates/"]')?.getAttribute('href')).toBe(deepLink(world));
  const viewer = await documentOf(world, world.viewerEmail, gatesPath());
  expect(viewer.querySelector('main [role="note"]')?.textContent).toBe(
    'No gate is waiting for you to decide.',
  );
  await rewriteItem(world.db, world.item.itemId, { riskTier: 'high', riskDomains: ['acl'] });
  const high = await documentOf(world, world.kimEmail, gatesPath());
  expect(high.querySelectorAll('main button[name="decision"]')).toHaveLength(0);
}

async function shipInputs(world: GateWorld): Promise<void> {
  await greenChecks(world.db);
  await approvedWithFindings(world.db);
  const document = await documentOf(world, world.kimEmail, gatesPath());
  const rows = shipRows(document);
  expect(rows['Pull request']).toMatch(/^Open, head c0ffee0+$/);
  expect(rows['Expected head']).toBe(world.item.expectedHead);
  expect(rows['lint']).toBe('Success');
  expect(rows['uw-reviewer']).toBe('Approved by provider anthropic');
  expect(rows['Ship rule']).toBe('Advance');
  expect([rows['Risk tier'], rows['Risk domains'], rows['Area']]).toEqual([
    'standard',
    'None',
    '80-89',
  ]);
  expect(rows['Evaluated at']).toBe('2026-10-02 09:00 UTC');
  const findings = [...document.querySelectorAll('main h3 + ul li ul li')].map(
    (item) => item.textContent,
  );
  expect(findings).toEqual(['Real: The lease is not renewed', 'Theoretical: A typo in the copy']);
  expect(document.body.textContent).toContain('uw-reviewer (anthropic): Approved');
}

function factsOf(document: Document): Readonly<Record<string, string>> {
  const terms = [...document.querySelectorAll('main section dl dt')];
  return Object.fromEntries(
    terms.map((term) => [term.textContent ?? '', term.nextElementSibling?.textContent ?? '']),
  );
}

async function gateFacts(world: GateWorld): Promise<void> {
  await greenChecks(world.db);
  await approvedWithFindings(world.db);
  await recordedRisk(world.db, world.item, world.ian.identity);
  const document = await documentOf(world, world.kimEmail, deepLink(world));
  const facts = factsOf(document);
  expect(facts).toMatchObject({
    'Declared tier': 'standard',
    Closes: 'None',
    'Review providers': 'anthropic',
    'You approve head': world.item.expectedHead ?? '',
  });
  expect(facts['Tier recorded']).toBe(`standard at ${world.item.expectedHead ?? ''}`);
  expect(facts['Tier derived now']).toBe(`standard at ${world.item.expectedHead ?? ''}`);
  const form = document.querySelector('main form[data-command="decide"]');
  expect(form?.querySelector('input[name="head"]')?.getAttribute('value')).toBe(
    world.item.expectedHead,
  );
}

async function approveFollowsShipRule(world: GateWorld): Promise<void> {
  const refused = buttons(await documentOf(world, world.kimEmail, deepLink(world)));
  expect(refused[0]?.[0]).toBe('Approve');
  expect(refused[0]?.[1]).toBe('No reviewer approval, Required check never ran');
  await greenChecks(world.db);
  await approvedWithFindings(world.db);
  const ready = buttons(await documentOf(world, world.kimEmail, deepLink(world)));
  expect(ready[0]).toEqual(['Approve', null]);
}

async function overrideAndOthers(world: GateWorld): Promise<void> {
  await greenChecks(world.db);
  expect(buttons(await documentOf(world, world.kimEmail, deepLink(world)))).toEqual([
    ['Approve', 'No reviewer approval'],
    ['Reject', null],
    ['Take over', null],
    ['Override', null],
  ]);
}

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

async function parkedAtSignOff(world: GateWorld): Promise<{ harnessId: string; itemId: string }> {
  const kernel = kernelOn(world.db, clock);
  const harnessId = await activatedHarness(kernel, world.ian, signOff, 'sign-off');
  const itemId = await enqueuedItem(kernel, world.ian, harnessId, 'Sign the release notes');
  await advanced(kernel, world.ian, itemId, 1);
  await rewriteItem(world.db, itemId, { riskTier: 'high', riskDomains: ['ledger'] });
  return { harnessId, itemId };
}

async function revokedAfterLoad(world: GateWorld): Promise<void> {
  const grantId = randomUUID();
  await seedGrant(world.db, {
    id: grantId,
    personId: world.kim.personId ?? '',
    role: 'admin',
    scopeKind: 'jd_area',
    scopeArea: '20-29',
    grantedAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: null,
  });
  const { harnessId, itemId } = await parkedAtSignOff(world);
  const html = await getHtml(world.db, world.kimEmail, gatePath(harnessId, itemId));
  const document = new JSDOM(html.text).window.document;
  expect(buttons(document)[0]).toEqual(['Approve', null]);
  const form = document.querySelector('main form[data-command="decide"]');
  const fields = Object.fromEntries(
    [...(form?.querySelectorAll('input[name], textarea[name]') ?? [])].map((control) => [
      control.getAttribute('name') ?? '',
      (control as HTMLInputElement).value,
    ]),
  );
  await revokeSeededGrant(world.db, grantId, new Date(Date.now() - 1000));
  const body = commandBody('approve', fields, randomUUID());
  const sent = await post(
    world.db,
    world.kimEmail,
    `/api/harness/${harnessId}/commands/approve`,
    body,
  );
  expect(sent.body['reason']).toBe('approver_lacks_domain_grant');
  expect(await decisionRows(world.db, { ...world.item, itemId })).toBe(0);
}

function formFields(document: Document): Record<string, string> {
  const form = document.querySelector('main form[data-command="decide"]');
  return Object.fromEntries(
    [...(form?.querySelectorAll('input[name], textarea[name]') ?? [])].map((control) => [
      control.getAttribute('name') ?? '',
      (control as HTMLInputElement).value,
    ]),
  );
}

const typed: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  reject: { findings: 'The release notes miss the date' },
  take_over: {},
  override: { reason: 'The reviewer is down and the notes are urgent' },
};

async function decidedFromForm(world: GateWorld, decision: string): Promise<void> {
  const { harnessId, itemId } = await parkedAtSignOff(world);
  const path = gatePath(harnessId, itemId);
  const before = await documentOf(world, world.ianEmail, path);
  const named = [...before.querySelectorAll('main button[name="decision"]')].map((button) =>
    button.getAttribute('value'),
  );
  expect(named).toContain(decision);
  const fields = { ...formFields(before), ...typed[decision] };
  const body = commandBody(decision, fields, randomUUID());
  expect(body).not.toBeNull();
  const sent = await post(
    world.db,
    world.ianEmail,
    `/api/harness/${harnessId}/commands/${decision}`,
    body,
  );
  expect([decision, sent.status, sent.body['status']]).toEqual([decision, 200, 'accepted']);
  expect(await decisionRows(world.db, { ...world.item, itemId })).toBe(1);
  const after = await documentOf(world, world.ianEmail, path);
  expect(after.querySelectorAll('main button[name="decision"]')).toHaveLength(0);
  expect(after.querySelector('main [role="note"]')?.textContent).toBe('This gate has been decided');
}

async function kindleOnButtons(world: GateWorld): Promise<void> {
  const document = await documentOf(world, world.kimEmail, gatesPath());
  const kindled = [...document.querySelectorAll('main [class*="kindle"]')];
  expect(kindled.map((element) => [element.tagName, element.getAttribute('name')])).toEqual([
    ['BUTTON', 'decision'],
    ['BUTTON', 'decision'],
    ['BUTTON', 'decision'],
    ['BUTTON', 'decision'],
  ]);
}

async function stableDeepLink(world: GateWorld): Promise<void> {
  const list = await documentOf(world, world.kimEmail, gatesPath());
  const one = await documentOf(world, world.kimEmail, deepLink(world));
  const panel = (document: Document) => document.querySelector('main section')?.outerHTML;
  expect(panel(one)).toBe(panel(list));
  expect(
    one.querySelector('main a[href$="/items/' + world.item.itemId + '"]')?.getAttribute('href'),
  ).toBe(itemPath(world.item.harnessId, world.item.itemId));
}

async function viewerRefused(world: GateWorld): Promise<void> {
  const document = await documentOf(world, world.viewerEmail, deepLink(world));
  expect(buttons(document)).toEqual([
    ['Approve', 'Not permitted'],
    ['Reject', 'Not permitted'],
    ['Take over', 'Not permitted'],
    ['Override', 'Not permitted'],
  ]);
  expect(shipRows(document)['Area']).toBe('80-89');
}

async function phoneWidth(world: GateWorld): Promise<void> {
  for (const path of [gatesPath(), deepLink(world)]) {
    const page = await pageOf(world, world.kimEmail, path);
    const document = new JSDOM(page.text).window.document;
    const stack = document.querySelector('main section .flex-col.md\\:flex-row');
    expect(stack).not.toBeNull();
    const table = document.querySelector('main table');
    expect(table?.parentElement?.getAttribute('class')).toContain('overflow-x-auto');
    const controls = document.querySelector('main button[name="decision"]')?.closest('.flex-wrap');
    expect(controls).not.toBeNull();
    expect(await screenProblems(page.text)).toEqual([]);
  }
}

async function liveFromCursor(world: GateWorld): Promise<void> {
  const document = await documentOf(world, world.kimEmail, deepLink(world));
  const marker = document.querySelector('main [data-live]');
  const kernel = kernelOn(world.db, clock);
  const cursor = await kernel.views.cursor(callerOf(world.kim), {
    harnessId: world.item.harnessId,
  });
  expect(marker?.getAttribute('data-live-harness')).toBe(world.item.harnessId);
  expect(marker?.getAttribute('data-live-screen')).toBe('gates');
  expect(marker?.getAttribute('data-cursor')).toBe(String(cursor));
  expect(cursor).toBeGreaterThan(0);
  expect(marker?.getAttribute('data-refresh-every')).toBe('60000');
}

async function hiddenIsMissing(world: GateWorld): Promise<void> {
  const missing = gatePath(world.item.harnessId, '00000000-0000-4000-8000-00000000dead');
  const absent = await pageOf(world, world.strangerEmail, missing);
  const hidden = await pageOf(world, world.strangerEmail, deepLink(world));
  const elsewhere = await pageOf(
    world,
    world.strangerEmail,
    gatePath(randomUUID(), world.item.itemId),
  );
  expect([absent.status, hidden.status, elsewhere.status]).toEqual([404, 404, 404]);
  expect(hidden.text).toBe(absent.text);
  expect(elsewhere.text).toBe(absent.text);
}

async function editorOn80s(world: GateWorld): Promise<string> {
  const id = randomUUID();
  const email = 'gate-editor@unfoldingword.org';
  await seedPerson(world.db, { id, email });
  await seedGrant(world.db, {
    id: randomUUID(),
    personId: id,
    role: 'editor',
    scopeKind: 'jd_area',
    scopeArea: '80-89',
    grantedAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: null,
  });
  return email;
}

const notWaiting = 'This item is not waiting at a gate a person decides';

async function noDecideControls(world: GateWorld, email: string, path: string): Promise<void> {
  const document = await documentOf(world, email, path);
  expect(document.querySelector('main form[data-command="decide"]')).toBeNull();
  expect(document.querySelectorAll('main button[name="decision"]')).toHaveLength(0);
  expect(document.querySelectorAll('main [class*="kindle"]')).toHaveLength(0);
  expect(document.querySelector('main [role="note"]')?.textContent).toBe(notWaiting);
}

async function notAtPersonGate(world: GateWorld): Promise<void> {
  const kernel = kernelOn(world.db, clock);
  const harnessId = await activatedHarness(kernel, world.ian, software, 'software-backlog');
  const itemId = await enqueuedItem(kernel, world.ian, harnessId, 'Parked at the backlog');
  await rewriteItem(world.db, itemId, { gateStatus: 'parked' });
  const editorEmail = await editorOn80s(world);
  for (const email of [world.ianEmail, editorEmail, world.viewerEmail]) {
    await noDecideControls(world, email, gatePath(harnessId, itemId));
  }
  const other = await enqueuedItem(kernel, world.ian, harnessId, 'Still in the backlog');
  accepted(await kernel.items.claim(callerOf(world.ian), { itemId: other, delegationId: null }));
  for (const email of [world.ianEmail, editorEmail, world.viewerEmail]) {
    await noDecideControls(world, email, gatePath(harnessId, other));
  }
}

async function decidedGate(world: GateWorld): Promise<void> {
  const { harnessId, itemId } = await parkedAtSignOff(world);
  const kernel = kernelOn(world.db, clock);
  const decision = {
    itemId,
    decision: 'approve' as const,
    reason: null,
    findings: [],
    seenHead: null,
  };
  accepted(await kernel.gates.decide(callerOf(world.ian), decision));
  const document = await documentOf(world, world.ianEmail, gatePath(harnessId, itemId));
  expect(document.querySelectorAll('main button[name="decision"]')).toHaveLength(0);
  expect(document.querySelector('main [role="note"]')?.textContent).toBe(
    'This gate has been decided',
  );
}

async function parkedCapSaysAtLeast(world: GateWorld): Promise<void> {
  await seedOpenItems(world.db, {
    harnessId: world.item.harnessId,
    stageKey: 'build',
    count: VIEW_LIMIT,
    gateStatus: 'parked',
    priority: -1,
  });
  const document = await documentOf(world, world.kimEmail, gatesPath());
  expect(document.querySelector('main h1 + p')?.textContent).toBe(
    'At least 1 gate is waiting for you to decide',
  );
  expect(document.querySelector('main [role="note"]')?.textContent).toBe(
    'A harness has at least 5,000 parked items. Gates are read from the 5,000 with the highest priority on each harness.',
  );
}

function approveAllForms(document: Document): readonly (string | null)[] {
  const forms = [...document.querySelectorAll('main form[data-command="decide_gates"]')];
  return forms.map(
    (form) => form.querySelector('input[name="entries"]')?.getAttribute('value') ?? null,
  );
}

async function approveAllShown(world: GateWorld): Promise<void> {
  expect(approveAllForms(await documentOf(world, world.kimEmail, gatesPath()))).toEqual([]);
  await greenChecks(world.db);
  await approvedWithFindings(world.db);
  const document = await documentOf(world, world.kimEmail, gatesPath());
  expect(approveAllForms(document)).toEqual([
    `${world.item.itemId}:${world.item.expectedHead ?? ''}`,
  ]);
  const button = document.querySelector('main form[data-command="decide_gates"] button');
  expect(button?.textContent).toMatch(/^Approve the 1 gate shown on /);
  expect(button?.getAttribute('class')).toContain('bg-kindle');
  expect(await screenProblems((await pageOf(world, world.kimEmail, gatesPath())).text)).toEqual([]);
  expect(approveAllForms(await documentOf(world, world.viewerEmail, gatesPath()))).toEqual([]);
}

async function noProblems(world: GateWorld): Promise<void> {
  for (const email of [world.kimEmail, world.viewerEmail]) {
    for (const path of [gatesPath(), deepLink(world)]) {
      expect(await screenProblems((await pageOf(world, email, path)).text)).toEqual([]);
    }
  }
}

describe.skipIf(!testServer)('the Gates view and its deep link', () => {
  it('WB-6 the gates view lists only the gates the person can decide', () =>
    inGates(onlyDecidable));
  it('GD-1 the Gates view offers approve all shown over the gates whose ship rule advances', () =>
    inGates(approveAllShown));
  it('WB-6 each gate shows every ship-rule input with its current value from GitHub facts, the tier and domains, and the Reviewer findings', () =>
    inGates(shipInputs));
  it('WB-6 the gate facts show the parsed declaration, the recorded tier with its head, the tier derived now, the review providers and the head you approve', () =>
    inGates(gateFacts));
  it('WB-6 approve is enabled only when the ship rule advances; otherwise its closed reasons sit beside the refused button', () =>
    inGates(approveFollowsShipRule));
  it('WB-6 override is enabled when only no_reviewer_approval fails; reject and take over are enabled', () =>
    inGates(overrideAndOthers));
  it('WB-6 a decision posted from the gate form refuses with approver_lacks_domain_grant after the grant was revoked, and records nothing', () =>
    inGates(revokedAfterLoad));
  it('WB-6 Kindle marks the four human buttons and nothing else on the gates view', () =>
    inGates(kindleOnButtons));
  it('WB-6 each gate has a stable deep link that renders the same panel', () =>
    inGates(stableDeepLink));
  it('WB-6 a viewer opening the deep link sees the facts with every decision refused not_permitted', () =>
    inGates(viewerRefused));
  it.each(['reject', 'take_over', 'override'])(
    'WB-6 %s posted from the rendered gate form issues the gate command and the gate shows its outcome',
    (decision) => inGates((world) => decidedFromForm(world, decision)),
  );
  it('WB-7 the Gates view and a gate deep link stack below md, their tables scroll in their own wrapper, their controls wrap and nothing sets a fixed width', () =>
    inGates(phoneWidth));
  it('WB-7 a gate deep link is live from the latest event cursor and refreshes every minute', () =>
    inGates(liveFromCursor));
  it('a hidden item deep link renders the same not-found page as a missing one', () =>
    inGates(hiddenIsMissing));
  it('WB-6 an item that is not parked at a stage a person decides shows no decide controls to an admin, an editor or a viewer', () =>
    inGates(notAtPersonGate));
  it('a gate deep link says the gate has been decided only once a decision is recorded', () =>
    inGates(decidedGate));
  it('the gates view says at least when a harness has more parked items than it reads', () =>
    inGates(parkedCapSaysAtLeast));
  it('the gates view and a gate render with no screen problems', () => inGates(noProblems));
});
