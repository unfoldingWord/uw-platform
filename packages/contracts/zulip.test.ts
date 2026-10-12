import { describe, expect, it } from 'vitest';
import {
  ZULIP_TEXT_LIMIT,
  zulipMessageSchema,
  zulipOutgoingSchema,
  zulipTopicSchema,
} from './zulip.ts';

const message = {
  id: 1201,
  sender_email: 'ana@example.org',
  type: 'stream',
  display_recipient: '80-89 Technology',
  subject: 'software/uw-platform#42',
  content: '@**harness** approve',
};
const recorded = {
  token: 'xyzzy',
  trigger: 'mention',
  bot_email: 'harness-bot@example.zulipchat.com',
  bot_full_name: 'harness',
  data: '@**harness** approve',
  message: { ...message, timestamp: 1_790_000_000, sender_full_name: 'Ana' },
};

describe('a Zulip outgoing payload parses with unknown fields kept out of the result', () => {
  it('parses the recorded shape and drops the fields Zulip adds', () => {
    const parsed = zulipOutgoingSchema.parse(recorded);
    expect(parsed).toEqual({ token: 'xyzzy', trigger: 'mention', message });
  });

  it('reads the message without its token', () => {
    const rest = Object.fromEntries(Object.entries(recorded).filter(([key]) => key !== 'token'));
    expect(zulipMessageSchema.parse(rest)).toEqual({ trigger: 'mention', message });
    expect(Object.keys(zulipMessageSchema.shape)).not.toContain('token');
  });

  it('accepts a private message, whose recipient is a list', () => {
    const direct = { ...recorded, message: { ...message, type: 'private', display_recipient: [] } };
    expect(zulipOutgoingSchema.safeParse(direct).success).toBe(true);
  });

  it.each([
    { ...recorded, token: '' },
    { ...recorded, message: { ...message, id: 0 } },
    { ...recorded, message: { ...message, type: 'channel' } },
    { trigger: 'mention', message },
  ])('rejects %j', (payload) => {
    expect(zulipOutgoingSchema.safeParse(payload).success).toBe(false);
  });
});

describe('a Zulip topic is one trimmed line of at most 60 characters', () => {
  it('limits replies to ten thousand characters', () => {
    expect(ZULIP_TEXT_LIMIT).toBe(10_000);
  });

  it.each(['software', 'software/item-0000abcd', 'a'.repeat(60)])('accepts %s', (topic) => {
    expect(zulipTopicSchema.safeParse(topic).success).toBe(true);
  });

  it.each(['', 'a'.repeat(61), 'a\nb', 'a\rb', ' a', 'a '])('rejects %j', (topic) => {
    expect(zulipTopicSchema.safeParse(topic).success).toBe(false);
  });
});
