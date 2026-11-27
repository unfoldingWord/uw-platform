import type { Clock, DirectDelivery, DirectMessage, DirectMessages } from '@uw/harness';
import type { Executor } from '@uw/db/client';
import { replyHeaders, sendRaw, type ReplyHeaders } from '../assistants/google/gmail.ts';
import { claimSend, markSent, releaseSend } from '../assistants/google/mail-sends.ts';
import { mailTarget, type MailTarget } from '../assistants/google/mailboxes.ts';
import { replyMime } from '../assistants/google/reply-mime.ts';
import { accessToken, GOOGLE_SCOPES, type TokenDeps } from '../assistants/google/token.ts';

export type EmailDirectDeps = {
  readonly db: Executor;
  readonly tokens: TokenDeps;
  readonly clock: Clock;
};

const SEND_TIMEOUT_MS = 5_000;
const notPaired: DirectDelivery = { outcome: 'not_paired' };
const dropped: DirectDelivery = { outcome: 'dropped' };
const deadlinePassed: DirectDelivery = { outcome: 'deadline_passed' };

function remainingMs(deps: EmailDirectDeps, message: DirectMessage): number {
  return message.sendBy.getTime() - deps.clock.now().getTime();
}

async function boundTarget(deps: EmailDirectDeps, message: DirectMessage) {
  if (message.channel !== 'email') return null;
  const target = await mailTarget(deps.db, message.personId);
  return target !== null && target.address === message.replyAddress ? target : null;
}

function rawReply(target: MailTarget, message: DirectMessage, original: ReplyHeaders | null) {
  const messageId = original?.messageId ?? null;
  const references =
    original?.references === null || original === null
      ? messageId
      : `${original.references} ${messageId ?? ''}`;
  return replyMime({
    from: target.mailbox,
    to: target.address,
    subject: original?.subject ?? '',
    inReplyTo: messageId,
    references,
    text: message.text,
  });
}

async function released(deps: EmailDirectDeps, message: DirectMessage, outcome: DirectDelivery) {
  await releaseSend(deps.db, message.effectId);
  return outcome;
}

async function delivered(
  deps: EmailDirectDeps,
  target: MailTarget,
  message: DirectMessage,
): Promise<DirectDelivery> {
  const minted = await accessToken(deps.tokens, target.mailbox, [GOOGLE_SCOPES.gmail]);
  if (!minted.ok) return released(deps, message, dropped);
  const original =
    message.threadKey === null
      ? null
      : await replyHeaders(deps.tokens, target.mailbox, message.threadKey);
  const remaining = remainingMs(deps, message);
  if (remaining <= 0) return released(deps, message, deadlinePassed);
  const raw = rawReply(target, message, original);
  const timeoutMs = Math.min(SEND_TIMEOUT_MS, remaining);
  const sent = await sendRaw(
    deps.tokens,
    target.mailbox,
    raw,
    original?.threadId ?? null,
    timeoutMs,
  );
  if (sent.ok) {
    await markSent(deps.db, message.effectId, sent.value.id, deps.clock.now());
    return { outcome: 'sent' };
  }
  return sent.failure === 'unknown' ? dropped : released(deps, message, dropped);
}

export function emailDirectMessages(deps: EmailDirectDeps): DirectMessages {
  return {
    send: async (message) => {
      if (remainingMs(deps, message) <= 0) return deadlinePassed;
      const target = await boundTarget(deps, message);
      if (target === null) return notPaired;
      const key = { effectId: message.effectId, harnessId: target.harnessId };
      const claim = await claimSend(deps.db, key, deps.clock.now());
      if (claim === 'sent') return { outcome: 'sent' };
      if (claim === 'unsettled') return dropped;
      return delivered(deps, target, message);
    },
  };
}
