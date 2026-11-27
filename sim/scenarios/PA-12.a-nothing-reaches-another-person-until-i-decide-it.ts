import assert from 'node:assert/strict';
import { findTime } from '../assistant-calendar-fixtures.ts';
import { assistantLog, grantedScene, type AssistantScene } from '../assistant-fixtures.ts';
import { decide, proposalOf, proposeEmail, proposeInvite } from '../assistant-proposal-fixtures.ts';
import { closeTurn, openTurn } from '../assistant-reminder-fixtures.ts';
import { value } from '../runs.ts';
import { defineScenario } from '../scenario.ts';
import { personOf } from '../wakes.ts';

const subject = 'Draft budget for Ruth 2';

function whyOf(outcome: { readonly status: string; readonly detail?: Record<string, unknown> }) {
  return outcome.status === 'error' ? outcome.detail?.['why'] : undefined;
}

async function findATimeAndPropose(scene: AssistantScene): Promise<string> {
  scene.world.adapters.workspace.addPerson(
    '00000000-0000-4000-8000-000000000b0b',
    'ben@unfoldingword.org',
  );
  const open = await openTurn(scene, { externalId: '2201', note: 'Find a time to meet with Ben' });
  const free = value(await findTime(scene, open, { with: ['ben@unfoldingword.org'], minutes: 30 }));
  const slot = free.slots[0];
  assert.ok(slot);
  const { proposalId } = value(
    await proposeInvite(scene, open, {
      title: 'Ruth 2 planning',
      start: slot.startAt,
      end: new Date(new Date(slot.startAt).getTime() + 30 * 60_000).toISOString(),
      attendees: ['ben@unfoldingword.org'],
    }),
  );
  await closeTurn(scene, open);
  const calendar = scene.world.adapters.workspace.events(personOf(scene.person));
  assert.equal(calendar.filter((event) => event.attendees.length > 0).length, 0);
  return proposalId;
}

async function onlyIDecide(scene: AssistantScene, proposalId: string): Promise<number> {
  const open = await openTurn(scene, { externalId: '2202', note: 'Send Ben the budget' });
  const mail = { to: ['ben@unfoldingword.org'], subject, body: 'Attached is the draft.' };
  const email = value(await proposeEmail(scene, open, mail));
  const assistant = open.turn.principal;
  assert.equal(whyOf(await decide(scene, assistant, email.proposalId, 'accept')), 'not_the_person');
  assert.equal(
    whyOf(await decide(scene, scene.rowan, email.proposalId, 'accept')),
    'not_the_person',
  );
  const stale = await decide(scene, scene.person, email.proposalId, 'accept', '0'.repeat(64));
  assert.equal(whyOf(stale), 'proposal_changed');
  assert.equal(scene.world.adapters.workspace.mails().length, 0);
  value(await decide(scene, scene.person, email.proposalId, 'accept'));
  value(await decide(scene, scene.person, proposalId, 'accept'));
  const again = await decide(scene, scene.person, email.proposalId, 'accept');
  assert.equal(whyOf(again), 'already_decided');
  assert.equal((await proposalOf(scene, email.proposalId))?.decidedBy, scene.person.identity);
  const invited = scene.world.adapters.workspace
    .events(personOf(scene.person))
    .filter((event) => event.attendees.includes('ben@unfoldingword.org'));
  assert.equal(invited.length, 1);
  return scene.world.adapters.workspace.mails().length;
}

export const scenario = defineScenario({
  id: 'PA-12',
  title:
    'nothing my assistant drafts for another person reaches them until I decide it: finding a time with a colleague yields an invitation proposal, an email is a proposal, only I can accept either on the digest I saw, and each runs exactly once',
  run: async (world) => {
    const scene = await grantedScene(world);
    world.adapters.workspace.addMailbox(scene.harness.id, 'barnabas@unfoldingword.org');
    const inviteId = await findATimeAndPropose(scene);
    const mails = await onlyIDecide(scene, inviteId);
    const names = (await assistantLog(scene))
      .map((event) => event.name)
      .filter((name) => name.startsWith('assistant_proposal_'));
    return { state: { mails, names } };
  },
});
