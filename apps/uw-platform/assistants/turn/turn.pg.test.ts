import { describe, expect, it } from 'vitest';
import type { HarnessEvent } from '@uw/contracts';
import { ingestPrincipal, systemPrincipal } from '@uw/core/principal';
import { testServer } from '@uw/db/test-database';
import { allEvents } from '../../testing/commands.ts';
import { rigBotEmail, withTurnRig, type TurnRig } from '../../testing/turn-rig.ts';
import { completion, Crash, memorySteps, run, type Memory } from '../../testing/turn-script.ts';

const DAY_MS = 24 * 60 * 60_000;
const principals = { system: systemPrincipal(), ingest: ingestPrincipal() };

function scriptReminder(rig: TurnRig): void {
  const dueAt = new Date(rig.start.getTime() + DAY_MS).toISOString();
  const call = { id: 'call_1', name: 'set_reminder', args: { text: 'Call Ana', dueAt } };
  rig.gateway.respondNext(200, completion(null, [call]));
  rig.gateway.respondNext(200, completion('I will remind you tomorrow to call Ana.', []));
}

async function named(rig: TurnRig, name: string): Promise<readonly HarnessEvent[]> {
  return (await allEvents(rig.db, rig.harnessId)).filter((event) => event.name === name);
}

function sentFromMyBot(rig: TurnRig) {
  return rig.zulip
    .messages()
    .filter((message) => message.type === 'direct')
    .map((message) => [message.sender, message.to, message.content]);
}

type SentBody = {
  readonly provider: unknown;
  readonly tools: readonly { readonly function: { readonly name: string } }[];
};

async function answersEndToEnd(rig: TurnRig): Promise<void> {
  scriptReminder(rig);
  const outcomes = await rig.direct('Remind me to call Ana tomorrow', 8801);
  expect(outcomes).toEqual(['assistant_request_recorded', 'assistant_turn_started']);
  expect(await run(rig, 0)).toBe('sent');
  expect(sentFromMyBot(rig)).toEqual([
    [rigBotEmail(rig.harnessId), [5001], 'I will remind you tomorrow to call Ana.'],
  ]);
  const body = rig.gateway.requests[0]?.body as SentBody;
  expect(body.provider).toEqual({
    order: ['z-ai'],
    allow_fallbacks: false,
    zdr: true,
    data_collection: 'deny',
  });
  const offered = body.tools.map((tool) => tool.function.name);
  expect(offered).toContain('set_reminder');
  expect(offered).not.toContain('write_page');
  const [finished] = await named(rig, 'assistant_turn_finished');
  expect(finished?.evidence).toMatchObject({
    outcome: 'ended',
    turns: 2,
    costMicros: 200,
    tools: ['set_reminder'],
  });
  expect(await named(rig, 'assistant_reminder_set')).toHaveLength(1);
}

async function redeliveryStartsNothing(rig: TurnRig): Promise<void> {
  scriptReminder(rig);
  await rig.direct('Remind me to call Ana tomorrow', 8802);
  expect(await run(rig, 0)).toBe('sent');
  const again = await rig.direct('Remind me to call Ana tomorrow', 8802);
  expect(again).toEqual(['assistant_request_replayed', 'assistant_turn_already_started']);
  const calls = rig.gateway.requests.length;
  expect(await run(rig, 0)).toBe('turn_taken');
  expect(rig.gateway.requests).toHaveLength(calls);
  expect(sentFromMyBot(rig)).toHaveLength(1);
}

async function retryReplaysTheTurn(rig: TurnRig): Promise<void> {
  scriptReminder(rig);
  scriptReminder(rig);
  await rig.direct('Remind me to call Ana tomorrow', 8803);
  const memory: Memory = new Map();
  await expect(run(rig, 0, memorySteps(memory, 'finish'))).rejects.toThrow(Crash);
  const beforeLoop: Memory = new Map([...memory].filter(([name]) => name !== 'loop'));
  expect(await run(rig, 0, memorySteps(beforeLoop))).toBe('sent');
  expect(await run(rig, 0, memorySteps(memory))).toBe('sent');
  expect(await named(rig, 'assistant_turn_started')).toHaveLength(1);
  expect(await named(rig, 'assistant_turn_finished')).toHaveLength(1);
  expect(await named(rig, 'assistant_reminder_set')).toHaveLength(1);
  expect(sentFromMyBot(rig)).toHaveLength(1);
}

async function failedLoopTellsMeOnce(rig: TurnRig): Promise<void> {
  rig.gateway.respondNext(502, { error: { message: 'upstream unavailable' } });
  await rig.direct('What is on my list?', 8804);
  expect(await run(rig, 0)).toBe('sent');
  const [finished] = await named(rig, 'assistant_turn_finished');
  expect(finished?.evidence).toMatchObject({ outcome: 'failed', costMicros: null });
  const sent = sentFromMyBot(rig);
  expect(sent).toHaveLength(1);
  expect(String(sent[0]?.[2])).toContain('I could not finish an answer');
  expect(rig.gateway.requests).toHaveLength(1);
}

describe.skipIf(!testServer)('PA-17 the hosted assistant turn', () => {
  it('turns a direct message to my bot into one model-written reply from my bot', () =>
    withTurnRig(principals, answersEndToEnd));

  it('starts nothing for a redelivered message, and a second instance gets turn_taken', () =>
    withTurnRig(principals, redeliveryStartsNothing));

  it('replays the same turn after the host dies mid-turn and replies once', () =>
    withTurnRig(principals, retryReplaysTheTurn));

  it('finishes a failed loop as failed at an unknown cost and tells me once', () =>
    withTurnRig(principals, failedLoopTellsMeOnce));
});
