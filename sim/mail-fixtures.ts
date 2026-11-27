import { readFileSync } from 'node:fs';
import type { InboundMail, MailHeader } from '@uw/harness';

export const MAIL_OWNER = 'ana@example.org';

export function mailFixture(name: string): string {
  const url = new URL(`../packages/harness/assistants/fixtures/mail/${name}.eml`, import.meta.url);
  return readFileSync(url, 'utf8').replaceAll('\r\n', '\n');
}

export function headersOf(raw: string): readonly MailHeader[] {
  const head = raw.split('\n\n')[0] ?? '';
  const unfolded = head.replace(/\n[ \t]+/g, ' ');
  return unfolded.split('\n').flatMap((line) => {
    const colon = line.indexOf(':');
    return colon <= 0 ? [] : [{ name: line.slice(0, colon), value: line.slice(colon + 1).trim() }];
  });
}

export function bodyOf(raw: string): string {
  return raw.split('\n\n').slice(1).join('\n\n');
}

export function inboundMail(name: string, change: Partial<InboundMail> = {}): InboundMail {
  const raw = mailFixture(name);
  return {
    externalId: `gmail-${name}`,
    threadKey: `gmail-${name}`,
    receivedAt: '2026-10-01T09:00:00.000Z',
    headers: headersOf(raw),
    text: bodyOf(raw),
    attachments: [],
    fromAssistant: false,
    ...change,
  };
}
