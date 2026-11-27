import { describe, expect, it } from 'vitest';
import { assistantMailRefusalSchema } from './assistant-mail.ts';
import { untrustedSourceSchema } from './closed-sets.ts';
import { eventEvidenceSchemas } from './event-evidence.ts';
import { eventNameSchema } from './events.ts';
import { schemaRegistry } from './registry.ts';
import { CONTRACT_VERSION } from './version.ts';

describe('PA-10 mail to my assistant', () => {
  it('names why a mail starts no turn, as a closed set', () => {
    expect([...assistantMailRefusalSchema.options]).toEqual([
      'automated_sender',
      'other_sender',
      'unverified_sender',
      'email_instructions_off',
      'email_not_bound',
    ]);
    expect(schemaRegistry['assistant-mail-refusal']).toBe(assistantMailRefusalSchema);
  });

  it('fences forwarded text and attachments as untrusted sources of their own', () => {
    for (const source of ['email_forwarded', 'email_attachment']) {
      expect(untrustedSourceSchema.safeParse(source).success).toBe(true);
    }
  });

  it('records a declined mail with a closed reason only, never an address or text', () => {
    expect(eventNameSchema.safeParse('assistant_mail_declined').success).toBe(true);
    const declined = eventEvidenceSchemas.assistant_mail_declined;
    expect(declined.safeParse({ why: 'unverified_sender' }).success).toBe(true);
    expect(declined.safeParse({ why: 'unverified_sender', from: 'a@b.org' }).success).toBe(false);
    expect(declined.safeParse({ why: 'spam' }).success).toBe(false);
  });

  it('is published at contract version 14.22.0', () => {
    expect(CONTRACT_VERSION).toBe('14.22.0');
  });
});
