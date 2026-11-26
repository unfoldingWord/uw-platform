import type { DirectMessages } from '@uw/harness';
import type { DatabaseHandle } from '../database.ts';
import type { Bindings } from '../env.ts';
import { directMessagesNotWired } from '../ports/direct-messages.not-wired.ts';

type DirectMessagesHost = {
  readonly env: Bindings;
  readonly database: DatabaseHandle;
  readonly fetch: typeof fetch;
};

export type DirectMessagesFactory = (host: DirectMessagesHost) => DirectMessages;

export const directMessagesOf: DirectMessagesFactory = () => directMessagesNotWired;
