import { randomUUID } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { rewriteItem, seedEventRows, seedPage, type SeedEventRow } from '@uw/db/test-seed';
import { clock } from '../github/testing/ship-rig.ts';
import { gateWorld, type GateWorld } from '../testing/gate-world.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { screenProblems } from '../testing/screen-checks.ts';
import { getHtml, getHtmlWithEnv } from '../testing/views.ts';
import { zulipEnv } from '../notify/testing.ts';
import { zulipTopicUrl } from '../notify/zulip/links.ts';
import { checksUrl, itemPath, pullRequestUrl, reviewUrl } from './parts/paths.ts';

const learningId = randomUUID();
const decisionId = randomUUID();
const runId = randomUUID();
const delegationId = randomUUID();
const seededAt = new Date('2026-10-02T08:40:00.000Z');
const lease = '2026-10-02T10:00:00.000Z';

type Played = GateWorld & { readonly device: string };

function rowOf(world: GateWorld, name: string, actor: string, evidence: object): SeedEventRow {
  return {
    id: randomUUID(),
    harnessId: world.item.harnessId,
    itemId: world.item.itemId,
    name,
    actor,
    evidence: { ...evidence },
    traceId: randomUUID(),
    at: seededAt,
  };
}

function step(costBasis: 'metered' | 'subscription', costs: object) {
  return {
    runId,
    step: 'work',
    tokensIn: 1200,
    tokensOut: 300,
    costBasis,
    leaseExpiresAt: lease,
    model: 'claude-sonnet-5',
    resolvedProvider: 'anthropic',
    toolsCalled: [],
    writes: 0,
    ...costs,
  };
}

function runRows(world: GateWorld, device: string): SeedEventRow[] {
  const started = {
    runId,
    persona: 'agent:builder',
    runShape: 'workflow-run',
    engine: 'claude-messages',
    model: 'claude-sonnet-5',
    delegationId: null,
  };
  return [
    rowOf(world, 'run_started', 'agent:builder', started),
    rowOf(
      world,
      'run_step_recorded',
      'agent:builder',
      step('metered', { costMinor: 40, computeMinor: 2 }),
    ),
    rowOf(
      world,
      'run_step_recorded',
      device,
      step('subscription', { costMinor: null, computeMinor: null }),
    ),
    rowOf(world, 'run_failed', 'agent:builder', {
      runId,
      step: 'work',
      why: 'retries_exhausted',
      detail: null,
    }),
  ];
}

function gateRows(world: GateWorld): SeedEventRow[] {
  const kim = world.kim.identity;
  return [
    rowOf(world, 'gate_rejected', kim, {
      decisionId,
      stage: 'ship',
      findings: ['Rename the lane'],
    }),
    rowOf(world, 'gate_overridden', kim, {
      decisionId,
      stage: 'ship',
      reason: 'The reviewer is down',
    }),
    rowOf(world, 'ship_refused', kim, {
      stage: 'ship',
      reasons: ['checks_not_green', 'pr_is_draft'],
    }),
  ];
}

function otherRows(world: GateWorld, device: string): SeedEventRow[] {
  const ian = world.ian.identity;
  const head = world.item.expectedHead;
  const granted = {
    delegationId,
    personId: world.ian.personId,
    persona: 'agent:builder',
    capability: 'build',
    expiresAt: lease,
    supersedes: null,
  };
  return [
    rowOf(world, 'lease_renewed', device, { leaseExpiresAt: lease }),
    rowOf(world, 'lease_expired', 'agent:system', { holder: device, leaseExpiresAt: lease }),
    rowOf(world, 'branch_abandoned', 'agent:system', { head }),
    rowOf(world, 'branch_adopted', device, { head }),
    rowOf(world, 'delegation_granted', ian, granted),
    rowOf(world, 'delegation_lapsed', 'agent:system', { delegationId, why: 'expired' }),
    rowOf(world, 'learning_attached', ian, { pageId: learningId }),
  ];
}

async function played(db: Database): Promise<Played> {
  const world = await gateWorld(db);
  const device = `agent:${world.ian.personId ?? ''}/laptop`;
  await seedPage(db, {
    id: learningId,
    type: 'learning',
    status: 'active',
    jdArea: '80-89',
    title: 'Leases lapse at night',
    bodyMd: '- [inferred] leases lapse at night',
    frontmatter: { confidence: 'inferred', as_of: '2026-09-01', supersedes: [], review_by: null },
    slug: 'play-leases-lapse',
  });
  await seedEventRows(db, [
    ...runRows(world, device),
    ...gateRows(world),
    ...otherRows(world, device),
  ]);
  return { ...world, device };
}

async function inPlay(work: (world: Played) => Promise<void>): Promise<void> {
  await withAppDatabase(async (db) => work(await played(db)));
}

function pathOf(world: GateWorld, after?: number): string {
  const path = itemPath(world.item.harnessId, world.item.itemId);
  return after === undefined ? path : `${path}?after=${after}`;
}

async function documentOf(world: GateWorld, path = pathOf(world), email = world.ianEmail) {
  return new JSDOM((await getHtml(world.db, email, path, {}, clock)).text).window.document;
}

function rowsNamed(document: Document, name: string): readonly Element[] {
  return [...document.querySelectorAll('main ol > li')].filter(
    (row) => row.querySelector('div > span')?.textContent === name,
  );
}

function factsOf(row: Element | undefined): Readonly<Record<string, string>> {
  const pairs = [...(row?.querySelectorAll('li') ?? [])].flatMap((item) => {
    const [label, value] = [...item.children];
    if (label?.tagName !== 'SPAN' || value === undefined) return [];
    return [[label.textContent ?? '', value.textContent ?? '']];
  });
  return Object.fromEntries(pairs);
}

async function inOrder(world: Played): Promise<void> {
  const document = await documentOf(world);
  const rows = [...document.querySelectorAll('main ol > li')];
  expect(rows.length).toBeGreaterThan(20);
  expect(rows[0]?.querySelector('div > span')?.textContent).toBe('Item created');
  const actors = rows.map((row) => row.querySelector('code')?.textContent);
  expect(actors).toContain(world.device);
  expect(actors).toContain(world.kim.identity);
  const device = rowsNamed(document, 'Lease renewed')[0];
  expect(device?.textContent).toContain('Own machine');
  expect(rowsNamed(document, 'Item created')[0]?.textContent).toContain('Person');
  expect(rowsNamed(document, 'Run started')[0]?.textContent).toContain('Platform');
}

async function runSteps(world: Played): Promise<void> {
  const document = await documentOf(world);
  const [metered, subscribed] = rowsNamed(document, 'Run step recorded');
  expect(factsOf(metered)).toEqual({
    Step: 'Work',
    Model: 'claude-sonnet-5',
    'Tokens in': '1,200',
    'Tokens out': '300',
    'Cost basis': 'Metered',
    Cost: '$0.42',
  });
  expect(factsOf(subscribed)['Cost basis']).toBe('Subscription');
  expect(subscribed?.textContent).not.toMatch(/\$/);
  expect(factsOf(rowsNamed(document, 'Run started')[0])).toMatchObject({
    Run: runId.slice(0, 8),
    Engine: 'claude-messages',
    Model: 'claude-sonnet-5',
  });
  expect(factsOf(rowsNamed(document, 'Run failed')[0])['Reason']).toBe('Retries exhausted');
}

async function gateEvents(world: Played): Promise<void> {
  const document = await documentOf(world);
  const rejected = rowsNamed(document, 'Gate rejected')[0];
  expect(factsOf(rejected)).toMatchObject({
    Decision: 'Rejected',
    'Decided by': world.kim.identity,
  });
  expect(rejected?.querySelector('ul + ul li')?.textContent).toBe('Rename the lane');
  expect(factsOf(rowsNamed(document, 'Gate overridden')[0])['Reason']).toBe('The reviewer is down');
  const refused = rowsNamed(document, 'Ship refused')[0];
  expect([...(refused?.querySelectorAll('ul + ul li') ?? [])].map((li) => li.textContent)).toEqual([
    'Checks not green',
    'Pr is draft',
  ]);
}

async function leaseBranchDelegation(world: Played): Promise<void> {
  const document = await documentOf(world);
  expect(factsOf(rowsNamed(document, 'Lease renewed')[0])['Lease until']).toBe(
    '2026-10-02 10:00 UTC',
  );
  expect(factsOf(rowsNamed(document, 'Lease expired')[0])['Holder']).toBe(world.device);
  const branch = factsOf(rowsNamed(document, 'Branch adopted')[0]);
  expect(branch['Branch']).toBe(`harness/${world.item.itemId}`);
  expect(factsOf(rowsNamed(document, 'Branch abandoned')[0])['Branch']).toBe(
    `harness/${world.item.itemId}`,
  );
  expect(factsOf(rowsNamed(document, 'Delegation granted')[0])).toEqual({
    Persona: 'agent:builder',
    Capability: 'Build',
    Expires: '2026-10-02 10:00 UTC',
  });
  expect(factsOf(rowsNamed(document, 'Delegation lapsed')[0])['Reason']).toBe('Expired');
}

async function learningLabel(world: Played): Promise<void> {
  const document = await documentOf(world);
  const row = rowsNamed(document, 'Learning attached')[0];
  expect(row?.textContent).toContain('inferred');
  expect(row?.textContent).toContain('Concluded from other evidence, not seen directly.');
}

async function links(world: Played): Promise<void> {
  const pull = world.item.pullRequest;
  if (pull === null) throw new Error('the item has no pull request');
  const document = await documentOf(world);
  const nav = document.querySelector('main nav[aria-label="Links for this item"]');
  const hrefs = [...(nav?.querySelectorAll('a') ?? [])].map((a) => [
    a.textContent,
    a.getAttribute('href'),
  ]);
  expect(hrefs).toEqual([
    ['Pull request', pullRequestUrl(pull)],
    ['Checks', checksUrl(pull)],
    ['Reviews', reviewUrl(pull)],
  ]);
  expect(nav?.textContent).toContain('No Zulip topic yet');
}

const channels = { '80-89': '80-89 Technology' };

async function zulipLink(world: Played): Promise<void> {
  const topic = 'software/uw-platform#42';
  const env = zulipEnv(channels);
  const before = await getHtmlWithEnv(world.db, world.ianEmail, pathOf(world), env, clock);
  const empty = new JSDOM(before.text).window.document.querySelector('main nav');
  expect(empty?.textContent).toContain('No Zulip topic yet');
  await rewriteItem(world.db, world.item.itemId, { zulipTopic: topic });
  const page = await getHtmlWithEnv(world.db, world.ianEmail, pathOf(world), env, clock);
  const document = new JSDOM(page.text).window.document;
  const link = [...document.querySelectorAll('main nav a')].find(
    (a) => a.textContent === 'Open the Zulip topic',
  );
  expect(link?.getAttribute('href')).toBe(
    zulipTopicUrl(env['ZULIP_SITE'] ?? '', '80-89 Technology', topic),
  );
  expect(await screenProblems(page.text)).toEqual([]);
}

async function zulipReply(world: Played): Promise<void> {
  await seedEventRows(world.db, [
    rowOf(world, 'comment_recorded', 'agent:ingest', {
      source: 'zulip',
      messageId: 41,
      topic: 'software/uw-platform#42',
      personId: null,
      email: 'reader@partner.example',
      text: '<b>approve</b> this',
      truncated: true,
    }),
  ]);
  const page = await getHtml(world.db, world.ianEmail, pathOf(world), {}, clock);
  const row = rowsNamed(new JSDOM(page.text).window.document, 'Comment recorded')[0];
  expect(factsOf(row)).toMatchObject({ Author: 'reader@partner.example', Source: 'Zulip' });
  expect(row?.querySelector('blockquote')?.textContent).toBe('<b>approve</b> this');
  expect(row?.querySelector('b')).toBeNull();
  expect(row?.textContent).toContain('Cut at 10,000 characters');
  expect(await screenProblems(page.text)).toEqual([]);
}

async function pages(world: Played): Promise<void> {
  const extra = Array.from({ length: 100 }, () =>
    rowOf(world, 'lease_renewed', world.device, { leaseExpiresAt: lease }),
  );
  await seedEventRows(world.db, extra);
  const first = await documentOf(world);
  expect(first.querySelectorAll('main ol > li')).toHaveLength(100);
  const later = [...first.querySelectorAll('main a')].find(
    (a) => a.textContent === 'Show later events',
  );
  const href = later?.getAttribute('href') ?? '';
  expect(href.startsWith(`${pathOf(world)}?after=`)).toBe(true);
  expect(href.slice(pathOf(world).length + 7)).toMatch(/^\d+$/);
  const rest = await documentOf(world, href);
  expect(rest.querySelectorAll('main ol > li').length).toBeGreaterThan(0);
  expect(rest.querySelector('main ol > li div > span')?.textContent).toBe('Lease renewed');
}

async function liveOnItem(world: Played): Promise<void> {
  const marker = (await documentOf(world)).querySelector('main [data-live]');
  expect(marker?.getAttribute('data-live-harness')).toBe(world.item.harnessId);
  expect(marker?.getAttribute('data-live-item')).toBe(world.item.itemId);
  expect(marker?.getAttribute('data-live-screen')).toBe('item');
  expect(Number(marker?.getAttribute('data-cursor'))).toBeGreaterThan(0);
}

async function hiddenIsMissing(world: Played): Promise<void> {
  const missing = itemPath(world.item.harnessId, randomUUID());
  const absent = await getHtml(world.db, world.strangerEmail, missing, {}, clock);
  const hidden = await getHtml(world.db, world.strangerEmail, pathOf(world), {}, clock);
  expect([absent.status, hidden.status]).toEqual([404, 404]);
  expect(hidden.text).toBe(absent.text);
}

async function holderLine(world: Played): Promise<void> {
  const document = await documentOf(world);
  const line = [...document.querySelectorAll('p')].find((entry) =>
    (entry.textContent ?? '').startsWith('Holder: '),
  );
  expect(line?.textContent).toBe('Holder: Waiting on a person to decide, for 0 min');
}

async function noProblems(world: Played): Promise<void> {
  const page = await getHtml(world.db, world.ianEmail, pathOf(world), {}, clock);
  expect(await screenProblems(page.text)).toEqual([]);
}

describe.skipIf(!testServer)('the play-by-play', () => {
  it('WB-8 the play-by-play lists every event on the item in order with the actor full identity', () =>
    inPlay(inOrder));
  it('WB-8 a run step shows model, tokens and cost basis, and a subscription step shows no dollar figure', () =>
    inPlay(runSteps));
  it('WB-8 gate events show decision, reason, evidence and actor', () => inPlay(gateEvents));
  it('WB-8 lease, branch and delegation events render', () => inPlay(leaseBranchDelegation));
  it('WB-8 an attached learning shows its evidence label with its definition', () =>
    inPlay(learningLabel));
  it('WB-8 links go to the pull request, its checks and its reviews, with a slot for the Zulip topic', () =>
    inPlay(links));
  it('NT-3 the play-by-play links the item Zulip topic in its area channel', () =>
    inPlay(zulipLink));
  it('NT-3 a reply appears on the play-by-play with its author', () => inPlay(zulipReply));
  it('WB-8 the play-by-play reads 100 events at a time and links to the later ones', () =>
    inPlay(pages));
  it('WB-8 the play-by-play is live on its harness filtered to the item', () => inPlay(liveOnItem));
  it('a hidden item play-by-play renders the same not-found page as a missing one', () =>
    inPlay(hiddenIsMissing));
  it('OB-2 the item screen names who holds the ball', () => inPlay(holderLine));
  it('the play-by-play renders with no screen problems', () => inPlay(noProblems));
});
