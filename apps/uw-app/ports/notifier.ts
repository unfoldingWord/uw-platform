import type { LogSink } from '@uw/core/log';
import type { Notifier } from '@uw/harness';
import type { DatabaseHandle } from '../database.ts';
import { commitOf, type Bindings } from '../env.ts';
import { notifyConfigOf } from '../notify/config.ts';
import { platformNotifier } from '../notify/notifier.ts';
import { webPushTransport } from '../notify/push/transport.ts';
import { zulipPoster } from '../notify/zulip/post.ts';
import { systemTimers } from '../timers.ts';
import { notifierNotWired } from './notifier.not-wired.ts';

export { platformNotifier };

const networkFetch: typeof fetch = (input, init) => fetch(input, init);

export function notifierOf(
  env: Bindings,
  database: DatabaseHandle | null,
  sink: LogSink,
  fetcher: typeof fetch = networkFetch,
): Notifier {
  if (database === null) return notifierNotWired;
  const config = notifyConfigOf(env);
  return platformNotifier({
    db: database.db,
    config,
    push: config.push === null ? null : webPushTransport(config.push, fetcher, systemTimers),
    zulip: config.zulip === null ? null : zulipPoster(config.zulip, fetcher, systemTimers),
    sink,
    commit: commitOf(env),
  });
}
