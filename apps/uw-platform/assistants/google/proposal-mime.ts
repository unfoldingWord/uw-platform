import { encodedWords, oneLine, wrapped } from './reply-mime.ts';

export type ProposedMail = {
  readonly from: string;
  readonly to: readonly string[];
  readonly cc: readonly string[];
  readonly replyTo: string;
  readonly subject: string;
  readonly text: string;
};

const SUBJECT_MOST = 200;

function addresses(list: readonly string[]): string {
  return list.map(oneLine).join(', ');
}

export function proposalMime(mail: ProposedMail): Uint8Array {
  const headers = [
    `From: ${oneLine(mail.from)}`,
    `To: ${addresses(mail.to)}`,
    ...(mail.cc.length === 0 ? [] : [`Cc: ${addresses(mail.cc)}`]),
    `Reply-To: ${oneLine(mail.replyTo)}`,
    `Subject: ${encodedWords(oneLine(mail.subject).slice(0, SUBJECT_MOST))}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
  ];
  return new TextEncoder().encode(`${headers.join('\r\n')}\r\n\r\n${wrapped(mail.text)}\r\n`);
}
