import { closeEmbeddedTemplate } from '@uw/db/embedded';
import type { KernelOutcome } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { assistantLog, grantedScene, type AssistantScene } from '../assistant-fixtures.ts';
import {
  decide,
  expireDue,
  proposalOf,
  proposeEmail,
  proposeInvite,
  proposePageAppend,
  seedNotesPage,
} from '../assistant-proposal-fixtures.ts';
import { DAY_MS, closeTurn, openTurn } from '../assistant-reminder-fixtures.ts';
import { simPerson } from '../fixtures.ts';
import { value } from '../runs.ts';
import { personOf } from '../wakes.ts';
import { createWorld, simAppOrigin } from '../world.ts';

afterAll(closeEmbeddedTemplate);

const notesPage = '00000000-0000-4000-8000-000000013001';
const foreignPage = '00000000-0000-4000-8000-000000013002';
const mail = { to: ['ben@example.org'], subject: 'Meeting notes', body: 'Here are the notes.' };

async function withScene(work: (scene: AssistantScene) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    const scene = await grantedScene(world);
    world.adapters.workspace.addMailbox(scene.harness.id, 'barnabas@unfoldingword.org');
    await work(scene);
  } finally {
    await world.close();
  }
}

function why(outcome: KernelOutcome<unknown>): unknown {
  return outcome.status === 'error' ? outcome.detail['why'] : undefined;
}

function inHours(scene: AssistantScene, hours: number): string {
  return new Date(scene.world.adapters.clock.now().getTime() + hours * 3_600_000).toISOString();
}

async function draftsWaitAndWakeOnlyThePerson(scene: AssistantScene): Promise<void> {
  const open = await openTurn(scene, { externalId: '1201', note: 'Send Ben the notes' });
  const proposed = value(await proposeEmail(scene, open, mail));
  expect(proposed.status).toBe('pending');
  expect(scene.world.adapters.workspace.mails()).toEqual([]);
  await closeTurn(scene, open);
  expect(scene.world.adapters.workspace.mails()).toEqual([]);
  const wakes = scene.world.adapters.notifier
    .delivered()
    .filter((wake) => wake.reason === 'proposal_waiting');
  expect(wakes).toHaveLength(1);
  expect(wakes[0]?.personal).toBe(true);
  expect(wakes[0]?.link).toBe(`/assistant#proposal-${proposed.proposalId}`);
  expect(wakes[0]?.recipients.map((recipient) => recipient.personId)).toEqual([
    personOf(scene.person),
  ]);
  const reply = scene.world.adapters.directMessages.sent().at(-1)?.text ?? '';
  expect(reply).toContain(`${simAppOrigin}/assistant#proposal-${proposed.proposalId}`);
  const log = await assistantLog(scene);
  expect(JSON.stringify(log.map((event) => event.evidence))).not.toContain('Meeting notes');
}

async function onlyThePersonDecides(scene: AssistantScene): Promise<void> {
  const open = await openTurn(scene, { externalId: '1211', note: 'Send Ben the notes' });
  const { proposalId } = value(await proposeEmail(scene, open, mail));
  expect(why(await decide(scene, open.turn.principal, proposalId, 'accept'))).toBe(
    'not_the_person',
  );
  expect(why(await decide(scene, scene.rowan, proposalId, 'accept'))).toBe('not_the_person');
  const changed = await decide(scene, scene.person, proposalId, 'accept', 'f'.repeat(64));
  expect(why(changed)).toBe('proposal_changed');
  expect(scene.world.adapters.workspace.mails()).toEqual([]);
  const accepted = value(await decide(scene, scene.person, proposalId, 'accept'));
  expect(accepted).toMatchObject({ decision: 'accept', failure: null });
  expect(scene.world.adapters.workspace.mails()).toHaveLength(1);
  expect(scene.world.adapters.workspace.mails()[0]).toMatchObject({
    from: 'barnabas@unfoldingword.org',
    to: ['ben@example.org'],
  });
  expect(why(await decide(scene, scene.person, proposalId, 'accept'))).toBe('already_decided');
  expect(scene.world.adapters.workspace.mails()).toHaveLength(1);
  const row = await proposalOf(scene, proposalId);
  expect(row?.decidedBy).toBe(scene.person.identity);
  const log = await assistantLog(scene);
  const done = log.filter((event) => event.name === 'assistant_effect_done');
  expect(done.map((event) => event.evidence['kind'])).toContain('email_sent');
}

async function aDeclineSendsNothing(scene: AssistantScene): Promise<void> {
  const open = await openTurn(scene, { externalId: '1221', note: 'Send Ben the notes' });
  const { proposalId } = value(await proposeEmail(scene, open, mail));
  const declined = value(await decide(scene, scene.person, proposalId, 'decline'));
  expect(declined).toEqual({ proposalId, decision: 'decline', effectId: null, failure: null });
  expect((await proposalOf(scene, proposalId))?.status).toBe('declined');
  expect(scene.world.adapters.workspace.mails()).toEqual([]);
}

async function aWeekLaterItIsExpired(scene: AssistantScene): Promise<void> {
  const open = await openTurn(scene, { externalId: '1231', note: 'Send Ben the notes' });
  const first = value(await proposeEmail(scene, open, mail));
  const second = value(await proposeEmail(scene, open, { ...mail, subject: 'Second' }));
  scene.world.adapters.clock.advance(7 * DAY_MS);
  expect(why(await decide(scene, scene.person, first.proposalId, 'accept'))).toBe(
    'proposal_expired',
  );
  expect(value(await expireDue(scene)).expired).toEqual([second.proposalId]);
  expect((await proposalOf(scene, first.proposalId))?.status).toBe('expired');
  expect(scene.world.adapters.workspace.mails()).toEqual([]);
}

async function appendsToAPageThePersonCanEdit(scene: AssistantScene): Promise<void> {
  await seedNotesPage(scene, { id: notesPage, jdArea: '10-19', bodyMd: '# Project notes' });
  await seedNotesPage(scene, { id: foreignPage, jdArea: '30-39', bodyMd: '# Other' });
  const open = await openTurn(scene, { externalId: '1241', note: 'Add the transcript' });
  const foreign = await proposePageAppend(scene, open, { pageId: foreignPage, text: 'Summary' });
  expect(why(foreign)).toBe('page_not_editable');
  const missing = await proposePageAppend(scene, open, {
    pageId: '00000000-0000-4000-8000-000000013009',
    text: 'Summary',
  });
  expect(why(missing)).toBe('page_not_found');
  const { proposalId } = value(
    await proposePageAppend(scene, open, {
      pageId: notesPage,
      heading: 'Meeting 2026-10-01',
      text: 'We chose the second option.',
    }),
  );
  expect(scene.world.adapters.pageAppends.page(notesPage)?.version).toBe(1);
  value(await decide(scene, scene.person, proposalId, 'accept'));
  const page = scene.world.adapters.pageAppends.page(notesPage);
  expect(page?.version).toBe(2);
  expect(page?.bodyMd).toContain('## Meeting 2026-10-01\n\nWe chose the second option.');
  expect(page?.bodyMd).toContain('from a proposal its person accepted on 2026-10-01');
  expect(scene.world.adapters.pageAppends.appended()[0]?.actor).toBe(scene.person.identity);
}

async function invitesFromThePersonsCalendar(scene: AssistantScene): Promise<void> {
  const open = await openTurn(scene, { externalId: '1251', note: 'Find a time with Ben' });
  const past = await proposeInvite(scene, open, {
    title: 'Planning',
    start: inHours(scene, -2),
    end: inHours(scene, -1),
    attendees: ['ben@example.org'],
  });
  expect(why(past)).toBe('invite_in_past');
  const { proposalId } = value(
    await proposeInvite(scene, open, {
      title: 'Planning',
      start: inHours(scene, 24),
      end: inHours(scene, 25),
      attendees: ['ben@example.org'],
    }),
  );
  const events = () => scene.world.adapters.workspace.events(personOf(scene.person));
  expect(events()).toEqual([]);
  value(await decide(scene, scene.person, proposalId, 'accept'));
  expect(events()).toHaveLength(1);
  expect(events()[0]).toMatchObject({ title: 'Planning', attendees: ['ben@example.org'] });
}

async function capsProposalsPerRequest(scene: AssistantScene): Promise<void> {
  const open = await openTurn(scene, { externalId: '1261', note: 'Write to everyone' });
  for (let n = 1; n <= 5; n += 1) {
    value(await proposeEmail(scene, open, { ...mail, subject: `Note ${String(n)}` }));
  }
  const again = value(await proposeEmail(scene, open, { ...mail, subject: 'Note 1' }));
  expect(again.status).toBe('pending');
  expect(why(await proposeEmail(scene, open, { ...mail, subject: 'Note 6' }))).toBe(
    'proposals_capped',
  );
}

async function aFailedSendIsRecordedOnce(scene: AssistantScene): Promise<void> {
  const open = await openTurn(scene, { externalId: '1271', note: 'Send Ben the notes' });
  const { proposalId } = value(await proposeEmail(scene, open, mail));
  scene.world.adapters.workspace.failNextWith('unavailable');
  const decided = value(await decide(scene, scene.person, proposalId, 'accept'));
  expect(decided.failure).toBe('workspace_unavailable');
  const log = await assistantLog(scene);
  const failed = log.filter((event) => event.name === 'assistant_effect_failed');
  expect(failed.map((event) => event.evidence['why'])).toEqual(['workspace_unavailable']);
  expect(why(await decide(scene, scene.person, proposalId, 'accept'))).toBe('already_decided');
}

async function anotherPersonsProposalIsNotTheirs(scene: AssistantScene): Promise<void> {
  const open = await openTurn(scene, { externalId: '1281', note: 'Send Ben the notes' });
  const { proposalId } = value(await proposeEmail(scene, open, mail));
  const other = await simPerson(scene.world, 6, [
    { role: 'admin', scopeKind: 'org', scopeArea: null },
  ]);
  expect(why(await decide(scene, other, proposalId, 'accept'))).toBe('not_the_person');
  expect((await proposalOf(scene, proposalId))?.status).toBe('pending');
}

describe('PA-12 nothing reaches another person until my assistant proposal is decided by me', () => {
  it('drafts a proposal, sends nothing, and wakes only me with a link', () =>
    withScene(draftsWaitAndWakeOnlyThePerson));
  it('lets only me decide, on the digest I saw, and sends exactly once', () =>
    withScene(onlyThePersonDecides));
  it('sends nothing when I decline it', () => withScene(aDeclineSendsNothing));
  it('expires a proposal a week after it was drafted', () => withScene(aWeekLaterItIsExpired));
  it('appends only to a page I can edit, as me, with the assistant named', () =>
    withScene(appendsToAPageThePersonCanEdit));
  it('sends an invitation from my own calendar once I accept it', () =>
    withScene(invitesFromThePersonsCalendar));
  it('caps the proposals one request can draft', () => withScene(capsProposalsPerRequest));
  it('records a failed send once and never retries it', () => withScene(aFailedSendIsRecordedOnce));
  it("refuses an org admin deciding another person's proposal", () =>
    withScene(anotherPersonsProposalIsNotTheirs));
});
