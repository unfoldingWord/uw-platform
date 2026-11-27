export type ReplyMail = {
  readonly from: string;
  readonly to: string;
  readonly subject: string;
  readonly inReplyTo: string | null;
  readonly references: string | null;
  readonly text: string;
};

const SUBJECT_MOST = 200;
const LINE = 76;
const WORD_CHARACTERS = 30;
const MESSAGE_ID = /<[^<>\s]{1,250}>/g;
const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;

function oneLine(value: string): string {
  return value
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function base64Of(text: string): string {
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function encodedWords(value: string): string {
  if (PRINTABLE_ASCII.test(value)) return value;
  const characters = [...value];
  const words: string[] = [];
  for (let start = 0; start < characters.length; start += WORD_CHARACTERS) {
    const chunk = characters.slice(start, start + WORD_CHARACTERS).join('');
    words.push(`=?UTF-8?B?${base64Of(chunk)}?=`);
  }
  return words.join('\r\n ');
}

function messageIds(value: string | null): string | null {
  const ids = oneLine(value ?? '').match(MESSAGE_ID) ?? [];
  return ids.length === 0 ? null : ids.join(' ');
}

function wrapped(text: string): string {
  const encoded = base64Of(text);
  const lines: string[] = [];
  for (let start = 0; start < encoded.length; start += LINE) {
    lines.push(encoded.slice(start, start + LINE));
  }
  return lines.join('\r\n');
}

export function replySubject(original: string): string {
  const subject = oneLine(original).slice(0, SUBJECT_MOST);
  if (subject === '') return 'Re: your message';
  return /^re:/i.test(subject) ? subject : `Re: ${subject}`;
}

export function replyMime(reply: ReplyMail): Uint8Array {
  const inReplyTo = messageIds(reply.inReplyTo)?.split(' ')[0] ?? null;
  const references = messageIds(reply.references) ?? inReplyTo;
  const headers = [
    `From: ${oneLine(reply.from)}`,
    `To: ${oneLine(reply.to)}`,
    `Subject: ${encodedWords(replySubject(reply.subject))}`,
    ...(inReplyTo === null ? [] : [`In-Reply-To: ${inReplyTo}`]),
    ...(references === null ? [] : [`References: ${references}`]),
    'Auto-Submitted: auto-replied',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
  ];
  return new TextEncoder().encode(`${headers.join('\r\n')}\r\n\r\n${wrapped(reply.text)}\r\n`);
}
