import PostalMime from 'postal-mime';
import { describe, expect, it } from 'vitest';
import { replyMime, replySubject } from './reply-mime.ts';

const reply = {
  from: 'barnabas@example.org',
  to: 'ana@example.org',
  subject: 'Fwd: Board dinner',
  inReplyTo: '<CAF0wner01@mail.gmail.com>',
  references: '<earlier@mail.gmail.com> <CAF0wner01@mail.gmail.com>',
  text: 'I will remind you on Monday at nine. Café at ten.',
};

async function parsed(bytes: Uint8Array) {
  return PostalMime.parse(bytes);
}

describe('PA-10 a reply by email goes only to my address and is marked automatic', () => {
  it('addresses only me from the assistant mailbox, threaded on my mail', async () => {
    const mail = await parsed(replyMime(reply));
    expect(mail.from).toEqual({ name: '', address: 'barnabas@example.org' });
    expect(mail.to).toEqual([{ name: '', address: 'ana@example.org' }]);
    expect(mail.cc).toBeUndefined();
    expect(mail.bcc).toBeUndefined();
    expect(mail.subject).toBe('Re: Fwd: Board dinner');
    expect(mail.inReplyTo).toBe('<CAF0wner01@mail.gmail.com>');
    expect(mail.references).toBe('<earlier@mail.gmail.com> <CAF0wner01@mail.gmail.com>');
    expect(mail.text?.trim()).toBe(reply.text);
    const auto = mail.headers.find((header) => header.key === 'auto-submitted');
    expect(auto?.value).toBe('auto-replied');
  });

  it('cannot be given another recipient through the subject or the thread headers', async () => {
    const mail = await parsed(
      replyMime({
        ...reply,
        subject: 'Hi\r\nBcc: x@evil.example',
        inReplyTo: '<a@b>\r\nCc: y@evil.example',
        references: null,
      }),
    );
    expect(mail.bcc).toBeUndefined();
    expect(mail.cc).toBeUndefined();
    expect(mail.subject).toBe('Re: Hi Bcc: x@evil.example');
    expect(mail.inReplyTo).toBe('<a@b>');
  });

  it('encodes a subject that is not ASCII and keeps Re: once', async () => {
    expect(replySubject('re: Plans')).toBe('re: Plans');
    expect(replySubject('')).toBe('Re: your message');
    const mail = await parsed(replyMime({ ...reply, subject: 'Réunion à Nairobi '.repeat(6) }));
    expect(mail.subject).toBe(`Re: ${'Réunion à Nairobi '.repeat(6).trim()}`);
  });
});
