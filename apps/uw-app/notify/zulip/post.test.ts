import { describe, expect, it } from 'vitest';
import type { Timers } from '../../timers.ts';
import { systemTimers } from '../../timers.ts';
import { recordingFetch, type FetchAnswer } from '../testing.ts';
import type { ZulipConfig } from './config.ts';
import { zulipPoster } from './post.ts';

const config: ZulipConfig = {
  site: 'https://chat.example.org',
  botEmail: 'harness-bot@chat.example.org',
  apiKey: 'fixture-api-key',
  channels: new Map([['80-89', '80-89 Technology']]),
};

const immediately: Timers = { after: () => Promise.resolve() };

function postWith(answer: FetchAnswer, timers: Timers = systemTimers) {
  const recorded = recordingFetch(answer);
  const poster = zulipPoster(config, recorded.fetcher, timers);
  return { recorded, post: () => poster.post('80-89 Technology', 'software/x#1', 'content') };
}

describe('the Zulip poster', () => {
  it('posts the form to the messages API with the bot basic auth', async () => {
    const { recorded, post } = postWith(() => Response.json({ result: 'success', id: 9 }));
    expect(await post()).toBe('posted');
    const [call] = recorded.calls;
    if (call === undefined) throw new Error('expected one post');
    expect(call.url).toBe('https://chat.example.org/api/v1/messages');
    expect(call.headers.get('authorization')).toBe(
      `Basic ${btoa('harness-bot@chat.example.org:fixture-api-key')}`,
    );
    expect(call.headers.get('content-type')).toBe('application/x-www-form-urlencoded');
    expect(Object.fromEntries(new URLSearchParams(String(call.body)))).toEqual({
      type: 'stream',
      to: '80-89 Technology',
      topic: 'software/x#1',
      content: 'content',
    });
  });

  it('drops on a refusal, an error result, a throw and a timeout', async () => {
    const answers: FetchAnswer[] = [
      () => Response.json({ result: 'error' }, { status: 400 }),
      () => Response.json({ result: 'error', msg: 'no' }),
      () => Promise.reject(new Error('offline')),
    ];
    for (const answer of answers) expect(await postWith(answer).post()).toBe('dropped');
    const silent = postWith(() => new Promise<Response>(() => undefined), immediately);
    expect(await silent.post()).toBe('dropped');
  });
});
