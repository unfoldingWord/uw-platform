import type { Clock, DirectDelivery, DirectMessage, DirectMessages } from '@uw/harness';
import type { Executor } from '@uw/db/client';
import { deliveryTarget, type BotRow } from '../assistants/zulip/bots.ts';
import { sendDirect } from '../assistants/zulip/direct.ts';
import { openBotKey } from '../credentials/assistant-bot-keys.ts';
import { claimSend, markSent, releaseSend } from '../assistants/zulip/sends.ts';
import type { DataKeys } from '../credentials/data-keys.ts';
import type { Timers } from '../timers.ts';

export type ZulipDirectDeps = {
  readonly db: Executor;
  readonly keys: DataKeys;
  readonly site: string;
  readonly fetcher: typeof fetch;
  readonly timers: Timers;
  readonly clock: Clock;
};

const SEND_TIMEOUT_MS = 5_000;
const ZULIP_ADDRESS = /^zulip:([1-9][0-9]{0,14})$/;

const notPaired: DirectDelivery = { outcome: 'not_paired' };
const dropped: DirectDelivery = { outcome: 'dropped' };
const deadlinePassed: DirectDelivery = { outcome: 'deadline_passed' };

function remainingMs(deps: ZulipDirectDeps, message: DirectMessage): number {
  return message.sendBy.getTime() - deps.clock.now().getTime();
}

async function pairedBot(deps: ZulipDirectDeps, message: DirectMessage): Promise<BotRow | null> {
  if (message.channel !== 'zulip_dm') return null;
  const target = await deliveryTarget(deps.db, message.personId);
  if (target === null || target.bot.status !== 'active') return null;
  return target.address === message.replyAddress ? target.bot : null;
}

async function delivered(
  deps: ZulipDirectDeps,
  bot: BotRow,
  message: DirectMessage,
): Promise<DirectDelivery> {
  const userId = Number(ZULIP_ADDRESS.exec(message.replyAddress)?.[1]);
  const apiKey = await openBotKey(deps.keys, bot, bot.sealedKey);
  const remaining = remainingMs(deps, message);
  if (apiKey === null || remaining <= 0) {
    await releaseSend(deps.db, message.effectId);
    return apiKey === null ? dropped : deadlinePassed;
  }
  const sent = await sendDirect(
    {
      site: deps.site,
      fetcher: deps.fetcher,
      timers: deps.timers,
      bot: { email: bot.botEmail, apiKey },
    },
    { toUserId: userId, content: message.text, timeoutMs: Math.min(SEND_TIMEOUT_MS, remaining) },
  );
  if (sent.ok) {
    await markSent(deps.db, message.effectId, sent.value.messageId, deps.clock.now());
    return { outcome: 'sent' };
  }
  if (sent.failure !== 'unknown') await releaseSend(deps.db, message.effectId);
  return dropped;
}

function zulipDirectMessages(deps: ZulipDirectDeps): DirectMessages {
  return {
    send: async (message) => {
      if (remainingMs(deps, message) <= 0) return deadlinePassed;
      const bot = await pairedBot(deps, message);
      if (bot === null) return notPaired;
      const key = { effectId: message.effectId, harnessId: bot.harnessId };
      const claim = await claimSend(deps.db, key, deps.clock.now());
      if (claim === 'sent') return { outcome: 'sent' };
      if (claim === 'unsettled') return dropped;
      return delivered(deps, bot, message);
    },
  };
}

export function platformDirectMessages(
  deps: ZulipDirectDeps,
  email: DirectMessages | null = null,
): DirectMessages {
  const zulip = zulipDirectMessages(deps);
  return {
    send: (message) =>
      message.channel === 'email' && email !== null ? email.send(message) : zulip.send(message),
  };
}
