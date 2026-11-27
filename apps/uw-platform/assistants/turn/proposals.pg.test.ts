import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { ingestPrincipal, systemPrincipal } from '@uw/core/principal';
import { testServer } from '@uw/db/test-database';
import { allEvents } from '../../testing/commands.ts';
import { withTurnRig, type TurnRig } from '../../testing/turn-rig.ts';
import { completion, run } from '../../testing/turn-script.ts';

const HOUR_MS = 60 * 60_000;
const principals = { system: systemPrincipal(), ingest: ingestPrincipal() };

function repliesFromMyBot(rig: TurnRig): readonly string[] {
  return rig.zulip
    .messages()
    .filter((message) => message.type === 'direct')
    .map((message) => message.content);
}

async function proposesAnInvitationAndSendsNothing(rig: TurnRig): Promise<void> {
  const start = new Date(rig.start.getTime() + 26 * HOUR_MS).toISOString();
  const end = new Date(rig.start.getTime() + 27 * HOUR_MS).toISOString();
  const args = { title: 'Ruth 2 planning', start, end, attendees: ['ben@unfoldingword.org'] };
  rig.gateway.respondNext(200, completion(null, [{ id: 'call_1', name: 'propose_invite', args }]));
  rig.gateway.respondNext(200, completion('I proposed a meeting with Ben.', []));
  await rig.direct('Find a time to meet with Ben tomorrow', 8911);
  expect(await run(rig, 0)).toBe('sent');
  const rows = await rig.db.execute<{ id: string; status: string }>(
    sql`SELECT id, status FROM assistant_proposals WHERE harness_id = ${rig.harnessId}`,
  );
  expect(rows.map((row) => row.status)).toEqual(['pending']);
  const proposalId = rows[0]?.id ?? '';
  expect(rig.google.requests().filter((request) => request.path.endsWith('/events'))).toEqual([]);
  const [reply] = repliesFromMyBot(rig);
  expect(reply).toContain('I proposed a meeting with Ben.');
  expect(reply).toContain(`/assistant#proposal-${proposalId}`);
  const names = (await allEvents(rig.db, rig.harnessId)).map((event) => event.name);
  expect(names).toContain('assistant_proposal_drafted');
  expect(names).not.toContain('assistant_proposal_decided');
}

describe.skipIf(!testServer)('PA-12 the hosted turn proposes and never sends', () => {
  it('drafts an invitation through the assistant host, sends nothing and links it in the reply', () =>
    withTurnRig(principals, proposesAnInvitationAndSendsNothing));
});
