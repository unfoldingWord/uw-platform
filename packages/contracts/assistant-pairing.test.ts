import { describe, expect, it } from 'vitest';
import { assistantPairingRefusalSchema, assistantPairingViaSchema } from './assistants.ts';
import { eventEvidenceSchemas } from './event-evidence.ts';
import { eventNameSchema } from './events.ts';
import { ingestSourceSchema } from './ingest.ts';
import { zulipMessageSchema } from './zulip.ts';

describe('PA-6 the pairing contracts', () => {
  it('names the three pairing events', () => {
    for (const name of [
      'assistant_pairing_started',
      'assistant_paired',
      'assistant_pairing_refused',
    ]) {
      expect(eventNameSchema.safeParse(name).success).toBe(true);
    }
  });

  it('keeps pairing evidence to closed sets, never the code or the address', () => {
    const paired = eventEvidenceSchemas.assistant_paired;
    expect(paired.safeParse({ channel: 'zulip_dm', via: 'email_match' }).success).toBe(true);
    expect(
      paired.safeParse({ channel: 'zulip_dm', via: 'email_match', address: 'zulip:5005' }).success,
    ).toBe(false);
    const started = eventEvidenceSchemas.assistant_pairing_started;
    expect(started.safeParse({ channel: 'zulip_dm' }).success).toBe(true);
    expect(started.safeParse({ channel: 'zulip_dm', code: 'K7M2Q9XR' }).success).toBe(false);
    const refused = eventEvidenceSchemas.assistant_pairing_refused;
    expect(refused.safeParse({ channel: 'zulip_dm', why: 'pairing_code_wrong' }).success).toBe(
      true,
    );
    expect(refused.safeParse({ channel: 'zulip_dm', why: 'late' }).success).toBe(false);
  });

  it('closes the ways a pairing happens and is refused', () => {
    expect([...assistantPairingViaSchema.options]).toEqual(['email_match', 'pairing_code']);
    expect([...assistantPairingRefusalSchema.options]).toEqual([
      'no_pairing',
      'pairing_code_wrong',
      'pairing_code_expired',
      'pairing_attempts_spent',
      'address_taken',
    ]);
  });
});

describe('PA-6 the Zulip assistant delivery contract', () => {
  it('adds the assistant source beside the stream bot', () => {
    expect([...ingestSourceSchema.options]).toEqual(['github', 'zulip', 'zulip-assistant']);
  });

  it('reads the sender id, the bot email and a typed direct recipient list', () => {
    const parsed = zulipMessageSchema.parse({
      trigger: 'direct_message',
      bot_email: 'barnabas-bot@chat.example.org',
      message: {
        id: 77,
        sender_id: 5005,
        sender_email: 'ana@example.org',
        type: 'private',
        display_recipient: [
          { id: 5005, email: 'ana@example.org', full_name: 'Ana' },
          { id: 9001, email: 'barnabas-bot@chat.example.org', full_name: 'barnabas' },
        ],
        subject: '',
        content: 'What is on today?',
        timestamp: 1790000000,
      },
    });
    expect(parsed.bot_email).toBe('barnabas-bot@chat.example.org');
    expect(parsed.message.sender_id).toBe(5005);
    expect(parsed.message.timestamp).toBe(1790000000);
    expect(parsed.message.display_recipient).toEqual([
      { id: 5005, email: 'ana@example.org', full_name: 'Ana' },
      { id: 9001, email: 'barnabas-bot@chat.example.org', full_name: 'barnabas' },
    ]);
  });

  it('still reads a stream message without the new fields', () => {
    const parsed = zulipMessageSchema.parse({
      trigger: 'mention',
      message: {
        id: 78,
        sender_email: 'ana@example.org',
        type: 'stream',
        display_recipient: '80-89 Tech',
        subject: 'topic',
        content: 'hi',
      },
    });
    expect(parsed.message.sender_id).toBeUndefined();
    expect(parsed.bot_email).toBeUndefined();
  });
});
