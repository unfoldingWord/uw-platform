import { describe, expect, it } from 'vitest';
import type { PushPayload } from '@uw/contracts';
import { gateLink } from '@uw/contracts';
import type { Timers } from '../../timers.ts';
import { systemTimers } from '../../timers.ts';
import { endpointFor, recordingFetch, subscription, vapidFixture } from '../testing.ts';
import { webPushTransport, type BuildRequest } from './transport.ts';

const harnessId = 'c6000000-0000-4000-8000-000000000001';
const itemId = 'c6000000-0000-4000-8000-000000000002';
const payload: PushPayload = {
  harness: 'quarantined-harness',
  reason: 'gate_waiting',
  link: gateLink(harnessId, itemId),
};

async function device() {
  const sub = await subscription(endpointFor('transport'));
  return { endpoint: sub.endpoint, ...sub.keys };
}

function containsText(bytes: Uint8Array | string, text: string): boolean {
  const body = typeof bytes === 'string' ? bytes : new TextDecoder('latin1').decode(bytes);
  return body.includes(text);
}

function recordingBuild(built: Parameters<BuildRequest>[0][]): BuildRequest {
  return async (message) => {
    built.push(message);
    return {
      headers: {
        authorization: 'vapid t=fixture',
        ttl: '3600',
        'content-encoding': 'aes128gcm',
        'content-length': '1',
        'content-type': 'application/octet-stream',
      },
      method: 'post',
      body: new Uint8Array([1]),
    };
  };
}

const immediately: Timers = { after: () => Promise.resolve() };

describe('the web push transport', () => {
  it('NT-2 the push request carries only the harness, the reason and the link, encrypted', async () => {
    const vapid = await vapidFixture();
    const recorded = recordingFetch(() => new Response(null, { status: 201 }));
    const transport = webPushTransport(vapid.config, recorded.fetcher, systemTimers);
    const target = await device();
    expect(await transport.send(target, payload, 3)).toBe(201);
    const [call] = recorded.calls;
    if (call === undefined) throw new Error('expected one push request');
    expect(call.url).toBe(target.endpoint);
    expect(Object.fromEntries(call.headers)).toMatchObject({
      'content-encoding': 'aes128gcm',
      ttl: '3600',
      urgency: 'high',
    });
    expect(call.headers.get('authorization')).toMatch(/^vapid t=/);
    expect(containsText(call.body, payload.harness)).toBe(false);
    expect(containsText(call.body, 'gate_waiting')).toBe(false);
  });

  it('builds the request from exactly the three payload fields, at normal urgency below rank 3', async () => {
    const vapid = await vapidFixture();
    const built: Parameters<BuildRequest>[0][] = [];
    const build = recordingBuild(built);
    const recorded = recordingFetch(() => new Response(null, { status: 201 }));
    const transport = webPushTransport(vapid.config, recorded.fetcher, systemTimers, build);
    await transport.send(await device(), payload, 2);
    expect(built).toEqual([{ data: payload, options: { ttl: 3600, urgency: 'normal' } }]);
  });

  it('answers failed when the push service throws or does not answer in time', async () => {
    const vapid = await vapidFixture();
    const throwing = recordingFetch(() => Promise.reject(new Error('offline')));
    const target = await device();
    expect(
      await webPushTransport(vapid.config, throwing.fetcher, systemTimers).send(target, payload, 3),
    ).toBe('failed');
    const silent = recordingFetch(() => new Promise<Response>(() => undefined));
    expect(
      await webPushTransport(vapid.config, silent.fetcher, immediately).send(target, payload, 3),
    ).toBe('failed');
  });
});
