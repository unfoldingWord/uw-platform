import type { DirectMessages } from '@uw/harness';
import { credentialsDepsOf } from '../credentials/compose.ts';
import type { DatabaseHandle } from '../database.ts';
import type { Bindings } from '../env.ts';
import { httpsOrigin } from '../notify/origin.ts';
import { systemClock } from '../ports/clock.ts';
import { platformDirectMessages } from '../ports/direct-messages.ts';
import { emailDirectMessages } from '../ports/direct-messages.email.ts';
import { directMessagesNotWired } from '../ports/direct-messages.not-wired.ts';
import { systemTimers } from '../timers.ts';
import { googleAccessOf } from './workspace.ts';

type DirectMessagesHost = {
  readonly env: Bindings;
  readonly database: DatabaseHandle;
  readonly fetch: typeof fetch;
};

export type DirectMessagesFactory = (host: DirectMessagesHost) => DirectMessages;

function zulipOf({ env, database, fetch }: DirectMessagesHost): DirectMessages {
  const site = httpsOrigin(env.ZULIP_SITE);
  if (site === null) return directMessagesNotWired;
  const platform = {
    fetch,
    timers: systemTimers,
    clock: systemClock,
    newId: () => crypto.randomUUID(),
  };
  const { keys } = credentialsDepsOf(env, database.db, platform);
  return platformDirectMessages({
    db: database.db,
    keys,
    site,
    fetcher: fetch,
    timers: systemTimers,
    clock: systemClock,
  });
}

function emailOf({ env, database, fetch }: DirectMessagesHost): DirectMessages {
  const access = googleAccessOf(env, database.db, fetch);
  if (access === null) return directMessagesNotWired;
  return emailDirectMessages({ db: database.db, tokens: access.tokens, clock: systemClock });
}

export const directMessagesOf: DirectMessagesFactory = (host) => {
  const zulip = zulipOf(host);
  const email = emailOf(host);
  if (zulip === directMessagesNotWired && email === directMessagesNotWired) return zulip;
  return {
    send: async (message) => (message.channel === 'email' ? email : zulip).send(message),
  };
};
