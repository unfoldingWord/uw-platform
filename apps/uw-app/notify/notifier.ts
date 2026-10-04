import type { Executor } from '@uw/db/client';
import { createLogger, type LogSink } from '@uw/core/log';
import type { Notifier, Wake } from '@uw/harness';
import type { NotifyConfig } from './config.ts';
import { pushTo } from './push/send.ts';
import { pushStore } from './push/store.ts';
import type { PushTransport } from './push/transport.ts';

export type NotifierDeps = {
  readonly db: Executor;
  readonly config: NotifyConfig;
  readonly push: PushTransport | null;
  readonly sink: LogSink;
  readonly commit: string;
};

function loggerFor(deps: NotifierDeps, wake: Wake) {
  return createLogger(
    { traceId: wake.traceId, commit: deps.commit, route: 'notifier', principal: null },
    deps.sink,
  );
}

export function platformNotifier(deps: NotifierDeps): Notifier {
  const store = pushStore(deps.db);
  return {
    notify: async (wake) => {
      const logger = loggerFor(deps, wake);
      const transport = deps.config.push === null ? null : deps.push;
      const push = await Promise.all(
        wake.recipients.map(async (recipient) => ({
          personId: recipient.personId,
          decision: await pushTo({ store, transport, logger }, wake, recipient),
        })),
      );
      return { push, zulip: 'not_configured' };
    },
  };
}
