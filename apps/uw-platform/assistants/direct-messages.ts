import type { DirectMessages } from '@uw/harness';
import { credentialsDepsOf } from '../credentials/compose.ts';
import type { DatabaseHandle } from '../database.ts';
import type { Bindings } from '../env.ts';
import { httpsOrigin } from '../notify/origin.ts';
import { systemClock } from '../ports/clock.ts';
import { platformDirectMessages } from '../ports/direct-messages.ts';
import { directMessagesNotWired } from '../ports/direct-messages.not-wired.ts';
import { systemTimers } from '../timers.ts';

type DirectMessagesHost = {
  readonly env: Bindings;
  readonly database: DatabaseHandle;
  readonly fetch: typeof fetch;
};

export type DirectMessagesFactory = (host: DirectMessagesHost) => DirectMessages;

export const directMessagesOf: DirectMessagesFactory = ({ env, database, fetch }) => {
  const site = httpsOrigin(env.ZULIP_SITE);
  if (site === null) return directMessagesNotWired;
  const platform = {
    fetch,
    timers: systemTimers,
    clock: systemClock,
    newId: () => crypto.randomUUID(),
  };
  const { keys } = credentialsDepsOf(env, database.db, platform);
  return platformDirectMessages(
    { db: database.db, keys, site, fetcher: fetch, timers: systemTimers, clock: systemClock },
    directMessagesNotWired,
  );
};
