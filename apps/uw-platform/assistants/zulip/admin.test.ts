import { describe, expect, it } from 'vitest';
import type { Timers } from '../../timers.ts';
import { zulipAdmin } from './admin.ts';
import { sendDirect } from './direct.ts';
import { FAKE_ADMIN, FAKE_ZULIP_SITE, fakeZulip, type FakeZulip } from './testing/fake-zulip.ts';

const payloadUrl = 'https://ingest.example.org/webhooks/zulip-assistant';
const waited: number[] = [];
const recordingTimers: Timers = {
  after: (ms) => {
    if (ms >= 5_000) return new Promise<void>(() => undefined);
    waited.push(ms);
    return Promise.resolve();
  },
};
const neverFires: Timers = { after: () => new Promise<void>(() => undefined) };
const firesAtOnce: Timers = { after: () => Promise.resolve() };

function adminOn(zulip: FakeZulip, timers: Timers = recordingTimers) {
  return zulipAdmin({ site: FAKE_ZULIP_SITE, ...FAKE_ADMIN }, zulip.fetch, timers);
}

async function botOf(zulip: FakeZulip) {
  const admin = adminOn(zulip);
  await admin.createBot({ fullName: 'barnabas', shortName: 'barnabas', payloadUrl });
  const details = await admin.botDetails(1002);
  if (!details.ok) throw new Error('no bot');
  return { email: details.value.email, apiKey: details.value.apiKey };
}
async function createsAnOutgoingWebhookBotAnd(): Promise<void> {
  const zulip = fakeZulip();
  const admin = adminOn(zulip);
  const created = await admin.createBot({
    fullName: 'barnabas',
    shortName: 'barnabas',
    payloadUrl,
  });
  expect(created).toEqual({ ok: true, value: { userId: 1001, apiKey: 'bot-key-1001' } });
  const details = await admin.botDetails(1001);
  expect(details).toEqual({
    ok: true,
    value: {
      userId: 1001,
      email: 'barnabas-bot@chat.example.org',
      apiKey: 'bot-key-1001',
      token: 'token-1001',
      payloadUrl,
    },
  });
  expect(zulip.bots()[0]?.services[0]?.base_url).toBe(payloadUrl);
}

async function findsABotItMadeBefore(): Promise<void> {
  const zulip = fakeZulip();
  const admin = adminOn(zulip);
  await admin.createBot({ fullName: 'barnabas', shortName: 'barnabas', payloadUrl });
  const found = await admin.botByShortName('barnabas');
  expect(found.ok && found.value?.userId).toBe(1001);
  const missing = await admin.botByShortName('silas');
  expect(missing).toEqual({ ok: true, value: null });
}

async function looksAPersonUpByEmail(): Promise<void> {
  const zulip = fakeZulip();
  const ana = zulip.addUser('ana@example.org', 'Ana');
  const admin = adminOn(zulip);
  expect(await admin.userIdByEmail('ana@example.org')).toEqual({ ok: true, value: ana });
  expect(await admin.userIdByEmail('nobody@example.org')).toEqual({ ok: true, value: null });
  await admin.createBot({ fullName: 'barnabas', shortName: 'barnabas', payloadUrl });
  expect(await admin.deactivate(1002)).toEqual({ ok: true, value: null });
  expect(zulip.bots()[0]?.is_active).toBe(false);
  expect(zulip.calls()).toContain('DELETE /api/v1/bots/1002');
  expect(await admin.isActive(1002)).toEqual({ ok: true, value: false });
  expect(await admin.reactivate(1002)).toEqual({ ok: true, value: null });
  expect(zulip.bots()[0]?.is_active).toBe(true);
}

async function waitsOnceOnAShortRetry(): Promise<void> {
  const zulip = fakeZulip();
  zulip.addUser('ana@example.org', 'Ana');
  const admin = adminOn(zulip);
  waited.length = 0;
  zulip.failNext({ status: 429, headers: { 'retry-after': '1' } });
  expect((await admin.userIdByEmail('ana@example.org')).ok).toBe(true);
  expect(waited).toEqual([1000]);
  zulip.failNext({ status: 429, headers: { 'retry-after': '30' } });
  expect(await admin.userIdByEmail('ana@example.org')).toEqual({
    ok: false,
    failure: 'rate_limited',
    retryAfterMs: 30_000,
  });
}

async function answersUnknownWhenZulipDoesNot(): Promise<void> {
  const zulip = fakeZulip();
  zulip.hangNext();
  expect(await adminOn(zulip, firesAtOnce).userIdByEmail('ana@example.org')).toEqual({
    ok: false,
    failure: 'unknown',
  });
  zulip.failNext({ status: 400 });
  expect((await adminOn(zulip).deactivate(5)).ok).toBe(false);
}

async function sendsTypeDirectToOneUser(): Promise<void> {
  const zulip = fakeZulip();
  const ana = zulip.addUser('ana@example.org', 'Ana');
  const bot = await botOf(zulip);
  const sent = await sendDirect(
    { site: FAKE_ZULIP_SITE, bot, fetcher: zulip.fetch, timers: neverFires },
    { toUserId: ana, content: 'You have nothing booked.', timeoutMs: 5_000 },
  );
  expect(sent).toEqual({ ok: true, value: { messageId: 1003 } });
  expect(zulip.messages()).toEqual([
    {
      id: 1003,
      sender: 'barnabas-bot@chat.example.org',
      type: 'direct',
      to: [ana],
      content: 'You have nothing booked.',
    },
  ]);
}

async function answersRefusedWhenZulipRefusesAnd(): Promise<void> {
  const zulip = fakeZulip();
  const ana = zulip.addUser('ana@example.org', 'Ana');
  const bot = await botOf(zulip);
  const host = { site: FAKE_ZULIP_SITE, bot, fetcher: zulip.fetch, timers: neverFires };
  zulip.failNext({ status: 400 });
  const message = { toUserId: ana, content: 'Hi', timeoutMs: 5_000 };
  expect(await sendDirect(host, message)).toEqual({ ok: false, failure: 'refused' });
  zulip.hangNext();
  const late = { ...host, timers: firesAtOnce };
  expect(await sendDirect(late, message)).toEqual({ ok: false, failure: 'unknown' });
  expect(zulip.messages()).toEqual([]);
}

describe('PA-6 the Zulip admin client', () => {
  it(
    'creates an outgoing webhook bot and reads back its email and webhook token',
    createsAnOutgoingWebhookBotAnd,
  );

  it('finds a bot it made before by its short name, and none it did not', findsABotItMadeBefore);

  it('looks a person up by email, deactivates and reactivates a bot', looksAPersonUpByEmail);

  it('waits once on a short Retry-After and gives up on a long one', waitsOnceOnAShortRetry);

  it(
    'answers unknown when Zulip does not answer in time, and refused on an error',
    answersUnknownWhenZulipDoesNot,
  );
});

describe('PA-6 a direct message from one assistant bot', () => {
  it('sends type direct to one user id as the bot, with a timeout', sendsTypeDirectToOneUser);

  it(
    'answers refused when Zulip refuses and unknown when it does not answer',
    answersRefusedWhenZulipRefusesAnd,
  );
});

describe('PA-14 renaming an assistant bot', () => {
  it('sets the bot full name to the assistant name', async () => {
    const zulip = fakeZulip();
    const admin = adminOn(zulip);
    const made = await admin.createBot({ fullName: 'barnabas', shortName: 'barnabas', payloadUrl });
    if (!made.ok) throw new Error('no bot');
    expect(await admin.renameBot(made.value.userId, 'Tychicus')).toEqual({ ok: true, value: null });
    expect(zulip.bots().find((bot) => bot.user_id === made.value.userId)?.full_name).toBe(
      'Tychicus',
    );
    expect(await admin.renameBot(9999, 'Tychicus')).toMatchObject({ ok: false });
  });
});
