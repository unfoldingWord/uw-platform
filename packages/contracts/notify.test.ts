import { describe, expect, it } from 'vitest';
import { newEventSchema } from './events.ts';
import {
  deepLinkSchema,
  gateLink,
  homeLink,
  itemLink,
  pushEndpointSchema,
  pushPayloadSchema,
  pushSubscribeSchema,
  pushUnsubscribeSchema,
} from './notify.ts';

const harnessId = '00000000-0000-4000-8000-0000000000a1';
const itemId = '00000000-0000-4000-8000-0000000000b1';
const payload = { harness: 'software', reason: 'gate_waiting', link: gateLink(harnessId, itemId) };

describe('NT-2 the push payload names the harness, the reason and a deep link and nothing else', () => {
  it('accepts the harness, the reason and the link', () => {
    expect(pushPayloadSchema.parse(payload)).toEqual(payload);
  });

  it.each(['content', 'body', 'title', 'text', 'itemId', 'delegationId', 'findings', 'diff'])(
    'rejects a payload that also carries %s',
    (field) => {
      expect(pushPayloadSchema.safeParse({ ...payload, [field]: 'x' }).success).toBe(false);
    },
  );

  it.each([
    `/api/harness/${harnessId}/gates/${itemId}`,
    `https://app.example/harnesses/${harnessId}/gates/${itemId}`,
    `/harnesses/${harnessId}/gates/${itemId}?x=1`,
    '/harnesses/software/gates/item-1',
  ])('rejects the link %s', (link) => {
    expect(pushPayloadSchema.safeParse({ ...payload, link }).success).toBe(false);
  });
});

describe('the deep link builders produce links the schema accepts', () => {
  it('builds the gate, item and home links', () => {
    expect(gateLink(harnessId, itemId)).toBe(`/harnesses/${harnessId}/gates/${itemId}`);
    expect(itemLink(harnessId, itemId)).toBe(`/harnesses/${harnessId}/items/${itemId}`);
    expect(homeLink).toBe('/');
    for (const link of [gateLink(harnessId, itemId), itemLink(harnessId, itemId), homeLink]) {
      expect(deepLinkSchema.safeParse(link).success).toBe(true);
    }
  });
});

describe('a push endpoint must be https on a known push service', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://web.push.apple.com/abc',
    'https://db5p.notify.windows.com/w/?token=abc',
  ])('accepts %s', (endpoint) => {
    expect(pushEndpointSchema.safeParse(endpoint).success).toBe(true);
  });

  it.each([
    'http://fcm.googleapis.com/x',
    'https://169.254.169.254/x',
    'https://evil.example/fcm.googleapis.com',
    'https://fcm.googleapis.com.evil.example/x',
    'https://user:pass@fcm.googleapis.com/x',
    'https://fcm.googleapis.com:8443/x',
    'not a url',
    'https://evil.example\\@fcm.googleapis.com/x',
    'https://notify.windows.com/x',
    'https://.notify.windows.com/x',
    `https://fcm.googleapis.com/${'a'.repeat(2049 - 'https://fcm.googleapis.com/'.length)}`,
  ])('rejects %s', (endpoint) => {
    expect(pushEndpointSchema.safeParse(endpoint).success).toBe(false);
  });
});

describe('a subscription carries an endpoint and the two keys of the right length', () => {
  const subscription = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
    keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) },
    expirationTime: null,
  };

  it('accepts the endpoint, the keys and a missing or non-negative expiry', () => {
    expect(pushSubscribeSchema.safeParse(subscription).success).toBe(true);
    expect(pushSubscribeSchema.safeParse({ ...subscription, expirationTime: 0 }).success).toBe(
      true,
    );
  });

  it.each([
    { keys: { p256dh: 'B'.repeat(86), auth: 'a'.repeat(22) } },
    { keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(23) } },
    { keys: { p256dh: `${'B'.repeat(86)}=`, auth: 'a'.repeat(22) } },
    { keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22), extra: 'x' } },
    { expirationTime: -1 },
    { expirationTime: 1.5 },
    { owner: 'someone' },
  ])('rejects %j', (change) => {
    expect(pushSubscribeSchema.safeParse({ ...subscription, ...change }).success).toBe(false);
  });

  it('unsubscribes by endpoint alone', () => {
    expect(pushUnsubscribeSchema.safeParse({ endpoint: subscription.endpoint }).success).toBe(true);
    expect(pushUnsubscribeSchema.safeParse(subscription).success).toBe(false);
  });
});

const eventBase = {
  eventId: '00000000-0000-4000-8000-0000000000e1',
  harnessId,
  itemId,
  at: '2026-10-03T09:00:00.000Z',
  actor: 'agent:ingest',
  traceId: '00000000-0000-4000-8000-0000000000c1',
  requestId: null,
};
const comment = {
  source: 'zulip',
  messageId: 42,
  topic: 'software/uw-platform#42',
  personId: '00000000-0000-4000-8000-0000000000d1',
  email: 'ana@example.org',
  text: 'Looks right to me.',
  truncated: false,
};

describe('comment_recorded evidence is typed', () => {
  it('accepts a reply with its author mapped or not', () => {
    const name = 'comment_recorded';
    expect(newEventSchema.safeParse({ ...eventBase, name, evidence: comment }).success).toBe(true);
    const unmapped = { ...comment, personId: null };
    expect(newEventSchema.safeParse({ ...eventBase, name, evidence: unmapped }).success).toBe(true);
  });

  it.each([{}, { ...comment, personId: 'ana' }, { ...comment, text: 'x'.repeat(10_001) }])(
    'rejects %j',
    (evidence) => {
      const event = { ...eventBase, name: 'comment_recorded', evidence };
      expect(newEventSchema.safeParse(event).success).toBe(false);
    },
  );
});

describe('zulip_topic_linked carries one topic of at most 60 characters with no line break', () => {
  const linked = (topic: unknown) =>
    newEventSchema.safeParse({ ...eventBase, name: 'zulip_topic_linked', evidence: { topic } });

  it('accepts a topic', () => {
    expect(linked('software/uw-platform#42').success).toBe(true);
    expect(linked('a'.repeat(60)).success).toBe(true);
  });

  it.each(['', 'a'.repeat(61), 'software/a\nb', ' software', 'software '])(
    'rejects %j',
    (topic) => {
      expect(linked(topic).success).toBe(false);
    },
  );
});
