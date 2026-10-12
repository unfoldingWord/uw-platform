import { z } from 'zod';
import type { Timers } from '../../timers.ts';
import type { ZulipConfig } from './config.ts';

const POST_TIMEOUT_MS = 5_000;
const success = z.object({ result: z.literal('success') });

export type ZulipPoster = {
  post(channel: string, topic: string, content: string): Promise<'posted' | 'dropped'>;
};

async function bounded(
  work: (signal: AbortSignal) => Promise<'posted' | 'dropped'>,
  timers: Timers,
): Promise<'posted' | 'dropped'> {
  const stop = new AbortController();
  try {
    const expiry = timers.after(POST_TIMEOUT_MS, stop.signal).then(() => 'dropped' as const);
    return await Promise.race([work(stop.signal), expiry]);
  } catch {
    return 'dropped';
  } finally {
    stop.abort();
  }
}

export function zulipPoster(
  config: ZulipConfig,
  fetcher: typeof fetch,
  timers: Timers,
): ZulipPoster {
  const authorization = `Basic ${btoa(`${config.botEmail}:${config.apiKey}`)}`;
  return {
    post: (channel, topic, content) =>
      bounded(async (signal) => {
        const answer = await fetcher(`${config.site}/api/v1/messages`, {
          method: 'POST',
          headers: { authorization, 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ type: 'stream', to: channel, topic, content }).toString(),
          signal,
        });
        if (answer.status !== 200) return 'dropped';
        const parsed = success.safeParse(await answer.json().catch(() => null));
        return parsed.success ? 'posted' : 'dropped';
      }, timers),
  };
}
