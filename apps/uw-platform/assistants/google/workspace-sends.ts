import {
  attendingPerson,
  copiedToPerson,
  type MailSent,
  type OutgoingMail,
  type Workspace,
} from '@uw/harness';
import { insertInvite } from './calendar.ts';
import { sendRaw } from './gmail.ts';
import { claimSend, markSent, releaseSend } from './mail-sends.ts';
import { proposalMime } from './proposal-mime.ts';
import { mailboxOf, personMailOf } from './subjects.ts';
import type { Executor } from '@uw/db/client';
import type { TokenDeps } from './token.ts';

type WorkspaceDeps = {
  readonly db: Executor;
  readonly domain: string;
  readonly tokens: TokenDeps;
};

const SEND_TIMEOUT_MS = 10_000;
const refused: MailSent = { outcome: 'refused' };

type Sender = { readonly mailbox: string; readonly replyTo: string };

async function senderOf(deps: WorkspaceDeps, mail: OutgoingMail): Promise<Sender | null> {
  const box = await mailboxOf(deps.db, mail.harnessId);
  if (box === null || box.status !== 'active' || box.personId !== mail.personId) return null;
  const replyTo = await personMailOf(deps.db, mail.personId, deps.domain);
  return replyTo === null ? null : { mailbox: box.address, replyTo };
}

async function sent(deps: WorkspaceDeps, mail: OutgoingMail, sender: Sender): Promise<MailSent> {
  const raw = proposalMime({
    from: sender.mailbox,
    to: mail.to,
    cc: copiedToPerson(mail.to, mail.cc, sender.replyTo),
    replyTo: sender.replyTo,
    subject: mail.subject,
    text: mail.body,
  });
  const answer = await sendRaw(deps.tokens, sender.mailbox, raw, null, SEND_TIMEOUT_MS);
  if (answer.ok) {
    await markSent(deps.db, mail.effectId, answer.value.id, deps.tokens.now());
    return { outcome: 'sent' };
  }
  if (answer.failure === 'unknown') return { outcome: 'outcome_unknown' };
  await releaseSend(deps.db, mail.effectId);
  return refused;
}

export function sendMailOf(deps: WorkspaceDeps): Workspace['sendMail'] {
  return async (mail) => {
    const sender = await senderOf(deps, mail);
    if (sender === null) return refused;
    const key = { effectId: mail.effectId, harnessId: mail.harnessId };
    const claim = await claimSend(deps.db, key, deps.tokens.now());
    if (claim === 'sent') return { outcome: 'sent' };
    if (claim === 'unsettled') return { outcome: 'outcome_unknown' };
    return sent(deps, mail, sender);
  };
}

export function sendInviteOf(deps: WorkspaceDeps): Workspace['sendInvite'] {
  return async (invite) => {
    const email = await personMailOf(deps.db, invite.personId, deps.domain);
    if (email === null) return { outcome: 'refused' };
    return insertInvite(deps.tokens, email, {
      ...invite,
      attendees: attendingPerson(invite.attendees, email),
    });
  };
}
