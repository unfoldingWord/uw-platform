import { describe, expect, it } from 'vitest';
import {
  assistantProvisionerPrincipal,
  ingestPrincipal,
  systemPrincipal,
} from '@uw/core/principal';
import { testServer } from '@uw/db/test-database';
import PostalMime from 'postal-mime';
import { allEvents } from '../testing/commands.ts';
import { withTurnRig, type TurnRig } from '../testing/turn-rig.ts';
import { completion, run } from '../testing/turn-script.ts';
import { putMailbox } from './google/subjects.ts';
import { googleAccessOf } from './workspace.ts';
import { sweepMail, type MailSweepLimits } from './mail-sweep.ts';

const principals = { system: systemPrincipal(), ingest: ingestPrincipal() };
const rowanId = '00000000-0000-4000-8000-000000000001';
const rowan = 'rowan.test@unfoldingword.org';
const mailbox = 'barnabas@unfoldingword.org';
const limits: MailSweepLimits = { mailboxes: 25, messages: 10, budgetMs: 20_000 };

function mailFrom(id: string, dmarc: 'pass' | 'fail', extra = ''): string {
  return [
    'Authentication-Results: mx.google.com;',
    '       dkim=pass header.i=@unfoldingword.org;',
    `       spf=${dmarc} smtp.mailfrom=${rowan};`,
    `       dmarc=${dmarc} (p=QUARANTINE) header.from=unfoldingword.org`,
    `From: Rowan <${rowan}>`,
    `To: ${mailbox}`,
    'Subject: Tomorrow',
    `Message-ID: <${id}@mail.gmail.com>`,
    ...(extra === '' ? [] : [extra]),
    '',
    'Remind me to call Ana tomorrow',
    '',
  ].join('\n');
}

async function withMail(rig: TurnRig): Promise<void> {
  rig.google.addUser(mailbox);
  await putMailbox(rig.db, {
    harnessId: rig.harnessId,
    personId: rowanId,
    address: mailbox,
    googleUserId: '2001',
    status: 'active',
    at: rig.start,
  });
  const caller = {
    actor: assistantProvisionerPrincipal(),
    traceId: crypto.randomUUID(),
    requestId: null,
  };
  const bound = await rig.kernel.assistants.bindAddress(caller, {
    personId: rowanId,
    channel: 'email',
    address: rowan,
  });
  expect(bound.status).toBe('accepted');
}

function sweep(rig: TurnRig, instructions: 'on' | 'off' = 'on', within = limits) {
  const access = googleAccessOf(rig.env, rig.db, rig.fetcher);
  if (access === null) throw new Error('the rig has no Workspace key');
  const startTurn = async (start: { requestId: string; traceId: string }) => {
    rig.started.push(start);
    return 'started' as const;
  };
  return sweepMail(
    {
      db: rig.db,
      kernel: rig.kernel,
      caller: { actor: systemPrincipal(), traceId: crypto.randomUUID(), requestId: null },
      tokens: access.tokens,
      startTurn,
      now: () => new Date(),
      instructions,
    },
    within,
  );
}

async function declinedWhy(rig: TurnRig): Promise<readonly unknown[]> {
  return (await allEvents(rig.db, rig.harnessId))
    .filter((event) => event.name === 'assistant_mail_declined')
    .map((event) => event.evidence['why']);
}

const withRig = (work: (rig: TurnRig) => Promise<void>) =>
  withTurnRig(principals, async (rig) => {
    await withMail(rig);
    await work(rig);
  });

function hasProcessedLabel(rig: TurnRig, id: string): boolean {
  return rig.google.gmail.labelsOf(mailbox, id).some((label) => label.startsWith('Label_'));
}

async function expectOneReply(rig: TurnRig): Promise<void> {
  const sent = rig.google.gmail.sent(mailbox);
  expect(sent.map((one) => one.threadId)).toEqual(['thread-1']);
  const reply = await PostalMime.parse(sent[0]?.raw ?? '');
  expect(reply.to).toEqual([{ name: '', address: rowan }]);
  expect(reply.text?.trim()).toBe('I will remind you tomorrow to call Ana.');
  const auto = reply.headers.find((header) => header.key === 'auto-submitted');
  expect(auto?.value).toBe('auto-replied');
}

async function answeredOnce(rig: TurnRig): Promise<void> {
  const id = rig.google.gmail.deliver(mailbox, mailFrom('one', 'pass'), 'thread-1');
  expect(await sweep(rig)).toMatchObject({ mailboxes: 1, admitted: 1, started: 1, failed: 0 });
  expect(rig.started).toHaveLength(1);
  expect(hasProcessedLabel(rig, id)).toBe(true);
  rig.gateway.respondNext(200, completion('I will remind you tomorrow to call Ana.', []));
  expect(await run(rig, 0)).toBe('sent');
  await expectOneReply(rig);
  expect(await sweep(rig)).toMatchObject({ admitted: 0, declined: 0, started: 0 });
}

async function declinedAndLabelled(rig: TurnRig): Promise<void> {
  rig.google.gmail.deliver(mailbox, mailFrom('two', 'fail'));
  rig.google.gmail.deliver(mailbox, mailFrom('three', 'pass', 'Auto-Submitted: auto-replied'));
  expect(await sweep(rig)).toMatchObject({ admitted: 0, declined: 2, started: 0 });
  expect(await declinedWhy(rig)).toEqual(['unverified_sender', 'automated_sender']);
  expect(rig.started).toEqual([]);
  expect(await sweep(rig)).toMatchObject({ declined: 0 });
}

async function flagOff(rig: TurnRig): Promise<void> {
  rig.google.gmail.deliver(mailbox, mailFrom('four', 'pass'));
  expect(await sweep(rig, 'off')).toMatchObject({ admitted: 0, declined: 1 });
  expect(await declinedWhy(rig)).toEqual(['email_instructions_off']);
}

async function expiredHistory(rig: TurnRig): Promise<void> {
  await sweep(rig);
  rig.google.gmail.deliver(mailbox, mailFrom('five', 'pass'));
  rig.google.gmail.expireHistory(mailbox);
  expect(await sweep(rig)).toMatchObject({ admitted: 1, started: 1 });
  const paths = rig.google.requests().map((request) => request.path);
  expect(paths.filter((path) => path.endsWith('/history')).length).toBeGreaterThan(0);
}

async function withinBudget(rig: TurnRig): Promise<void> {
  await sweep(rig);
  rig.google.gmail.deliver(mailbox, mailFrom('six', 'pass'));
  expect(await sweep(rig, 'on', { ...limits, budgetMs: 0 })).toMatchObject({ admitted: 0 });
  expect(await sweep(rig)).toMatchObject({ admitted: 1 });
}

describe.skipIf(!testServer)('PA-10 the mail sweep, end to end against fake Gmail', () => {
  it('answers my verified mail once, by email, on my thread, marked automatic', () =>
    withRig(answeredOnce));
  it('declines a spoofed mail and an automatic reply, labels them and starts nothing', () =>
    withRig(declinedAndLabelled));
  it('honours mail instructions only when the flag is on', () => withRig(flagOff));
  it('falls back to unprocessed recent mail when the history id has expired', () =>
    withRig(expiredHistory));
  it('stops at its time budget and leaves the mail for the next pass', () => withRig(withinBudget));
});
