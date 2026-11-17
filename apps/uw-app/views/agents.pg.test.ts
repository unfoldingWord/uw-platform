import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import {
  accepted,
  callerOf,
  command,
  rowan,
  softwareHarness,
  type Scene,
} from '../testing/commands.ts';
import { kernelOn } from '../testing/kernel.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { screenProblems } from '../testing/screen-checks.ts';
import { getHtml, postForm } from '../testing/views.ts';

const ROWAN = 'rowan.test@unfoldingword.org';
const ORIGIN = { origin: 'http://localhost' };

function documentOf(text: string): Document {
  return new JSDOM(text).window.document;
}

const agentsOf = (harnessId: string) => `/harnesses/${harnessId}/agents`;
const newAgentOf = (harnessId: string) => `${agentsOf(harnessId)}/new`;

function addForm(name: string, pageId = randomUUID(), template = 'reviewer'): URLSearchParams {
  return new URLSearchParams({ template, name, model: '', pageId });
}

async function pageRow(db: Database, pageId: string) {
  const rows = await db.execute<{
    status: string;
    version: number;
    identity: string;
    engine: string;
    model: string;
    budget: number;
    body: string;
  }>(
    sql`SELECT status, version, frontmatter->>'identity' AS identity, frontmatter->>'engine' AS engine,
      frontmatter->>'model' AS model, (frontmatter->'budget'->>'monthly_minor')::int AS budget,
      body_md AS body FROM pages WHERE id = ${pageId}`,
  );
  return rows[0];
}

async function added(db: Database, made: Scene, name = 'Scout'): Promise<string> {
  const pageId = randomUUID();
  const sent = await postForm(db, ROWAN, newAgentOf(made.harnessId), addForm(name, pageId), ORIGIN);
  expect(sent.status).toBe(303);
  return pageId;
}

async function adminAddsAnAgent(db: Database): Promise<void> {
  const made = await softwareHarness(db);
  const list = documentOf((await getHtml(db, ROWAN, agentsOf(made.harnessId))).text);
  expect(list.querySelector('main h1')?.textContent).toBe('software');
  expect(list.querySelector(`a[href="${newAgentOf(made.harnessId)}"]`)?.textContent).toBe(
    'Add an agent',
  );
  expect(list.querySelector('[aria-current="page"]')?.textContent).toContain('Agents');
  const form = await getHtml(db, ROWAN, newAgentOf(made.harnessId));
  expect(form.status).toBe(200);
  const pageId = randomUUID();
  const sent = await postForm(
    db,
    ROWAN,
    newAgentOf(made.harnessId),
    addForm('Scout', pageId),
    ORIGIN,
  );
  expect(sent.status).toBe(303);
  expect(sent.headers.get('location')).toBe(`/personas/${pageId}`);
  expect(await pageRow(db, pageId)).toMatchObject({
    status: 'suggested',
    identity: 'agent:scout-software',
  });
  const again = await postForm(
    db,
    ROWAN,
    newAgentOf(made.harnessId),
    addForm('Scout', pageId),
    ORIGIN,
  );
  expect(again.status).toBe(303);
  const twin = await postForm(db, ROWAN, newAgentOf(made.harnessId), addForm('Scout'), ORIGIN);
  expect(twin.status).toBe(200);
  expect(twin.text).toContain('An agent with this name already exists in this area.');
  const after = documentOf((await getHtml(db, ROWAN, agentsOf(made.harnessId))).text);
  const rows = [...(after.querySelectorAll('main table')[0]?.querySelectorAll('tbody tr') ?? [])];
  expect(rows.map((row) => row.textContent)).toEqual([expect.stringContaining('Not live yet')]);
}

async function memberOnlyLooks(db: Database): Promise<void> {
  const made = await softwareHarness(db);
  const pageId = await added(db, made);
  const list = await getHtml(db, made.editor.email, agentsOf(made.harnessId));
  expect(list.status).toBe(200);
  const document = documentOf(list.text);
  expect(document.querySelector(`a[href="${newAgentOf(made.harnessId)}"]`)).toBeNull();
  expect(document.body.textContent).toContain('Only admins of area 80-89 can add agents');
  expect(document.querySelector('form[data-command="schedule_regular_tweak"]')).toBeNull();
  const form = await getHtml(db, made.editor.email, newAgentOf(made.harnessId));
  expect(form.status).toBe(200);
  expect(form.text).toContain('Only an admin of this area can add an agent.');
  const tried = await postForm(
    db,
    made.editor.email,
    newAgentOf(made.harnessId),
    addForm('Mine'),
    ORIGIN,
  );
  expect(tried.status).toBe(200);
  expect(tried.text).toContain('Only an admin of this area can add an agent.');
  const card = documentOf((await getHtml(db, made.editor.email, `/personas/${pageId}`)).text);
  expect(card.querySelector('form fieldset')?.hasAttribute('disabled')).toBe(true);
  expect(card.body.textContent).toContain('Only admins of area 80-89 can change an agent.');
  const outsider = await getHtml(db, made.stranger.email, agentsOf(made.harnessId));
  expect(outsider.status).toBe(404);
}

async function liveScout(db: Database, made: Scene): Promise<string> {
  const pageId = await added(db, made);
  const activated = await command(db, { email: ROWAN }, made.harnessId, 'activate_persona', {
    requestId: randomUUID(),
    pageId,
    expectedVersion: 1,
  });
  expect(activated.body['status']).toBe('accepted');
  return pageId;
}

async function reachOf(db: Database, harnessId: string) {
  const kernel = kernelOn(db, { now: () => new Date() });
  const view = accepted(await kernel.views.agents(callerOf(await rowan(db)), { harnessId }));
  return { view, scout: view.agents.find((agent) => agent.title === 'Scout')?.reach };
}

async function grantsShowsReachAndRevokes(db: Database): Promise<void> {
  const made = await softwareHarness(db);
  const { harnessId } = made;
  await liveScout(db, made);
  const kernel = kernelOn(db, { now: () => new Date() });
  const change = { agentPickup: 'allowed' as const, bracket: 'build_package' as const };
  accepted(
    await kernel.stages.updateStage(callerOf(await rowan(db)), {
      harnessId,
      stageKey: 'package',
      change,
    }),
  );
  expect((await reachOf(db, harnessId)).scout).toEqual([]);
  const granted = await command(db, { email: ROWAN }, harnessId, 'schedule_regular_tweak', {
    requestId: randomUUID(),
    persona: 'agent:scout-software',
    capability: 'review',
    expiresAt: null,
    supersedes: null,
    maxTier: null,
  });
  expect(granted.body['status']).toBe('accepted');
  const { view, scout } = await reachOf(db, harnessId);
  expect(scout).toContain('package');
  const closed = view.stages.filter((stage) => stage.agentPickup === 'none');
  for (const stage of closed) expect(scout).not.toContain(stage.key);
  expect(view.permissions).toHaveLength(1);
  expect(view.permissions[0]).toMatchObject({ agentTitle: 'Scout', capability: 'review' });
  const page = documentOf((await getHtml(db, ROWAN, agentsOf(harnessId))).text);
  expect(page.querySelectorAll('form[data-command="revoke_delegation"]')).toHaveLength(1);
  expect(page.querySelectorAll('[aria-label="Can work here"]').length).toBe(scout?.length);
  const delegationId = view.permissions[0]?.id ?? '';
  const revoked = await command(db, { email: ROWAN }, harnessId, 'revoke_delegation', {
    requestId: randomUUID(),
    delegationId,
  });
  expect(revoked.body['status']).toBe('accepted');
  const after = await reachOf(db, harnessId);
  expect(after.scout).toEqual([]);
  expect(after.view.permissions).toEqual([]);
}

async function jobCardShowsLocksAndChecks(db: Database): Promise<void> {
  const made = await softwareHarness(db);
  const pageId = await added(db, made);
  const document = documentOf((await getHtml(db, ROWAN, `/personas/${pageId}`)).text);
  const named = (name: string) => document.querySelector(`input[name="verb"][value="${name}"]`);
  expect(named('approve')).toBeNull();
  expect(named('list_gifts')).toBeNull();
  expect(named('read_page')?.hasAttribute('checked')).toBe(true);
  expect(document.body.textContent).toContain('Locked: never available to any agent.');
  expect(document.body.textContent).toContain("Not available yet: its module isn't built.");
  const checks = [...document.querySelectorAll('[data-check]')];
  expect(
    checks.map((check) => [check.getAttribute('data-check'), check.getAttribute('data-passed')]),
  ).toEqual([
    ['actions_exist', 'true'],
    ['nothing_forbidden', 'true'],
    ['owner_permitted', 'true'],
    ['engine_available', 'true'],
    ['practice_run', 'true'],
  ]);
  expect(document.querySelector('form[data-command="activate_persona"]')).not.toBeNull();
}

async function savesTheWholeCardAndRetires(db: Database): Promise<void> {
  const made = await softwareHarness(db);
  const pageId = await liveScout(db, made);
  const before = await pageRow(db, pageId);
  const form = new URLSearchParams({
    expectedVersion: String(before?.version),
    requestId: randomUUID(),
    run_shape: 'workflow-run',
    engine: 'claude-messages',
    model: 'claude-sonnet-5',
    budget: '12.50',
    bodyMd: (before?.body ?? '').replace(/\n/g, '\r\n'),
  });
  for (const verb of ['read_page', 'poll_queue', 'claim_item', 'submit_to_gate']) {
    form.append('verb', verb);
  }
  const saved = await postForm(db, ROWAN, `/personas/${pageId}/toolset`, form, ORIGIN);
  expect(saved.text).toContain('Saved. The checks below have run again.');
  expect(await pageRow(db, pageId)).toMatchObject({
    status: 'suggested',
    engine: 'claude-messages',
    model: 'claude-sonnet-5',
    budget: 1250,
    body: before?.body,
  });
  const shown = documentOf(saved.text);
  expect(shown.querySelector('[data-check="practice_run"]')?.getAttribute('data-passed')).toBe(
    'true',
  );
  const version = (await pageRow(db, pageId))?.version ?? 0;
  const retire = new URLSearchParams({
    expectedVersion: String(version),
    requestId: randomUUID(),
    retire: 'retire',
  });
  const retired = await postForm(db, ROWAN, `/personas/${pageId}/toolset`, retire, ORIGIN);
  expect(retired.status).toBe(200);
  expect((await pageRow(db, pageId))?.status).toBe('retired');
  const list = documentOf((await getHtml(db, ROWAN, agentsOf(made.harnessId))).text);
  expect(list.body.textContent).toContain('Retired');
}

async function rendersCleanly(db: Database): Promise<void> {
  const made = await softwareHarness(db);
  await added(db, made);
  for (const path of [agentsOf(made.harnessId), newAgentOf(made.harnessId)]) {
    const page = await getHtml(db, ROWAN, path);
    expect(page.status).toBe(200);
    expect(await screenProblems(page.text)).toEqual([]);
  }
}

describe.skipIf(!testServer)('#110 the Agents tab', () => {
  it('an area admin adds an agent from a template, and it lands on its page not yet live', () =>
    withAppDatabase(adminAddsAnAgent));
  it('someone who is not an area admin can look but not add, grant or change', () =>
    withAppDatabase(memberOnlyLooks));
  it('a standing permission shows who granted it and where the agent can work, until it is revoked', () =>
    withAppDatabase(grantsShowsReachAndRevokes));
  it('the job card locks the forbidden actions, marks the unbuilt ones and shows all five checks', () =>
    withAppDatabase(jobCardShowsLocksAndChecks));
  it('saving the job card changes engine, model, budget and actions, re-runs the checks, and Retire retires it', () =>
    withAppDatabase(savesTheWholeCardAndRetires));
  it('the Agents and New Agent pages render cleanly', () => withAppDatabase(rendersCleanly));
});
