import type { InboundMail, MailAttachment } from '@uw/harness';
import PostalMime, { type Attachment } from 'postal-mime';

export type FetchedMail = {
  readonly id: string;
  readonly internalDate: Date;
  readonly raw: Uint8Array;
};

const TEXT_TYPES: ReadonlySet<string> = new Set([
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/vtt',
  'text/calendar',
]);
const ATTACHMENTS_MOST = 10;
const PARSE_LIMITS = { maxNestingDepth: 20, maxHeadersSize: 256 * 1024 };
const ENTITIES: ReadonlyMap<string, string> = new Map([
  ['nbsp', ' '],
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['#39', "'"],
]);

function htmlAsText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(
      /&(#39|[a-z]+);/gi,
      (entity, name: string) => ENTITIES.get(name.toLowerCase()) ?? entity,
    )
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line !== '')
    .join('\n');
}

function textOf(attachment: Attachment): MailAttachment | null {
  const type = attachment.mimeType.toLowerCase();
  if (!TEXT_TYPES.has(type) || typeof attachment.content !== 'string') return null;
  const filename = (attachment.filename ?? 'attachment').replace(/[\r\n]/g, ' ').slice(0, 200);
  return attachment.content.trim() === '' ? null : { filename, text: attachment.content };
}

export async function inboundMailOf(
  fetched: FetchedMail,
  isAssistant: (address: string) => Promise<boolean>,
): Promise<InboundMail> {
  const email = await PostalMime.parse(fetched.raw, {
    attachmentEncoding: 'utf8',
    ...PARSE_LIMITS,
  });
  const text = email.text ?? (email.html === undefined ? '' : htmlAsText(email.html));
  const attachments = email.attachments
    .filter((attachment) => attachment.disposition !== 'inline')
    .flatMap((attachment) => textOf(attachment) ?? [])
    .slice(0, ATTACHMENTS_MOST);
  const sender = email.from?.address;
  const fromAssistant = sender === undefined ? false : await isAssistant(sender.toLowerCase());
  return {
    externalId: fetched.id,
    threadKey: fetched.id,
    receivedAt: fetched.internalDate.toISOString(),
    headers: email.headers.map((header) => ({ name: header.originalKey, value: header.value })),
    text,
    attachments,
    fromAssistant,
  };
}
